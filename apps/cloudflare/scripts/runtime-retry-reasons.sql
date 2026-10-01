-- Default: trailing 24 hours.
-- For a fixed UTC window, replace the first WHERE predicate with both bounds:
--   timestamp >= toDateTime('YYYY-MM-DD HH:MM:SS', 'Etc/UTC')
--   AND timestamp < toDateTime('YYYY-MM-DD HH:MM:SS', 'Etc/UTC')
SELECT
  index1 AS reason,
  if(blob3 = '', 'unattributed', blob3) AS stage,
  SUM(_sample_interval * double1) AS retry_count,
  SUM(_sample_interval * double2) / SUM(_sample_interval) AS average_retry_delay_ms
FROM murph_hosted_runtime_retries
WHERE timestamp > NOW() - INTERVAL '1' DAY
  AND blob1 = 'murph.hosted-runtime-retry.v1'
GROUP BY index1, stage
ORDER BY retry_count DESC, reason, stage;
