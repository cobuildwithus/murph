SELECT
  index1 AS reason,
  SUM(_sample_interval * double1) AS retry_count,
  SUM(_sample_interval * double2) / SUM(_sample_interval) AS average_retry_delay_ms
FROM murph_hosted_runtime_retries
WHERE timestamp > NOW() - INTERVAL '1' DAY
  AND blob1 = 'murph.hosted-runtime-retry.v1'
GROUP BY index1
ORDER BY retry_count DESC;
