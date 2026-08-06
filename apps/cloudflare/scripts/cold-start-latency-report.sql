\set ON_ERROR_STOP on
\if :{?window_hours}
\else
\set window_hours 24
\endif

-- Prisma DateTime columns are stored as UTC-naive TIMESTAMP(3) values.
-- This aggregate report intentionally compares them with a UTC-naive cutoff
-- and never returns member, mailbox, trace, or attempt identifiers.
\echo 'Accepted to runner job by causal cohort (seconds)'
WITH candidates AS (
  SELECT
    accepted_at,
    runner_job_accepted_at,
    runtime_attempt_id,
    CASE
      WHEN phase_breakdown_json #>> '{orchestration,triggeredByWebDirect}' = 'true'
        AND phase_breakdown_json #> '{orchestration,freshStartRequestedAtEpochMs}' IS NOT NULL
        THEN 'web_direct_cold'
      WHEN phase_breakdown_json #>> '{orchestration,triggeredByWebDirect}' = 'true'
        THEN 'web_direct_existing_runtime'
      WHEN phase_breakdown_json #> '{orchestration,temporalActivityStartedAtEpochMs}' IS NOT NULL
        AND phase_breakdown_json #> '{orchestration,directEnsureRequestStartedAtEpochMs}' IS NOT NULL
        THEN 'temporal_recovery'
      WHEN phase_breakdown_json #> '{orchestration,temporalActivityStartedAtEpochMs}' IS NOT NULL
        THEN 'temporal_only'
      ELSE 'unclassified'
    END AS cohort,
    row_number() OVER (
      PARTITION BY runtime_attempt_id
      ORDER BY accepted_at ASC, id ASC
    ) AS attempt_row
  FROM hosted_ingress_latency_trace
  WHERE accepted_at >=
      (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - make_interval(hours => :window_hours)
    AND runtime_attempt_id IS NOT NULL
    AND runner_job_accepted_at IS NOT NULL
    AND runner_job_accepted_at >= accepted_at
), samples AS (
  SELECT
    cohort,
    EXTRACT(EPOCH FROM (runner_job_accepted_at - accepted_at)) AS duration_seconds
  FROM candidates
  WHERE attempt_row = 1
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

\echo 'Direct cold-start Cloudflare control-plane phases (milliseconds)'
WITH candidates AS (
  SELECT
    id,
    accepted_at,
    runner_job_accepted_at,
    runtime_attempt_id,
    phase_breakdown_json #> '{orchestration}' AS orchestration,
    row_number() OVER (
      PARTITION BY runtime_attempt_id
      ORDER BY accepted_at ASC, id ASC
    ) AS attempt_row
  FROM hosted_ingress_latency_trace
  WHERE accepted_at >=
      (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - make_interval(hours => :window_hours)
    AND runtime_attempt_id IS NOT NULL
    AND runner_job_accepted_at IS NOT NULL
    AND runner_job_accepted_at >= accepted_at
    AND phase_breakdown_json #>> '{orchestration,triggeredByWebDirect}' = 'true'
    AND phase_breakdown_json #> '{orchestration,freshStartRequestedAtEpochMs}' IS NOT NULL
), stamps AS (
  SELECT
    (orchestration ->> 'cloudflareRouteReceivedAtEpochMs')::double precision AS route_received_ms,
    (orchestration ->> 'userRunnerRpcStartedAtEpochMs')::double precision AS runner_rpc_started_ms,
    (orchestration ->> 'runtimeConsentLockAcquiredAtEpochMs')::double precision AS consent_lock_acquired_ms,
    (orchestration ->> 'healthDataAdmissionReadStartedAtEpochMs')::double precision AS admission_started_ms,
    (orchestration ->> 'healthDataAdmissionReadFinishedAtEpochMs')::double precision AS admission_finished_ms,
    (orchestration ->> 'userRunnerEnsureStartedAtEpochMs')::double precision AS controller_started_ms,
    (orchestration ->> 'runnerStateBindStartedAtEpochMs')::double precision AS state_bind_started_ms,
    (orchestration ->> 'runnerStateBindFinishedAtEpochMs')::double precision AS state_bind_finished_ms,
    (orchestration ->> 'runnerStateReadStartedAtEpochMs')::double precision AS state_read_started_ms,
    (orchestration ->> 'runnerStateReadFinishedAtEpochMs')::double precision AS state_read_finished_ms,
    (orchestration ->> 'freshStartRequestedAtEpochMs')::double precision AS fresh_start_requested_ms
  FROM candidates
  WHERE attempt_row = 1
), phase_samples AS (
  SELECT
    phase.name,
    phase.duration_ms
  FROM stamps
  CROSS JOIN LATERAL (
    VALUES
      ('Cloudflare route -> UserRunner RPC', runner_rpc_started_ms - route_received_ms),
      ('UserRunner RPC -> consent lock', consent_lock_acquired_ms - runner_rpc_started_ms),
      ('Health-data admission callback', admission_finished_ms - admission_started_ms),
      ('Admission complete -> controller', controller_started_ms - admission_finished_ms),
      ('Runner state bind', state_bind_finished_ms - state_bind_started_ms),
      ('Runner state read', state_read_finished_ms - state_read_started_ms),
      ('State ready -> fresh start request', fresh_start_requested_ms - state_read_finished_ms),
      ('Cloudflare route -> fresh start request', fresh_start_requested_ms - route_received_ms)
  ) AS phase(name, duration_ms)
  WHERE phase.duration_ms >= 0
)
SELECT
  name AS phase,
  count(*) AS samples,
  round(percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms)::numeric, 1) AS p50_ms,
  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::numeric, 1) AS p95_ms,
  round(max(duration_ms)::numeric, 1) AS max_ms
FROM phase_samples
GROUP BY name
ORDER BY min(
  CASE name
    WHEN 'Cloudflare route -> UserRunner RPC' THEN 1
    WHEN 'UserRunner RPC -> consent lock' THEN 2
    WHEN 'Health-data admission callback' THEN 3
    WHEN 'Admission complete -> controller' THEN 4
    WHEN 'Runner state bind' THEN 5
    WHEN 'Runner state read' THEN 6
    WHEN 'State ready -> fresh start request' THEN 7
    ELSE 8
  END
);
