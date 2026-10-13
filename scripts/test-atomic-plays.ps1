#requires -Version 7.0
[CmdletBinding()]
param(
    [string] $PostgresBin = 'C:\Program Files\PostgreSQL\17\bin',
    [string] $ConcurrentScript,
    [string] $NodeBin = 'node',
    [switch] $BootstrapOnly
)

# No linked project, connection string, inherited PG* settings or existing server.
Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$workRoot = [IO.Path]::GetFullPath((Join-Path $repo '.work/atomic-play-tests'))
$runDirectory = Join-Path $workRoot ([Guid]::NewGuid().ToString('N'))
$cluster = [IO.Path]::GetFullPath((Join-Path $runDirectory 'cluster'))
if (-not $cluster.StartsWith($workRoot + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
    throw 'The isolated cluster path is outside the test workspace.'
}
$fixture = Join-Path $repo 'supabase/tests/atomic_play_fixture.sql'
$migration = Join-Path $repo 'supabase/migrations/20261013000000_atomic_play_writes.sql'
$tests = Join-Path $repo 'supabase/tests/atomic_play_writes.sql'
$required = @($fixture)
if (-not $BootstrapOnly) { $required += @($migration, $tests) }
if ($ConcurrentScript) {
    if ($BootstrapOnly) { throw '-ConcurrentScript cannot be used with -BootstrapOnly.' }
    $ConcurrentScript = [IO.Path]::GetFullPath($ConcurrentScript)
    if (-not $ConcurrentScript.StartsWith($repo + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase) -or
        [IO.Path]::GetExtension($ConcurrentScript) -ne '.mjs') {
        throw 'The concurrency script must be a local .mjs file inside this repository.'
    }
    $required += $ConcurrentScript
    $NodeBin = (Get-Command $NodeBin -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
}
foreach ($path in $required) {
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Required local file missing: $path. No cluster was started." }
}
$binaries = @{}
foreach ($name in @('initdb', 'pg_ctl', 'psql')) {
    $path = Join-Path $PostgresBin "$name.exe"
    if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "PostgreSQL executable missing: $name.exe. No cluster was started." }
    $binaries[$name] = [IO.Path]::GetFullPath($path)
}
[void][IO.Directory]::CreateDirectory($runDirectory)
$passFile = Join-Path $runDirectory 'empty.pgpass'
[IO.File]::WriteAllText($passFile, '', [Text.UTF8Encoding]::new($false))
$reportPath = Join-Path $runDirectory 'report.json'
$report = [ordered]@{
    status = 'FAIL'
    mode = $(if ($BootstrapOnly) { 'bootstrap' } else { 'atomic-play-writes' })
    startedAtUtc = [DateTime]::UtcNow.ToString('o')
    finishedAtUtc = $null
    host = '127.0.0.1'
    port = $null
    cluster = $cluster
    runDirectory = $runDirectory
    postgresBin = [IO.Path]::GetFullPath($PostgresBin)
    exitCodes = [ordered]@{}
    logs = [ordered]@{}
    serverStopped = $true
    failure = $null
}

function Invoke-IsolatedProcess {
    param([string] $Step, [string] $Executable, [string[]] $Arguments, [int] $TimeoutSeconds = 180)
    $stdoutPath = Join-Path $runDirectory "$Step.stdout.log"
    $stderrPath = Join-Path $runDirectory "$Step.stderr.log"
    $report.logs[$Step] = @{ stdout = $stdoutPath; stderr = $stderrPath }
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Executable
    $start.WorkingDirectory = $repo
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($key in @($start.Environment.Keys)) {
        if ($key.StartsWith('PG', [StringComparison]::OrdinalIgnoreCase)) { [void]$start.Environment.Remove($key) }
    }
    # Even a user's default pgpass/psqlrc cannot influence these local sessions.
    $start.Environment['PGPASSFILE'] = $passFile
    $start.Environment['PGCONNECT_TIMEOUT'] = '5'
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    $process = [Diagnostics.Process]::new()
    $process.StartInfo = $start
    $timer = [Diagnostics.Stopwatch]::StartNew()
    $lastProgress = 0
    try {
        if (-not $process.Start()) { throw "Cannot start local step: $Step." }
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        while (-not $process.WaitForExit(500)) {
            if ($timer.Elapsed.TotalSeconds -ge $TimeoutSeconds) {
                $process.Kill($true)
                $process.WaitForExit()
                [IO.File]::WriteAllText($stdoutPath, $stdout.GetAwaiter().GetResult())
                [IO.File]::WriteAllText($stderrPath, $stderr.GetAwaiter().GetResult())
                $report.exitCodes[$Step] = -1
                throw "Local step timed out: $Step. See its preserved logs."
            }
            if ($timer.Elapsed.TotalSeconds - $lastProgress -ge 20) {
                Write-Host "[$Step] Running locally; logs: $runDirectory"
                $lastProgress = $timer.Elapsed.TotalSeconds
            }
        }
        # On Windows pg_ctl's server descendants can inherit its redirected
        # pipe handles even with -l. Waiting for EOF would wait for the server.
        if ($Step -eq 'start') {
            $output = if ($stdout.IsCompletedSuccessfully) { $stdout.GetAwaiter().GetResult() } else { 'pg_ctl exited; startup output is in postgres.log.' }
            $errors = if ($stderr.IsCompletedSuccessfully) { $stderr.GetAwaiter().GetResult() } else { 'pg_ctl exited; startup diagnostics are in postgres.log.' }
            [IO.File]::WriteAllText($stdoutPath, $output)
            [IO.File]::WriteAllText($stderrPath, $errors)
        } else {
            [IO.File]::WriteAllText($stdoutPath, $stdout.GetAwaiter().GetResult())
            [IO.File]::WriteAllText($stderrPath, $stderr.GetAwaiter().GetResult())
        }
        $report.exitCodes[$Step] = $process.ExitCode
        if ($process.ExitCode -ne 0) { throw "Local step failed: $Step (exit $($process.ExitCode)). See its preserved logs." }
        Write-Host "[$Step] PASS"
    } finally { $process.Dispose() }
}

$launchAttempted = $false
$failed = $false
try {
    # Reserve a free loopback port only while choosing it. If another process
    # wins the subsequent bind, pg_ctl fails; no other listener is stopped.
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    try {
        $listener.Start()
        $report.port = ([Net.IPEndPoint]$listener.LocalEndpoint).Port
    } finally { $listener.Stop() }
    Invoke-IsolatedProcess 'initdb' $binaries.initdb @('-D', $cluster, '-U', 'postgres', '--encoding=UTF8', '--no-locale', '--auth-local=trust', '--auth-host=trust')
    $configuration = "`nlisten_addresses = '127.0.0.1'`nport = $($report.port)`nunix_socket_directories = ''`nssl = off`nmax_connections = 30`n"
    [IO.File]::AppendAllText((Join-Path $cluster 'postgresql.conf'), $configuration, [Text.UTF8Encoding]::new($false))
    $serverLog = Join-Path $runDirectory 'postgres.log'
    $report.logs['server'] = $serverLog
    $launchAttempted = $true
    $report.serverStopped = $false
    Invoke-IsolatedProcess 'start' $binaries.pg_ctl @('-D', $cluster, '-l', $serverLog, '-w', '-t', '30', 'start') 45
    $connection = @('-X', '-w', '-h', '127.0.0.1', '-p', [string]$report.port, '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1')
    Invoke-IsolatedProcess 'fixture' $binaries.psql ($connection + @('-f', $fixture))
    if (-not $BootstrapOnly) {
        Invoke-IsolatedProcess 'migration' $binaries.psql ($connection + @('-f', $migration))
        Invoke-IsolatedProcess 'sql-tests' $binaries.psql ($connection + @('-f', $tests))
        if ($ConcurrentScript) {
            Invoke-IsolatedProcess 'concurrency' $NodeBin @($ConcurrentScript, [IO.Path]::GetFullPath($PostgresBin), [string]$report.port, $runDirectory)
        }
    }
    $report.status = $(if ($BootstrapOnly) { 'BOOTSTRAP_PASS' } else { 'PASS' })
} catch {
    $failed = $true
    # Only harness-generated messages reach stdout; child output stays in logs.
    $harnessLog = Join-Path $runDirectory 'harness.error.log'
    [IO.File]::WriteAllText($harnessLog, $_.ToString(), [Text.UTF8Encoding]::new($false))
    $report.logs['harness'] = $harnessLog
    $report.failure = 'Local harness failed; inspect the preserved step logs.'
    Write-Host "FAIL: local harness. Logs: $runDirectory"
} finally {
    if ($launchAttempted) {
        try {
            if (Test-Path -LiteralPath (Join-Path $cluster 'postmaster.pid')) {
                Invoke-IsolatedProcess 'stop' $binaries.pg_ctl @('-D', $cluster, '-m', 'fast', '-w', '-t', '30', 'stop') 45
            }
            $report.serverStopped = -not (Test-Path -LiteralPath (Join-Path $cluster 'postmaster.pid'))
            if (-not $report.serverStopped) { throw 'Own cluster did not stop.' }
        } catch {
            $failed = $true
            $report.failure = 'The dedicated cluster could not be stopped; inspect stop logs and its directory.'
            Write-Host "FAIL: stop own cluster: $cluster"
        }
    }
    if ($failed) { $report.status = 'FAIL' }
    $report.finishedAtUtc = [DateTime]::UtcNow.ToString('o')
    [IO.File]::WriteAllText($reportPath, ($report | ConvertTo-Json -Depth 8), [Text.UTF8Encoding]::new($false))
    # Keep fixture, database and logs for diagnosis. No recursive deletion.
    Write-Host "$($report.status): report $reportPath"
}
if ($failed) { exit 1 }
