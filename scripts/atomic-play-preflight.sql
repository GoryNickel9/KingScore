-- Diagnostic only: no schema/data changes, RPC installation, Auth fixtures or role creation.
-- Run on a local database using psql -X -v ON_ERROR_STOP=1 -qAt -f this-file.sql.
-- A successful SQL execution can still return status=blocked; inspect the JSON findings.
BEGIN READ ONLY;
SET LOCAL search_path = pg_catalog;
SET LOCAL timezone = 'UTC';
SET LOCAL statement_timeout = '15s';

WITH
required(table_name, column_name, type_name, must_be_not_null) AS (VALUES
  ('plays', 'id', 'uuid', true),
  ('plays', 'user_id', 'uuid', false),
  ('plays', 'game_id', 'uuid', false),
  ('plays', 'played_at', 'date', true),
  ('plays', 'duration_minutes', 'integer', false),
  ('plays', 'source', 'text', false),
  ('plays', 'notes', 'text', false),
  ('plays', 'is_cooperative', 'boolean', false),
  ('plays', 'team_won', 'boolean', false),
  ('plays', 'location', 'text', false),
  ('plays', 'bga_table_id', 'text', false),
  ('plays', 'created_at', 'timestamp with time zone', false),
  ('play_scores', 'id', 'uuid', true),
  ('play_scores', 'play_id', 'uuid', false),
  ('play_scores', 'player_id', 'uuid', false),
  ('play_scores', 'score', 'numeric', false),
  ('play_scores', 'winner', 'boolean', false),
  ('play_scores', 'color', 'text', false),
  ('play_scores', 'role', 'text', false),
  ('play_scores', 'position', 'integer', false),
  ('games', 'id', 'uuid', true),
  ('players', 'id', 'uuid', true)
),
tables AS (
  SELECT names.table_name, c.oid, c.relkind
  FROM (VALUES ('plays'), ('play_scores'), ('games'), ('players')) names(table_name)
  LEFT JOIN pg_namespace n ON n.nspname = 'public'
  LEFT JOIN pg_class c ON c.relnamespace = n.oid AND c.relname = names.table_name
),
columns AS (
  SELECT t.table_name, a.attname AS column_name, a.attnum,
    format_type(a.atttypid, a.atttypmod) AS actual_type, a.atttypid,
    a.atttypmod, a.attnotnull, a.attgenerated, a.attidentity
  FROM tables t
  JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum > 0 AND NOT a.attisdropped
),
column_checks AS (
  SELECT r.*, c.actual_type, c.attnotnull,
    CASE WHEN t.oid IS NULL THEN 'table missing'
      WHEN t.relkind <> 'r' THEN 'ordinary local table required'
      WHEN EXISTS (SELECT 1 FROM pg_inherits i WHERE i.inhparent = t.oid OR i.inhrelid = t.oid)
        THEN 'inheritance/partitioning requires explicit compatibility review'
      WHEN c.column_name IS NULL THEN 'column missing'
      WHEN c.atttypid <> to_regtype(r.type_name) THEN 'incompatible type'
      WHEN c.atttypmod <> -1 THEN 'type restriction requires explicit compatibility review'
      WHEN c.attgenerated <> '' OR c.attidentity <> '' THEN 'generated column requires explicit compatibility review'
      WHEN r.must_be_not_null AND NOT c.attnotnull THEN 'NOT NULL required'
      ELSE NULL END AS problem
  FROM required r
  LEFT JOIN tables t ON t.table_name = r.table_name
  LEFT JOIN columns c ON c.table_name = r.table_name AND c.column_name = r.column_name
),
timestamp_triggers AS (
  SELECT t.table_name, tr.tgname, tr.tgenabled, tr.tgtype, pr.proname,
    pg_get_triggerdef(tr.oid) AS definition,
    c.actual_type AS timestamp_type,
    pg_get_functiondef(pr.oid) ~* 'new[[:space:]]*[.][[:space:]]*updated_at' AS references_timestamp
  FROM tables t
  JOIN pg_trigger tr ON tr.tgrelid = t.oid AND NOT tr.tgisinternal
  JOIN pg_proc pr ON pr.oid = tr.tgfoid
  LEFT JOIN columns c ON c.table_name = t.table_name AND c.column_name = 'updated_at'
  WHERE t.table_name IN ('plays', 'play_scores')
    AND (tr.tgname IN ('update_plays_updated_at', 'update_play_scores_updated_at')
      OR pg_get_functiondef(pr.oid) ~* 'new[[:space:]]*[.][[:space:]]*updated_at')
),
-- query_to_xml executes SELECT only. Guard it with catalog checks so absent/malformed
-- tables report blockers instead of a parse error; never scan views/foreign tables.
bga_scan AS MATERIALIZED (
  SELECT CASE WHEN NOT EXISTS (
      SELECT 1 FROM column_checks
      WHERE table_name = 'plays' AND column_name IN ('user_id', 'bga_table_id') AND problem IS NOT NULL
    ) AND NOT COALESCE(row_security_active((SELECT oid FROM tables WHERE table_name = 'plays')), false)
    THEN query_to_xml($query$
      SELECT (SELECT count(*) FROM (
        SELECT user_id, bga_table_id FROM ONLY public.plays
        WHERE user_id IS NOT NULL AND bga_table_id IS NOT NULL
        GROUP BY user_id, bga_table_id HAVING count(*) > 1
      ) duplicates) AS duplicate_groups,
      (SELECT count(*) FROM ONLY public.plays WHERE bga_table_id IS NOT NULL AND user_id IS NULL) AS ownerless_rows
    $query$, true, false, '') ELSE NULL END AS result
),
bga_counts AS (
  SELECT CASE WHEN result IS NOT NULL THEN (xpath('/table/row/duplicate_groups/text()', result))[1]::text::bigint END AS duplicate_groups,
    CASE WHEN result IS NOT NULL THEN (xpath('/table/row/ownerless_rows/text()', result))[1]::text::bigint END AS ownerless_rows
  FROM bga_scan
),
participant_unique AS (
  SELECT ix.indexrelid::regclass::text AS index_name, ix.indimmediate,
    pg_get_indexdef(ix.indexrelid) AS definition
  FROM tables t
  JOIN pg_index ix ON ix.indrelid = t.oid
  WHERE t.table_name = 'play_scores' AND ix.indisunique AND ix.indisvalid
    AND ix.indpred IS NULL AND ix.indexprs IS NULL AND ix.indnkeyatts = 2
    AND (SELECT array_agg(a.attname::text ORDER BY a.attname)
      FROM unnest(ix.indkey::smallint[]) WITH ORDINALITY k(attnum, ordinal)
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum
      WHERE k.ordinal <= ix.indnkeyatts) = ARRAY['play_id', 'player_id']::text[]
),
cascades AS (
  SELECT child.table_name AS child_table, parent.table_name AS parent_table,
    con.conname, pg_get_constraintdef(con.oid) AS definition
  FROM pg_constraint con
  JOIN tables child ON child.oid = con.conrelid
  JOIN tables parent ON parent.oid = con.confrelid
  WHERE con.contype = 'f' AND con.confdeltype = 'c'
    AND ((child.table_name = 'plays' AND parent.table_name = 'games')
      OR (child.table_name = 'play_scores' AND parent.table_name = 'players'))
),
findings(severity, check_id, observed, requirement) AS (
  SELECT CASE WHEN r.rolsuper OR r.rolbypassrls THEN 'PASS' ELSE 'CONDITION' END,
    'data-visibility:role',
    CASE WHEN r.rolsuper OR r.rolbypassrls THEN 'Local audit role bypasses RLS'
      ELSE 'Current role is neither superuser nor BYPASSRLS; full data visibility is not certified' END,
    'Use an authorized local audit role with complete visibility. Active RLS skips BGA scans to avoid false-negative duplicate checks.'
  FROM pg_roles r WHERE r.rolname = current_user
  UNION ALL
  SELECT CASE WHEN problem IS NULL THEN 'PASS' ELSE 'BLOCKER' END,
    'column:' || table_name || '.' || column_name,
    COALESCE(problem, 'compatible') || '; type=' || COALESCE(actual_type, 'missing')
      || '; not_null=' || COALESCE(attnotnull::text, 'missing'),
    type_name || CASE WHEN must_be_not_null THEN ' NOT NULL' ELSE '; legacy NULL values remain subject to editability checks' END
  FROM column_checks
  UNION ALL
  SELECT CASE WHEN EXISTS (
      SELECT 1 FROM pg_index ix JOIN columns c ON c.table_name = t.table_name
        AND c.column_name = 'id' AND c.attnum = ix.indkey[0]
      WHERE ix.indrelid = t.oid AND ix.indisprimary AND ix.indisvalid AND ix.indnkeyatts = 1
    ) THEN 'PASS' ELSE 'BLOCKER' END,
    'primary-key:' || t.table_name,
    COALESCE(t.oid::regclass::text, 'table missing'), 'single-column primary key on id required'
  FROM tables t WHERE t.table_name IN ('plays', 'play_scores', 'games', 'players')
  UNION ALL
  SELECT CASE
      WHEN timestamp_type IS NULL OR timestamp_type NOT IN ('timestamp with time zone', 'timestamp without time zone') THEN 'BLOCKER'
      WHEN tgenabled NOT IN ('O', 'A') OR tgtype <> 19 OR proname <> 'update_updated_at_column' OR NOT references_timestamp THEN 'CONDITION'
      ELSE 'PASS' END,
    'timestamp-trigger:' || table_name || '.' || tgname,
    definition || '; enabled=' || tgenabled::text || '; updated_at=' || COALESCE(timestamp_type, 'missing'),
    'Keep valid BEFORE UPDATE row triggers; repair only a verified orphan trigger. Function-body semantics still require review.'
  FROM timestamp_triggers
  UNION ALL
  SELECT CASE WHEN c.column_name IS NULL THEN 'PASS' ELSE 'CONDITION' END,
    'timestamp-trigger:' || t.table_name || '.absent',
    'No updated_at trigger; column=' || COALESCE(c.actual_type, 'absent'),
    'No timestamp column needs no repair; an existing timestamp column requires an explicit maintenance decision.'
  FROM tables t LEFT JOIN columns c ON c.table_name = t.table_name AND c.column_name = 'updated_at'
  WHERE t.table_name IN ('plays', 'play_scores') AND t.oid IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM timestamp_triggers tr WHERE tr.table_name = t.table_name)
  UNION ALL
  SELECT 'CONDITION', 'participant-unique:' || index_name,
    definition || '; immediate=' || indimmediate::text,
    'Row-by-row player_id swaps can violate an immediate unique index. Define reassignment semantics and test retained score IDs.'
  FROM participant_unique
  UNION ALL
  SELECT 'PASS', 'participant-unique:absent', 'No exact unconditional unique index on (play_id, player_id)',
    'RPC validation must still reject duplicate participants; this finding does not propose adding/removing a constraint.'
  WHERE NOT EXISTS (SELECT 1 FROM participant_unique)
  UNION ALL
  SELECT CASE WHEN duplicate_groups IS NULL THEN 'SKIPPED' WHEN duplicate_groups > 0 THEN 'BLOCKER' ELSE 'PASS' END,
    'bga:duplicate-owner-table', COALESCE(duplicate_groups::text, 'scan unavailable') || ' duplicate groups',
    'Do not pick an arbitrary legacy duplicate with LIMIT 1; decide remediation before considering a partial unique index.'
  FROM bga_counts
  UNION ALL
  SELECT CASE WHEN ownerless_rows IS NULL THEN 'SKIPPED' WHEN ownerless_rows > 0 THEN 'CONDITION' ELSE 'PASS' END,
    'bga:ownerless-imports', COALESCE(ownerless_rows::text, 'scan unavailable') || ' ownerless BGA rows',
    'An import actor cannot identify ownerless legacy rows; preserve them and decide handling explicitly.'
  FROM bga_counts
  UNION ALL
  SELECT 'CONDITION', 'catalog-cascade:' || parent_table || '->' || child_table || ':' || conname, definition,
    'Revoking writes on plays/play_scores does not stop catalog FK cascades. Guard referenced catalog deletes or provide a cooperating transactional path before cutover.'
  FROM cascades
  UNION ALL
  SELECT 'PASS', 'catalog-cascade:absent', 'No inspected games->plays or players->play_scores DELETE CASCADE',
    'This check covers catalog cascades only; deletion through Auth or other dependencies is outside this preflight.'
  WHERE NOT EXISTS (SELECT 1 FROM cascades)
  UNION ALL
  SELECT 'CONDITION', 'other-trigger:' || t.table_name || '.' || tr.tgname, pg_get_triggerdef(tr.oid),
    'Review custom trigger effects and locking before claiming the candidate RPCs are compatible.'
  FROM tables t JOIN pg_trigger tr ON tr.tgrelid = t.oid AND NOT tr.tgisinternal
  WHERE t.table_name IN ('plays', 'play_scores') AND tr.tgenabled IN ('O', 'A')
    AND NOT EXISTS (SELECT 1 FROM timestamp_triggers tt WHERE tt.table_name = t.table_name AND tt.tgname = tr.tgname)
)
SELECT jsonb_build_object(
  'format_version', 1,
  'scope', 'local-schema-compatibility-only',
  'transaction_read_only', current_setting('transaction_read_only'),
  'data_visibility', CASE WHEN EXISTS (SELECT 1 FROM pg_roles WHERE rolname = current_user AND (rolsuper OR rolbypassrls))
    THEN 'unrestricted-role' ELSE 'not-certified' END,
  'status', CASE WHEN count(*) FILTER (WHERE severity = 'BLOCKER') > 0 THEN 'blocked'
    WHEN count(*) FILTER (WHERE severity = 'CONDITION') > 0 THEN 'conditional' ELSE 'compatible' END,
  'blockers', count(*) FILTER (WHERE severity = 'BLOCKER'),
  'conditions', count(*) FILTER (WHERE severity = 'CONDITION'),
  'findings', jsonb_agg(jsonb_build_object('severity', severity, 'check_id', check_id,
    'observed', observed, 'requirement', requirement) ORDER BY check_id)
) AS preflight
FROM findings;
COMMIT;
