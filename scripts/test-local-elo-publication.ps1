#requires -Version 7.0
[CmdletBinding()]
param([string]$PostgresBin = 'C:\Program Files\PostgreSQL\17\bin')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runDirectory = Join-Path $repo ('.work/local-elo-publication/' + [Guid]::NewGuid().ToString('N'))
$cluster = Join-Path $runDirectory 'cluster'
$fixture = Join-Path $repo 'local-tests/elo-publication-fixture.sql'
$nodeRunner = Join-Path $PSScriptRoot 'test-elo-publication.mjs'
$adapter = Join-Path $repo 'src/utils/elo/publication.ts'
$esbuild = Join-Path $repo 'node_modules/esbuild/bin/esbuild'
$binaries = @{}
foreach ($name in @('initdb', 'pg_ctl', 'psql')) {
    $binary = [IO.Path]::GetFullPath((Join-Path $PostgresBin "$name.exe"))
    if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) { throw "Missing PostgreSQL binary: $binary" }
    $binaries[$name] = $binary
}
foreach ($file in @($fixture, $nodeRunner, $adapter, $esbuild)) {
    if (-not (Test-Path -LiteralPath $file -PathType Leaf)) { throw "Missing local test input: $file" }
}
$node = (Get-Command node -CommandType Application -ErrorAction Stop | Select-Object -First 1).Source
New-Item -ItemType Directory -Path $runDirectory -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $runDirectory 'empty.pgpass'), '')
$report = [ordered]@{
    status = 'FAIL'; host = '127.0.0.1'; port = $null; runDirectory = $runDirectory
    startedAtUtc = [DateTime]::UtcNow.ToString('o'); finishedAtUtc = $null
    postgresVersion = $null; serverStopped = $false; remoteContacted = $false
    fixtureSha256 = (Get-FileHash -LiteralPath $fixture -Algorithm SHA256).Hash.ToLowerInvariant()
    acceptance = $null; failure = $null
}

function Invoke-OwnProcess([string]$Name, [string]$Binary, [string[]]$Arguments, [int]$TimeoutSeconds = 60) {
    $start = [Diagnostics.ProcessStartInfo]::new()
    $start.FileName = $Binary
    $start.WorkingDirectory = $repo
    $start.UseShellExecute = $false
    $start.CreateNoWindow = $true
    $start.RedirectStandardOutput = $true
    $start.RedirectStandardError = $true
    foreach ($argument in $Arguments) { $start.ArgumentList.Add($argument) }
    foreach ($key in @($start.Environment.Keys)) {
        if ($key -match '^(PG|POSTGRES|HTTPS?_PROXY|ALL_PROXY|NODE_OPTIONS)') { [void]$start.Environment.Remove($key) }
    }
    $start.Environment['PGPASSFILE'] = Join-Path $runDirectory 'empty.pgpass'
    $start.Environment['PGCONNECT_TIMEOUT'] = '5'
    $start.Environment['NO_PROXY'] = '127.0.0.1,localhost'
    $process = [Diagnostics.Process]::Start($start)
    try {
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            $process.Kill($true)
            [void]$process.WaitForExit(5000)
            throw "Own local test process timed out: $Name"
        }
        $output = ''
        foreach ($stream in @(
            @{ task = $stdout; reader = $process.StandardOutput; suffix = 'stdout' },
            @{ task = $stderr; reader = $process.StandardError; suffix = 'stderr' }
        )) {
            if ($stream.task.Wait(1000)) { $captured = $stream.task.GetAwaiter().GetResult() }
            elseif ($Name -eq 'start') {
                $stream.reader.Close()
                $captured = 'Own background server retained the startup pipe; inspect postgres.log.'
            } else { throw "Output pipe did not close: $Name" }
            [IO.File]::WriteAllText((Join-Path $runDirectory "$Name.$($stream.suffix).log"), $captured)
            if ($stream.suffix -eq 'stdout') { $output = $captured }
        }
        if ($process.ExitCode -ne 0) { throw "Local step failed: $Name; inspect $Name.stderr.log in $runDirectory" }
        return $output.Trim()
    } finally { $process.Dispose() }
}

$launchAttempted = $false
try {
    $report.postgresVersion = Invoke-OwnProcess 'version' $binaries.psql @('--version')
    Invoke-OwnProcess 'bundle' $node @($esbuild, $adapter, '--bundle', '--platform=node', '--format=esm', "--outfile=$(Join-Path $runDirectory 'publication.mjs')") | Out-Null
    Invoke-OwnProcess 'initdb' $binaries.initdb @('-D', $cluster, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale=C') 120 | Out-Null
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { $port = $listener.LocalEndpoint.Port } finally { $listener.Stop() }
    $report.port = $port
    $launchAttempted = $true
    Invoke-OwnProcess 'start' $binaries.pg_ctl @('-D', $cluster, '-l', (Join-Path $runDirectory 'postgres.log'), '-o', "-h 127.0.0.1 -p $port", '-w', '-t', '30', 'start') | Out-Null
    $connection = @('-X', '-w', '-h', '127.0.0.1', '-p', [string]$port, '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt')
    Invoke-OwnProcess 'database' $binaries.psql ($connection + @('-d', 'postgres', '-c', 'CREATE DATABASE kingscore_elo_local_tests')) | Out-Null
    Invoke-OwnProcess 'local-marker' $binaries.psql ($connection + @('-d', 'postgres', '-c', "ALTER DATABASE kingscore_elo_local_tests SET kingscore.local_test = 'elo-publication-v1'")) | Out-Null
    Invoke-OwnProcess 'fixture' $binaries.psql ($connection + @('-d', 'kingscore_elo_local_tests', '-c', "SET kingscore.local_test = 'elo-publication-v1'", '-f', $fixture)) | Out-Null
    Invoke-OwnProcess 'acceptance' $node @($nodeRunner, '--postgres-bin', $PostgresBin, '--port', [string]$port, '--run-dir', $runDirectory) 300 | Out-Null
    $acceptancePath = Join-Path $runDirectory 'acceptance-report.json'
    if (-not (Test-Path -LiteralPath $acceptancePath -PathType Leaf)) { throw 'Acceptance report missing' }
    $report.acceptance = Get-Content -LiteralPath $acceptancePath -Raw | ConvertFrom-Json
    if ($report.acceptance.status -ne 'PASS') { throw 'ELO publication acceptance cases failed' }
    if ($report.acceptance.remoteContacted -ne $false) { throw 'Acceptance report does not certify PC-only execution' }
    $report.status = 'PASS'
} catch {
    $report.failure = $_.Exception.Message
    Write-Host "FAIL: $($report.failure)"
} finally {
    if ($launchAttempted) {
        try {
            if (Test-Path -LiteralPath (Join-Path $cluster 'postmaster.pid')) {
                Invoke-OwnProcess 'stop' $binaries.pg_ctl @('-D', $cluster, '-m', 'fast', '-w', '-t', '30', 'stop') | Out-Null
            }
            $report.serverStopped = -not (Test-Path -LiteralPath (Join-Path $cluster 'postmaster.pid'))
            if (-not $report.serverStopped) { throw 'Own PostgreSQL cluster did not stop' }
        } catch { $report.status = 'FAIL'; $report.failure = $_.Exception.Message }
    }
    $report.finishedAtUtc = [DateTime]::UtcNow.ToString('o')
    $report | ConvertTo-Json -Depth 12 | Set-Content -LiteralPath (Join-Path $runDirectory 'report.json') -Encoding utf8
    Write-Host "$($report.status): $(Join-Path $runDirectory 'report.json')"
}
if ($report.status -ne 'PASS') { exit 1 }
