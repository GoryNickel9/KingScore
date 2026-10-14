#requires -Version 7.0
[CmdletBinding()]
param([string]$PostgresBin = 'C:\Program Files\PostgreSQL\17\bin')

Set-StrictMode -Version Latest
$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$runDirectory = Join-Path ([IO.Path]::GetTempPath()) ('kingscore-atomic-preflight-' + [Guid]::NewGuid().ToString('N'))
$cluster = Join-Path $runDirectory 'cluster'
$preflight = Join-Path $PSScriptRoot 'atomic-play-preflight.sql'
$binaries = @{}
foreach ($name in @('initdb', 'pg_ctl', 'psql')) {
    $binary = [IO.Path]::GetFullPath((Join-Path $PostgresBin "$name.exe"))
    if (-not (Test-Path -LiteralPath $binary -PathType Leaf)) { throw "Missing PostgreSQL binary: $binary" }
    $binaries[$name] = $binary
}
if (-not (Test-Path -LiteralPath $preflight -PathType Leaf)) { throw 'Preflight SQL file missing' }
New-Item -ItemType Directory -Path $runDirectory | Out-Null
[IO.File]::WriteAllText((Join-Path $runDirectory 'empty.pgpass'), '')
$report = [ordered]@{
    status = 'FAIL'; host = '127.0.0.1'; port = $null; runDirectory = $runDirectory
    startedAtUtc = [DateTime]::UtcNow.ToString('o'); finishedAtUtc = $null
    postgresVersion = $null; serverStopped = $false; remoteContacted = $false
    cases = [Collections.Generic.List[object]]::new(); failure = $null
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
        if ($key -match '^(PG|POSTGRES|HTTPS?_PROXY|ALL_PROXY)') { [void]$start.Environment.Remove($key) }
    }
    $start.Environment['PGPASSFILE'] = Join-Path $runDirectory 'empty.pgpass'
    $start.Environment['PGCONNECT_TIMEOUT'] = '5'
    $process = [Diagnostics.Process]::Start($start)
    try {
        $stdout = $process.StandardOutput.ReadToEndAsync()
        $stderr = $process.StandardError.ReadToEndAsync()
        if (-not $process.WaitForExit($TimeoutSeconds * 1000)) {
            $process.Kill($true)
            [void]$process.WaitForExit(5000)
            throw "Own test process timed out: $Name"
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

# Synthetic application tables only. No Auth, Supabase roles, RPCs or gateway.
$baseFixture = @'
CREATE TABLE public.games (id uuid PRIMARY KEY);
CREATE TABLE public.players (id uuid PRIMARY KEY);
CREATE TABLE public.plays (
  id uuid PRIMARY KEY, user_id uuid, game_id uuid, played_at date NOT NULL,
  duration_minutes integer, source text, notes text, is_cooperative boolean,
  team_won boolean, location text, bga_table_id text, created_at timestamptz
);
CREATE TABLE public.play_scores (
  id uuid PRIMARY KEY, play_id uuid, player_id uuid, score numeric,
  winner boolean, color text, role text, position integer
);
'@
$timestampFunction = @'
CREATE FUNCTION public.update_updated_at_column() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$;
'@
$duplicates = @'
INSERT INTO public.plays(id,user_id,played_at,bga_table_id) VALUES
 ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','2026-10-14','same-table'),
 ('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000010','2026-10-14','same-table');
'@
$cases = @(
    @{ name = 'compatible'; setup = ''; status = 'compatible'; checks = @{} },
    @{ name = 'missing-table'; setup = 'DROP TABLE public.plays'; status = 'blocked'; checks = @{ 'column:plays.id' = 'BLOCKER'; 'bga:duplicate-owner-table' = 'SKIPPED' } },
    @{ name = 'missing-column'; setup = 'ALTER TABLE public.plays DROP COLUMN bga_table_id; ALTER TABLE public.play_scores DROP COLUMN role'; status = 'blocked'; checks = @{ 'column:plays.bga_table_id' = 'BLOCKER'; 'column:play_scores.role' = 'BLOCKER' } },
    @{ name = 'timestamp-date'; setup = 'ALTER TABLE public.plays ALTER COLUMN played_at TYPE timestamptz USING played_at::timestamptz'; status = 'blocked'; checks = @{ 'column:plays.played_at' = 'BLOCKER' } },
    @{ name = 'wrong-score-type'; setup = 'ALTER TABLE public.play_scores ALTER COLUMN score TYPE text USING score::text'; status = 'blocked'; checks = @{ 'column:play_scores.score' = 'BLOCKER' } },
    @{ name = 'numeric-typmod'; setup = 'ALTER TABLE public.play_scores ALTER COLUMN score TYPE numeric(10,2)'; status = 'blocked'; checks = @{ 'column:play_scores.score' = 'BLOCKER' } },
    @{ name = 'orphan-trigger'; setup = $timestampFunction + 'CREATE TRIGGER update_play_scores_updated_at BEFORE UPDATE ON public.play_scores FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()'; status = 'blocked'; checks = @{ 'timestamp-trigger:play_scores.update_play_scores_updated_at' = 'BLOCKER' } },
    @{ name = 'valid-trigger'; setup = $timestampFunction + 'ALTER TABLE public.play_scores ADD COLUMN updated_at timestamptz; CREATE TRIGGER update_play_scores_updated_at BEFORE UPDATE ON public.play_scores FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column()'; status = 'compatible'; checks = @{ 'timestamp-trigger:play_scores.update_play_scores_updated_at' = 'PASS' } },
    @{ name = 'disabled-trigger'; setup = $timestampFunction + 'ALTER TABLE public.play_scores ADD COLUMN updated_at timestamptz; CREATE TRIGGER update_play_scores_updated_at BEFORE UPDATE ON public.play_scores FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column(); ALTER TABLE public.play_scores DISABLE TRIGGER update_play_scores_updated_at'; status = 'conditional'; checks = @{ 'timestamp-trigger:play_scores.update_play_scores_updated_at' = 'CONDITION' } },
    @{ name = 'timestamp-without-trigger'; setup = 'ALTER TABLE public.plays ADD COLUMN updated_at timestamptz'; status = 'conditional'; checks = @{ 'timestamp-trigger:plays.absent' = 'CONDITION' } },
    @{ name = 'participant-unique'; setup = 'ALTER TABLE public.play_scores ADD CONSTRAINT score_participant_uq UNIQUE(play_id,player_id)'; status = 'conditional'; checks = @{ 'participant-unique:public.score_participant_uq' = 'CONDITION' } },
    @{ name = 'reversed-unique'; setup = 'CREATE UNIQUE INDEX score_reversed_uq ON public.play_scores(player_id,play_id) INCLUDE (score)'; status = 'conditional'; checks = @{ 'participant-unique:public.score_reversed_uq' = 'CONDITION' } },
    @{ name = 'bga-duplicates'; setup = $duplicates; status = 'blocked'; checks = @{ 'bga:duplicate-owner-table' = 'BLOCKER' } },
    @{ name = 'bga-distinct-owners'; setup = $duplicates + "UPDATE public.plays SET user_id='00000000-0000-0000-0000-000000000011' WHERE id='00000000-0000-0000-0000-000000000002'"; status = 'compatible'; checks = @{ 'bga:duplicate-owner-table' = 'PASS' } },
    @{ name = 'ownerless-bga'; setup = $duplicates + 'UPDATE public.plays SET user_id=NULL'; status = 'conditional'; checks = @{ 'bga:duplicate-owner-table' = 'PASS'; 'bga:ownerless-imports' = 'CONDITION' } },
    @{ name = 'catalog-cascades'; setup = 'ALTER TABLE public.plays ADD CONSTRAINT plays_game_fkey FOREIGN KEY(game_id) REFERENCES public.games(id) ON DELETE CASCADE; ALTER TABLE public.play_scores ADD CONSTRAINT scores_player_fkey FOREIGN KEY(player_id) REFERENCES public.players(id) ON DELETE CASCADE'; status = 'conditional'; checks = @{ 'catalog-cascade:games->plays:plays_game_fkey' = 'CONDITION'; 'catalog-cascade:players->play_scores:scores_player_fkey' = 'CONDITION' } },
    @{ name = 'foreign-table'; setup = 'DROP TABLE public.plays; CREATE FOREIGN DATA WRAPPER local_test_fdw; CREATE SERVER unused_local_test FOREIGN DATA WRAPPER local_test_fdw; CREATE FOREIGN TABLE public.plays(id uuid, user_id uuid, bga_table_id text) SERVER unused_local_test'; status = 'blocked'; checks = @{ 'column:plays.user_id' = 'BLOCKER'; 'bga:duplicate-owner-table' = 'SKIPPED' } },
    @{ name = 'inherited-foreign-child'; setup = 'CREATE FOREIGN DATA WRAPPER inherited_test_fdw; CREATE SERVER unused_inherited_test FOREIGN DATA WRAPPER inherited_test_fdw; CREATE FOREIGN TABLE public.foreign_plays() INHERITS (public.plays) SERVER unused_inherited_test'; status = 'blocked'; checks = @{ 'column:plays.user_id' = 'BLOCKER'; 'bga:duplicate-owner-table' = 'SKIPPED' } },
    @{ name = 'rls-limited-visibility'; setup = $duplicates + 'CREATE ROLE preflight_reader NOLOGIN; GRANT USAGE ON SCHEMA public TO preflight_reader; GRANT SELECT ON ALL TABLES IN SCHEMA public TO preflight_reader; ALTER TABLE public.plays ENABLE ROW LEVEL SECURITY; CREATE POLICY hide_rows ON public.plays FOR SELECT TO preflight_reader USING (false)'; asRole = 'preflight_reader'; status = 'conditional'; checks = @{ 'data-visibility:role' = 'CONDITION'; 'bga:duplicate-owner-table' = 'SKIPPED' } }
)

# Fingerprint schema definitions and every synthetic row before/after the diagnostic.
$fingerprint = @'
SET timezone = 'UTC';
SELECT md5(jsonb_build_object(
 'columns', (SELECT jsonb_agg(to_jsonb(a) ORDER BY a.attrelid,a.attnum)
   FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname='public' AND a.attnum>0 AND NOT a.attisdropped),
 'constraints', (SELECT jsonb_agg(jsonb_build_object('name',conname,'definition',pg_get_constraintdef(c.oid)) ORDER BY c.oid)
   FROM pg_constraint c JOIN pg_namespace n ON n.oid=c.connamespace WHERE n.nspname='public'),
 'triggers', (SELECT jsonb_agg(jsonb_build_object('definition',pg_get_triggerdef(t.oid),'enabled',t.tgenabled) ORDER BY t.oid)
   FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND NOT t.tgisinternal),
 'functions', (SELECT jsonb_agg(pg_get_functiondef(p.oid) ORDER BY p.oid)
   FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='public' AND p.prokind IN ('f','p')),
 'rows', (SELECT jsonb_agg(query_to_xml(format('SELECT * FROM ONLY public.%I ORDER BY id',c.relname),true,false,'')::text ORDER BY c.relname)
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind='r')
)::text);
'@
$launchAttempted = $false
try {
    $report.postgresVersion = Invoke-OwnProcess 'version' $binaries.psql @('--version')
    Invoke-OwnProcess 'initdb' $binaries.initdb @('-D', $cluster, '-U', 'postgres', '--auth=trust', '--encoding=UTF8', '--locale=C') 120 | Out-Null
    $listener = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Loopback, 0)
    $listener.Start()
    try { $port = $listener.LocalEndpoint.Port } finally { $listener.Stop() }
    $report.port = $port
    $launchAttempted = $true
    Invoke-OwnProcess 'start' $binaries.pg_ctl @('-D', $cluster, '-l', (Join-Path $runDirectory 'postgres.log'), '-o', "-h 127.0.0.1 -p $port", '-w', '-t', '30', 'start') | Out-Null
    $connection = @('-X', '-w', '-h', '127.0.0.1', '-p', [string]$port, '-U', 'postgres', '-v', 'ON_ERROR_STOP=1', '-qAt')
    $index = 0
    foreach ($case in $cases) {
        $index++
        $database = 'preflight_case_' + $index
        Invoke-OwnProcess "$($case.name)-database" $binaries.psql ($connection + @('-d', 'postgres', '-c', "CREATE DATABASE $database")) | Out-Null
        $fixtureFile = Join-Path $runDirectory "$($case.name)-fixture.sql"
        [IO.File]::WriteAllText($fixtureFile, $baseFixture + "`n" + $case.setup + ";`n")
        Invoke-OwnProcess "$($case.name)-fixture" $binaries.psql ($connection + @('-d', $database, '-f', $fixtureFile)) | Out-Null
        $before = Invoke-OwnProcess "$($case.name)-before" $binaries.psql ($connection + @('-d', $database, '-c', $fingerprint))
        $preflightArguments = $connection + @('-d', $database)
        if ($case.ContainsKey('asRole')) { $preflightArguments += @('-c', "SET ROLE $($case.asRole)") }
        $json = Invoke-OwnProcess "$($case.name)-preflight" $binaries.psql ($preflightArguments + @('-f', $preflight))
        $result = $json | ConvertFrom-Json
        if ($result.status -ne $case.status) { throw "Unexpected status for $($case.name): $($result.status); expected $($case.status)" }
        if ($result.transaction_read_only -ne 'on') { throw "Diagnostic did not run read-only: $($case.name)" }
        if ($case.ContainsKey('asRole') -and $result.data_visibility -ne 'not-certified') { throw 'Limited-role visibility incorrectly certified' }
        foreach ($check in $case.checks.GetEnumerator()) {
            $findings = @($result.findings | Where-Object { $_.check_id -eq $check.Key })
            if ($findings.Count -ne 1 -or $findings[0].severity -ne $check.Value) { throw "Missing/unexpected finding for $($case.name): $($check.Key)" }
        }
        $after = Invoke-OwnProcess "$($case.name)-after" $binaries.psql ($connection + @('-d', $database, '-c', $fingerprint))
        if ($before -ne $after) { throw "Preflight changed synthetic schema/data: $($case.name)" }
        $report.cases.Add([ordered]@{ name = $case.name; status = 'PASS'; diagnosticStatus = $result.status; blockers = $result.blockers; conditions = $result.conditions; unchanged = $true })
        Write-Host "[$($case.name)] PASS"
    }
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
    $report | ConvertTo-Json -Depth 8 | Set-Content -LiteralPath (Join-Path $runDirectory 'report.json') -Encoding utf8
    Write-Host "$($report.status): $(Join-Path $runDirectory 'report.json')"
}
if ($report.status -ne 'PASS') { exit 1 }
