\set QUIET on
BEGIN TRANSACTION READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '2s';
SET LOCAL idle_in_transaction_session_timeout = '25s';

WITH
params AS (
  SELECT
    :'previous_start'::timestamptz AT TIME ZONE 'UTC' AS previous_start,
    :'current_start'::timestamptz AT TIME ZONE 'UTC' AS current_start,
    :'window_end'::timestamptz AT TIME ZONE 'UTC' AS window_end
),
issue_totals AS (
  SELECT
    count(*) FILTER (WHERE issue.occurred_at >= params.current_start)::double precision AS current_total,
    count(*) FILTER (WHERE issue.occurred_at < params.current_start)::double precision AS previous_total
  FROM hosted_assistant_runtime_issue AS issue
  CROSS JOIN params
  WHERE issue.occurred_at >= params.previous_start
    AND issue.occurred_at < params.window_end
    AND issue.environment = 'hosted'
    AND issue.severity IN ('info', 'warning', 'error')
),
issue_fingerprints AS (
  SELECT
    issue.fingerprint,
    issue.component,
    issue.phase,
    issue.severity,
    issue.issue_kind,
    coalesce(issue.error_code, 'none') AS error_code,
    coalesce(issue.operation, 'none') AS operation,
    coalesce(issue.surface, 'none') AS surface,
    count(*) FILTER (WHERE issue.occurred_at >= params.current_start)::integer AS current_count,
    count(*) FILTER (WHERE issue.occurred_at < params.current_start)::integer AS previous_count,
    min(issue.occurred_at) FILTER (WHERE issue.occurred_at >= params.current_start) AS first_seen_at,
    max(issue.occurred_at) FILTER (WHERE issue.occurred_at >= params.current_start) AS last_seen_at
  FROM hosted_assistant_runtime_issue AS issue
  CROSS JOIN params
  WHERE issue.occurred_at >= params.previous_start
    AND issue.occurred_at < params.window_end
    AND issue.environment = 'hosted'
    AND issue.severity IN ('info', 'warning', 'error')
  GROUP BY
    issue.fingerprint,
    issue.component,
    issue.phase,
    issue.severity,
    issue.issue_kind,
    coalesce(issue.error_code, 'none'),
    coalesce(issue.operation, 'none'),
    coalesce(issue.surface, 'none')
  HAVING count(*) FILTER (WHERE issue.occurred_at >= params.current_start) > 0
  ORDER BY
    (
      concat_ws(' ', issue.component, issue.phase, issue.issue_kind, coalesce(issue.error_code, 'none'), coalesce(issue.operation, 'none'), coalesce(issue.surface, 'none'))
      ~* '(auth|billing|canonical|clinical|consent|corrupt|credential|delet|erasure|health|hipaa|idempot|medical|patient|payment|privacy|replay|stripe|subscription|loss)'
    ) DESC,
    current_count DESC,
    previous_count DESC
  LIMIT 13
),
ingress_counts AS (
  SELECT
    trace.source,
    count(*) FILTER (WHERE trace.accepted_at >= params.current_start)::double precision AS current_total,
    count(*) FILTER (WHERE trace.accepted_at < params.current_start)::double precision AS previous_total,
    count(*) FILTER (
      WHERE trace.accepted_at >= params.current_start
        AND trace.accepted_at < params.window_end - interval '5 minutes'
        AND trace.provider_start_at IS NULL
    )::double precision AS current_incomplete,
    count(*) FILTER (
      WHERE trace.accepted_at < params.current_start
        AND trace.accepted_at < params.current_start - interval '5 minutes'
        AND trace.provider_start_at IS NULL
    )::double precision AS previous_incomplete
  FROM hosted_ingress_latency_trace AS trace
  CROSS JOIN params
  WHERE trace.source IN ('linq', 'telegram')
    AND trace.accepted_at >= params.previous_start
    AND trace.accepted_at < params.window_end
  GROUP BY trace.source
  ORDER BY current_total DESC, previous_total DESC
  LIMIT 12
),
latency_current AS (
  SELECT
    trace.source,
    count(*)::integer AS sample_count,
    percentile_cont(0.50) WITHIN GROUP (
      ORDER BY extract(epoch FROM trace.provider_start_at - trace.accepted_at) * 1000
    )::double precision AS p50_ms,
    percentile_cont(0.95) WITHIN GROUP (
      ORDER BY extract(epoch FROM trace.provider_start_at - trace.accepted_at) * 1000
    )::double precision AS p95_ms,
    percentile_cont(0.99) WITHIN GROUP (
      ORDER BY extract(epoch FROM trace.provider_start_at - trace.accepted_at) * 1000
    )::double precision AS p99_ms,
    max(extract(epoch FROM trace.provider_start_at - trace.accepted_at) * 1000)::double precision AS max_ms
  FROM hosted_ingress_latency_trace AS trace
  CROSS JOIN params
  WHERE trace.source IN ('linq', 'telegram')
    AND trace.accepted_at >= params.current_start
    AND trace.accepted_at < params.window_end
    AND trace.provider_start_at IS NOT NULL
    AND trace.provider_start_at >= trace.accepted_at
  GROUP BY trace.source
),
latency_previous AS (
  SELECT
    trace.source,
    count(*)::integer AS sample_count,
    percentile_cont(0.95) WITHIN GROUP (
      ORDER BY extract(epoch FROM trace.provider_start_at - trace.accepted_at) * 1000
    )::double precision AS p95_ms,
    percentile_cont(0.99) WITHIN GROUP (
      ORDER BY extract(epoch FROM trace.provider_start_at - trace.accepted_at) * 1000
    )::double precision AS p99_ms
  FROM hosted_ingress_latency_trace AS trace
  CROSS JOIN params
  WHERE trace.source IN ('linq', 'telegram')
    AND trace.accepted_at >= params.previous_start
    AND trace.accepted_at < params.current_start
    AND trace.provider_start_at IS NOT NULL
    AND trace.provider_start_at >= trace.accepted_at
  GROUP BY trace.source
),
latency_rows AS (
  SELECT
    current.source,
    current.sample_count,
    current.p50_ms,
    current.p95_ms,
    current.p99_ms,
    current.max_ms,
    previous.sample_count AS baseline_count,
    previous.p95_ms AS baseline_p95_ms,
    previous.p99_ms AS baseline_p99_ms
  FROM latency_current AS current
  LEFT JOIN latency_previous AS previous USING (source)
  ORDER BY current.sample_count DESC
  LIMIT 12
),
database_stats AS (
  SELECT
    stats.numbackends::double precision AS connections,
    stats.deadlocks::double precision AS deadlocks_total,
    stats.temp_bytes::double precision AS temp_bytes_total,
    CASE
      WHEN stats.blks_hit + stats.blks_read = 0 THEN 1::double precision
      ELSE stats.blks_hit::double precision / (stats.blks_hit + stats.blks_read)::double precision
    END AS cache_hit_ratio,
    current_setting('max_connections')::double precision AS max_connections
  FROM pg_stat_database AS stats
  WHERE stats.datname = current_database()
),
activity_stats AS (
  SELECT
    count(*) FILTER (WHERE state = 'active')::double precision AS active_sessions,
    count(*) FILTER (WHERE state = 'idle in transaction')::double precision AS idle_in_transaction,
    count(*) FILTER (
      WHERE xact_start IS NOT NULL
        AND clock_timestamp() - xact_start >= interval '5 minutes'
    )::double precision AS long_transactions,
    coalesce(max(
      CASE
        WHEN xact_start IS NOT NULL THEN extract(epoch FROM clock_timestamp() - xact_start) * 1000
        ELSE 0
      END
    ), 0)::double precision AS max_transaction_age_ms
  FROM pg_stat_activity
  WHERE datname = current_database()
    AND pid <> pg_backend_pid()
),
blocked_stats AS (
  SELECT count(DISTINCT waiting.pid)::double precision AS blocked_sessions
  FROM pg_locks AS waiting
  JOIN pg_locks AS holding
    ON holding.locktype = waiting.locktype
    AND holding.database IS NOT DISTINCT FROM waiting.database
    AND holding.relation IS NOT DISTINCT FROM waiting.relation
    AND holding.page IS NOT DISTINCT FROM waiting.page
    AND holding.tuple IS NOT DISTINCT FROM waiting.tuple
    AND holding.virtualxid IS NOT DISTINCT FROM waiting.virtualxid
    AND holding.transactionid IS NOT DISTINCT FROM waiting.transactionid
    AND holding.classid IS NOT DISTINCT FROM waiting.classid
    AND holding.objid IS NOT DISTINCT FROM waiting.objid
    AND holding.objsubid IS NOT DISTINCT FROM waiting.objsubid
    AND holding.pid <> waiting.pid
  WHERE NOT waiting.granted
    AND holding.granted
),
counter_rows AS (
  SELECT jsonb_build_object(
    'metric', 'assistant_issue_count',
    'dimensions', jsonb_build_object('source', 'database'),
    'unit', 'count',
    'current', current_total,
    'previous', previous_total
  ) AS value
  FROM issue_totals

  UNION ALL

  SELECT jsonb_build_object(
    'metric', 'ingress_accepted_count',
    'dimensions', jsonb_build_object('source', 'database', 'surface', source),
    'unit', 'count',
    'current', current_total,
    'previous', previous_total
  )
  FROM ingress_counts

  UNION ALL

  SELECT jsonb_build_object(
    'metric', 'ingress_incomplete_count',
    'dimensions', jsonb_build_object('source', 'database', 'surface', source),
    'unit', 'count',
    'current', current_incomplete,
    'previous', previous_incomplete,
    'sampleCount', current_total,
    'previousSampleCount', previous_total
  )
  FROM ingress_counts

  UNION ALL

  SELECT jsonb_build_object(
    'metric', 'db_connections',
    'dimensions', jsonb_build_object('source', 'database'),
    'unit', 'count',
    'current', connections
  )
  FROM database_stats

  UNION ALL

  SELECT jsonb_build_object(
    'metric', 'db_connection_ratio',
    'dimensions', jsonb_build_object('source', 'database'),
    'unit', 'ratio',
    'current', CASE WHEN max_connections = 0 THEN 0 ELSE connections / max_connections END
  )
  FROM database_stats

  UNION ALL

  SELECT jsonb_build_object(
    'metric', 'db_deadlocks_total',
    'dimensions', jsonb_build_object('source', 'database'),
    'unit', 'count',
    'current', deadlocks_total
  )
  FROM database_stats

  UNION ALL

  SELECT jsonb_build_object(
    'metric', 'db_temp_bytes_total',
    'dimensions', jsonb_build_object('source', 'database'),
    'unit', 'bytes',
    'current', temp_bytes_total
  )
  FROM database_stats

  UNION ALL

  SELECT jsonb_build_object(
    'metric', 'db_cache_hit_ratio',
    'dimensions', jsonb_build_object('source', 'database'),
    'unit', 'ratio',
    'current', cache_hit_ratio
  )
  FROM database_stats

  UNION ALL

  SELECT jsonb_build_object(
    'metric', 'db_active_sessions',
    'dimensions', jsonb_build_object('source', 'database'),
    'unit', 'count',
    'current', active_sessions
  )
  FROM activity_stats

  UNION ALL

  SELECT jsonb_build_object(
    'metric', 'db_idle_in_transaction',
    'dimensions', jsonb_build_object('source', 'database'),
    'unit', 'count',
    'current', idle_in_transaction
  )
  FROM activity_stats

  UNION ALL

  SELECT jsonb_build_object(
    'metric', 'db_long_transaction_count',
    'dimensions', jsonb_build_object('source', 'database'),
    'unit', 'count',
    'current', long_transactions
  )
  FROM activity_stats

  UNION ALL

  SELECT jsonb_build_object(
    'metric', 'db_max_active_transaction_age_ms',
    'dimensions', jsonb_build_object('source', 'database'),
    'unit', 'milliseconds',
    'current', max_transaction_age_ms
  )
  FROM activity_stats

  UNION ALL

  SELECT jsonb_build_object(
    'metric', 'db_blocked_session_count',
    'dimensions', jsonb_build_object('source', 'database'),
    'unit', 'count',
    'current', blocked_sessions
  )
  FROM blocked_stats
),
fingerprint_rows AS (
  SELECT jsonb_build_object(
    'rawFingerprint', concat('issue:', md5(concat_ws(E'\x1f', fingerprint, operation, surface))),
    'source', 'database',
    'component', component,
    'phase', phase,
    'severity', CASE
      WHEN lower(severity) IN ('critical', 'fatal') THEN 'critical'
      WHEN lower(severity) IN ('high', 'error') THEN 'high'
      WHEN lower(severity) IN ('medium', 'warning', 'warn') THEN 'medium'
      ELSE 'low'
    END,
    'issueKind', issue_kind,
    'errorCode', error_code,
    'operation', operation,
    'surface', surface,
    'count', current_count,
    'previousCount', previous_count,
    'firstSeenAt', coalesce(first_seen_at, params.current_start) AT TIME ZONE 'UTC',
    'lastSeenAt', coalesce(last_seen_at, params.current_start) AT TIME ZONE 'UTC'
  ) AS value
  FROM issue_fingerprints
  CROSS JOIN params
)
SELECT jsonb_build_object(
  'schemaVersion', 'prod-watch.adapter-evidence.v1',
  'source', 'database',
  'collectedAt', clock_timestamp(),
  'status', 'ok',
  'auth', 'not_required',
  'freshnessSeconds', 0,
  'releaseContext', '[]'::jsonb,
  'counters', coalesce((SELECT jsonb_agg(value) FROM counter_rows), '[]'::jsonb),
  'latency', coalesce((
    SELECT jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
      'metric', 'ingress_to_provider_ms',
      'dimensions', jsonb_build_object('source', 'database', 'surface', source),
      'count', sample_count,
      'p50Ms', p50_ms,
      'p95Ms', p95_ms,
      'p99Ms', p99_ms,
      'maxMs', max_ms,
      'baselineCount', baseline_count,
      'baselineP95Ms', baseline_p95_ms,
      'baselineP99Ms', baseline_p99_ms
    )) ORDER BY sample_count DESC)
    FROM latency_rows
  ), '[]'::jsonb),
  'fingerprints', coalesce((SELECT jsonb_agg(value) FROM fingerprint_rows), '[]'::jsonb)
)::text;

ROLLBACK;
