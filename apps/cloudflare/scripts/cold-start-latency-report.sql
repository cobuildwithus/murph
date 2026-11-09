\set ON_ERROR_STOP on
\if :{?window_hours}
\else
\set window_hours 24
\endif

-- Prisma DateTime columns are stored as UTC-naive TIMESTAMP(3) values.
-- This aggregate report intentionally compares them with a UTC-naive cutoff
-- and never returns member, mailbox, trace, or attempt identifiers.
\echo 'Temporal activity to runner job by recovery cohort (seconds)'
WITH raw_row_stamps AS (
  SELECT
    runtime_attempt_id,
    EXTRACT(EPOCH FROM (
      runner_job_accepted_at - TIMESTAMP '1970-01-01'
    )) * 1000 AS runner_job_accepted_ms,
    (phase_breakdown_json #>> '{orchestration,temporalActivityStartedAtEpochMs}')::double precision AS activity_started_ms,
    CASE
      WHEN phase_breakdown_json #> '{orchestration,runtimeInvocationOrchestrationAttemptId}' IS NOT NULL
        AND phase_breakdown_json #>> '{orchestration,triggeredByWebDirect}' = 'false'
        THEN NULL
      WHEN phase_breakdown_json #> '{orchestration,runtimeInvocationOrchestrationAttemptId}' IS NOT NULL
        THEN 'temporal_recovery'
      WHEN phase_breakdown_json #>> '{orchestration,triggeredByWebDirect}' = 'false'
        THEN 'temporal_only'
      WHEN phase_breakdown_json #>> '{orchestration,triggeredByWebDirect}' = 'true'
        OR phase_breakdown_json #> '{orchestration,directEnsureRequestStartedAtEpochMs}' IS NOT NULL
        THEN 'legacy_unclassified'
      ELSE NULL
    END AS cohort
  FROM hosted_ingress_latency_trace
  WHERE runner_job_accepted_at >=
      (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - make_interval(hours => :window_hours)
    AND runtime_attempt_id IS NOT NULL
    AND runner_job_accepted_at IS NOT NULL
    AND phase_breakdown_json #> '{orchestration,temporalActivityStartedAtEpochMs}' IS NOT NULL
), row_stamps AS (
  SELECT *
  FROM raw_row_stamps
  WHERE runner_job_accepted_ms >= activity_started_ms
    AND cohort IS NOT NULL
), attempt_stamps AS (
  SELECT DISTINCT
    runtime_attempt_id,
    runner_job_accepted_ms,
    activity_started_ms,
    cohort
  FROM row_stamps
), unambiguous_attempt_stamps AS (
  SELECT
    attempt_stamps.*,
    count(*) OVER (PARTITION BY runtime_attempt_id) AS stamp_candidate_count
  FROM attempt_stamps
), samples AS (
  SELECT
    cohort,
    (runner_job_accepted_ms - activity_started_ms) / 1000 AS duration_seconds
  FROM unambiguous_attempt_stamps
  WHERE stamp_candidate_count = 1
)
SELECT
  cohort,
  count(*) AS samples,
  round(percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_seconds)::numeric, 3) AS p50_seconds,
  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_seconds)::numeric, 3) AS p95_seconds,
  round(max(duration_seconds)::numeric, 3) AS max_seconds
FROM samples
GROUP BY cohort
ORDER BY cohort;
