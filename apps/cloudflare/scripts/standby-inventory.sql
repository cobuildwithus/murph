-- Default: trailing 7 days, grouped by UTC day.
-- For a fixed UTC window, replace the first WHERE predicate with both bounds:
--   timestamp >= toDateTime('YYYY-MM-DD HH:MM:SS', 'Etc/UTC')
--   AND timestamp < toDateTime('YYYY-MM-DD HH:MM:SS', 'Etc/UTC')
-- Claim rows: `ready` is the ready inventory before selection. A `claimed`
-- row with target = 2 and ready = 1 arrived while another claim was still refilling; `no_ready_slot` fell back to a cold allocation.
-- Prepare rows: `ready` is the ready inventory after the preparation result,
-- and the duration columns measure refill, resume and reproof latency.
SELECT
  toStartOfInterval(timestamp, INTERVAL '1' DAY) AS day,
  blob2 AS event,
  blob3 AS detail,
  blob4 AS outcome,
  double2 AS ready,
  double4 AS target,
  SUM(_sample_interval * double1) AS events,
  SUM(_sample_interval * double5) / SUM(_sample_interval) AS average_duration_ms,
  quantileExactWeighted(0.95)(double5, _sample_interval) AS p95_duration_ms,
  MAX(double5) AS max_duration_ms
FROM murph_hosted_standby_inventory
WHERE timestamp > NOW() - INTERVAL '7' DAY
  AND blob1 = 'murph.hosted-standby-inventory.v1'
GROUP BY day, event, detail, outcome, ready, target
ORDER BY day, event, detail, outcome, ready;
