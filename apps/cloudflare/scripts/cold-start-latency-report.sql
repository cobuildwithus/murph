\set ON_ERROR_STOP on
\if :{?window_hours}
\else
\set window_hours 24
\endif

-- Prisma DateTime columns are stored as UTC-naive TIMESTAMP(3) values.
-- This aggregate report intentionally compares them with a UTC-naive cutoff
-- and never returns member, mailbox, trace, or attempt identifiers.
\echo 'Typing shell-prewarm cohorts (milliseconds)'
WITH direct_candidates AS (
  SELECT
    trace.accepted_at,
    trace.runner_job_accepted_at,
    trace.provider_start_at,
    delivery.accepted_at AS reply_accepted_at,
    trace.runtime_attempt_id,
    trace.phase_breakdown_json #> '{orchestration}' AS orchestration,
    count(*) OVER (
      PARTITION BY trace.runtime_attempt_id
    ) AS causal_candidate_count
  FROM hosted_ingress_latency_trace AS trace
  INNER JOIN hosted_linq_delivery AS delivery
    ON delivery.id = trace.linq_delivery_id
  WHERE trace.accepted_at >=
      (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - make_interval(hours => :window_hours)
    AND trace.source = 'linq'
    AND trace.runtime_attempt_id IS NOT NULL
    AND trace.reply_runtime_attempt_id = trace.runtime_attempt_id
    AND trace.runner_job_accepted_at >= trace.accepted_at
    AND trace.provider_start_at >= trace.accepted_at
    AND delivery.accepted_at >= trace.accepted_at
    AND trace.phase_breakdown_json #>> '{orchestration,triggeredByWebDirect}' = 'true'
    AND trace.phase_breakdown_json #> '{orchestration,freshStartRequestedAtEpochMs}' IS NOT NULL
    AND trace.phase_breakdown_json #>> '{orchestration,directEnsureOrchestrationAttemptId}' =
      trace.phase_breakdown_json #>> '{orchestration,runtimeInvocationOrchestrationAttemptId}'
    AND trace.phase_breakdown_json #> '{orchestration,directEnsureOrchestrationAttemptId}' IS NOT NULL
    AND (trace.phase_breakdown_json #>> '{orchestration,directEnsureRequestStartedAtEpochMs}')::double precision >=
      EXTRACT(EPOCH FROM (trace.accepted_at - TIMESTAMP '1970-01-01')) * 1000
    AND (trace.phase_breakdown_json #>> '{orchestration,directEnsureResponseReceivedAtEpochMs}')::double precision >=
      (trace.phase_breakdown_json #>> '{orchestration,directEnsureRequestStartedAtEpochMs}')::double precision
    AND (
      (
        trace.phase_breakdown_json #>> '{orchestration,shellPrewarmSource}' = 'linq-typing-started'
        AND trace.phase_breakdown_json #>> '{orchestration,shellPrewarmOutcome}' IN (
          'cold_start_observed',
          'failed',
          'start_issued_warm',
          'superseded'
        )
        AND (trace.phase_breakdown_json #>> '{orchestration,shellPrewarmFirstHintAtEpochMs}')::double precision <=
          EXTRACT(EPOCH FROM (trace.accepted_at - TIMESTAMP '1970-01-01')) * 1000
      )
      OR (
        trace.phase_breakdown_json #> '{orchestration,shellPrewarmSource}' IS NULL
        AND trace.phase_breakdown_json #> '{orchestration,shellPrewarmOutcome}' IS NULL
        AND trace.phase_breakdown_json #> '{orchestration,shellPrewarmFirstHintAtEpochMs}' IS NULL
      )
    )
), attempt_samples AS (
  SELECT
    accepted_at,
    runner_job_accepted_at,
    provider_start_at,
    reply_accepted_at,
    orchestration,
    CASE
      WHEN orchestration ->> 'shellPrewarmSource' = 'linq-typing-started'
        THEN 'prewarm_' || (orchestration ->> 'shellPrewarmOutcome')
      ELSE 'no_observed_prewarm'
    END AS cohort
  FROM direct_candidates
  WHERE causal_candidate_count = 1
), metric_samples AS (
  SELECT
    cohort,
    metric.name,
    metric.duration_ms
  FROM attempt_samples
  CROSS JOIN LATERAL (
    VALUES
      (
        'Causal typing hint -> ingress accepted',
        EXTRACT(EPOCH FROM (accepted_at - TIMESTAMP '1970-01-01')) * 1000
          - (orchestration ->> 'shellPrewarmFirstHintAtEpochMs')::double precision
      ),
      (
        'Ingress accepted -> runner job',
        EXTRACT(EPOCH FROM (runner_job_accepted_at - accepted_at)) * 1000
      ),
      (
        'Ingress accepted -> provider start',
        EXTRACT(EPOCH FROM (provider_start_at - accepted_at)) * 1000
      ),
      (
        'Ingress accepted -> reply accepted',
        EXTRACT(EPOCH FROM (reply_accepted_at - accepted_at)) * 1000
      )
  ) AS metric(name, duration_ms)
  WHERE metric.duration_ms >= 0
)
SELECT
  cohort,
  name AS metric,
  count(*) AS samples,
  round(percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_ms)::numeric, 1) AS p50_ms,
  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_ms)::numeric, 1) AS p95_ms,
  round(max(duration_ms)::numeric, 1) AS max_ms
FROM metric_samples
GROUP BY cohort, name
ORDER BY cohort, name;

\echo 'Causal direct cold start: accepted to runner job (seconds)'
WITH direct_rows AS (
  SELECT
    accepted_at,
    runner_job_accepted_at,
    runtime_attempt_id,
    EXTRACT(EPOCH FROM (accepted_at - TIMESTAMP '1970-01-01')) * 1000 AS accepted_ms,
    (phase_breakdown_json #>> '{orchestration,directEnsureRequestStartedAtEpochMs}')::double precision AS direct_start_ms,
    (phase_breakdown_json #>> '{orchestration,directEnsureResponseReceivedAtEpochMs}')::double precision AS direct_response_ms,
    (phase_breakdown_json #>> '{orchestration,cloudflareRouteReceivedAtEpochMs}')::double precision AS route_received_ms,
    phase_breakdown_json #>> '{orchestration,directEnsureOrchestrationAttemptId}' AS direct_orchestration_attempt_id,
    phase_breakdown_json #>> '{orchestration,runtimeInvocationOrchestrationAttemptId}' AS runtime_orchestration_attempt_id
  FROM hosted_ingress_latency_trace
  WHERE accepted_at >=
      (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - make_interval(hours => :window_hours)
    AND runtime_attempt_id IS NOT NULL
    AND runner_job_accepted_at IS NOT NULL
    AND runner_job_accepted_at >= accepted_at
    AND phase_breakdown_json #>> '{orchestration,triggeredByWebDirect}' = 'true'
    AND phase_breakdown_json #> '{orchestration,freshStartRequestedAtEpochMs}' IS NOT NULL
), direct_causal_candidates AS (
  SELECT
    direct_rows.*,
    count(*) OVER (PARTITION BY runtime_attempt_id) AS causal_candidate_count
  FROM direct_rows
  WHERE direct_orchestration_attempt_id = runtime_orchestration_attempt_id
    AND direct_orchestration_attempt_id IS NOT NULL
    AND direct_start_ms >= accepted_ms
    AND direct_response_ms >= direct_start_ms
), samples AS (
  SELECT
    EXTRACT(EPOCH FROM (runner_job_accepted_at - accepted_at)) AS duration_seconds
  FROM direct_causal_candidates
  WHERE causal_candidate_count = 1
)
SELECT
  'web_direct_cold' AS cohort,
  count(*) AS samples,
  round(percentile_cont(0.50) WITHIN GROUP (ORDER BY duration_seconds)::numeric, 3) AS p50_seconds,
  round(percentile_cont(0.95) WITHIN GROUP (ORDER BY duration_seconds)::numeric, 3) AS p95_seconds,
  round(max(duration_seconds)::numeric, 3) AS max_seconds
FROM samples
HAVING count(*) > 0;

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

\echo 'Direct cold-start Cloudflare control-plane phases (milliseconds)'
WITH direct_rows AS (
  SELECT
    accepted_at,
    runner_job_accepted_at,
    runtime_attempt_id,
    phase_breakdown_json #> '{orchestration}' AS orchestration,
    EXTRACT(EPOCH FROM (accepted_at - TIMESTAMP '1970-01-01')) * 1000 AS accepted_ms,
    (phase_breakdown_json #>> '{orchestration,directEnsureRequestStartedAtEpochMs}')::double precision AS direct_start_ms,
    (phase_breakdown_json #>> '{orchestration,directEnsureResponseReceivedAtEpochMs}')::double precision AS direct_response_ms,
    (phase_breakdown_json #>> '{orchestration,cloudflareRouteReceivedAtEpochMs}')::double precision AS route_received_ms,
    phase_breakdown_json #>> '{orchestration,directEnsureOrchestrationAttemptId}' AS direct_orchestration_attempt_id,
    phase_breakdown_json #>> '{orchestration,runtimeInvocationOrchestrationAttemptId}' AS runtime_orchestration_attempt_id
  FROM hosted_ingress_latency_trace
  WHERE accepted_at >=
      (CURRENT_TIMESTAMP AT TIME ZONE 'UTC') - make_interval(hours => :window_hours)
    AND runtime_attempt_id IS NOT NULL
    AND runner_job_accepted_at IS NOT NULL
    AND runner_job_accepted_at >= accepted_at
    AND phase_breakdown_json #>> '{orchestration,triggeredByWebDirect}' = 'true'
    AND phase_breakdown_json #> '{orchestration,freshStartRequestedAtEpochMs}' IS NOT NULL
), direct_causal_candidates AS (
  SELECT
    direct_rows.*,
    count(*) OVER (PARTITION BY runtime_attempt_id) AS causal_candidate_count
  FROM direct_rows
  WHERE direct_orchestration_attempt_id = runtime_orchestration_attempt_id
    AND direct_orchestration_attempt_id IS NOT NULL
    AND direct_start_ms >= accepted_ms
    AND direct_response_ms >= direct_start_ms
), stamps AS (
  SELECT
    accepted_ms,
    EXTRACT(EPOCH FROM (runner_job_accepted_at - TIMESTAMP '1970-01-01')) * 1000 AS runner_job_accepted_ms,
    route_received_ms,
    (orchestration ->> 'userRunnerRpcStartedAtEpochMs')::double precision AS runner_rpc_started_ms,
    (orchestration ->> 'runtimeConsentLockAcquiredAtEpochMs')::double precision AS consent_lock_acquired_ms,
    (orchestration ->> 'healthDataAdmissionReadStartedAtEpochMs')::double precision AS admission_started_ms,
    (orchestration ->> 'healthDataAdmissionReadFinishedAtEpochMs')::double precision AS admission_finished_ms,
    (orchestration ->> 'userRunnerEnsureStartedAtEpochMs')::double precision AS controller_started_ms,
    (orchestration ->> 'runnerStateBindStartedAtEpochMs')::double precision AS state_bind_started_ms,
    (orchestration ->> 'runnerStateBindFinishedAtEpochMs')::double precision AS state_bind_finished_ms,
    (orchestration ->> 'runnerStateReadStartedAtEpochMs')::double precision AS state_read_started_ms,
    (orchestration ->> 'runnerStateReadFinishedAtEpochMs')::double precision AS state_read_finished_ms,
    (orchestration ->> 'freshStartRequestedAtEpochMs')::double precision AS fresh_start_requested_ms,
    (orchestration ->> 'freshStartFenceBoundAtEpochMs')::double precision AS fresh_start_fence_bound_ms,
    (orchestration ->> 'freshStartContainerReadyAtEpochMs')::double precision AS fresh_start_container_ready_ms,
    (orchestration ->> 'freshStartInvocationPreparedAtEpochMs')::double precision AS fresh_start_invocation_prepared_ms,
    (orchestration ->> 'freshStartInvocationAcceptedAtEpochMs')::double precision AS fresh_start_invocation_accepted_ms
  FROM direct_causal_candidates
  WHERE causal_candidate_count = 1
), phase_samples AS (
  SELECT
    phase.name,
    phase.duration_ms
  FROM stamps
  CROSS JOIN LATERAL (
    VALUES
      ('Accepted -> Cloudflare route', route_received_ms - accepted_ms),
      ('Cloudflare route -> UserRunner RPC', runner_rpc_started_ms - route_received_ms),
      ('UserRunner RPC -> consent lock', consent_lock_acquired_ms - runner_rpc_started_ms),
      ('Health-data admission callback', admission_finished_ms - admission_started_ms),
      ('Admission complete -> controller', controller_started_ms - admission_finished_ms),
      ('Runner state bind', state_bind_finished_ms - state_bind_started_ms),
      ('Runner state read', state_read_finished_ms - state_read_started_ms),
      ('State ready -> fresh start request', fresh_start_requested_ms - state_read_finished_ms),
      ('Fresh start request -> fence bound', fresh_start_fence_bound_ms - fresh_start_requested_ms),
      ('Fence bound -> container ready', fresh_start_container_ready_ms - fresh_start_fence_bound_ms),
      ('Fence bound -> invocation prepared', fresh_start_invocation_prepared_ms - fresh_start_fence_bound_ms),
      ('Fresh-start parallel preparation', GREATEST(fresh_start_container_ready_ms, fresh_start_invocation_prepared_ms) - fresh_start_fence_bound_ms),
      ('Parallel preparation -> invocation launched', fresh_start_invocation_accepted_ms - GREATEST(fresh_start_container_ready_ms, fresh_start_invocation_prepared_ms)),
      ('Invocation launched -> runner job accepted', runner_job_accepted_ms - fresh_start_invocation_accepted_ms),
      ('Cloudflare route -> fresh start request', fresh_start_requested_ms - route_received_ms),
      ('Accepted -> runner job', runner_job_accepted_ms - accepted_ms)
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
    WHEN 'Accepted -> Cloudflare route' THEN 1
    WHEN 'Cloudflare route -> UserRunner RPC' THEN 2
    WHEN 'UserRunner RPC -> consent lock' THEN 3
    WHEN 'Health-data admission callback' THEN 4
    WHEN 'Admission complete -> controller' THEN 5
    WHEN 'Runner state bind' THEN 6
    WHEN 'Runner state read' THEN 7
    WHEN 'State ready -> fresh start request' THEN 8
    WHEN 'Fresh start request -> fence bound' THEN 9
    WHEN 'Fence bound -> container ready' THEN 10
    WHEN 'Fence bound -> invocation prepared' THEN 11
    WHEN 'Fresh-start parallel preparation' THEN 12
    WHEN 'Parallel preparation -> invocation launched' THEN 13
    WHEN 'Invocation launched -> runner job accepted' THEN 14
    WHEN 'Cloudflare route -> fresh start request' THEN 15
    ELSE 16
  END
);
