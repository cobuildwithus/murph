WITH ranked_days AS (
  SELECT member_id, day, row_number() OVER (PARTITION BY member_id ORDER BY day DESC) AS position
  FROM health_win_set
)
DELETE FROM health_win_set AS win_set
USING ranked_days
WHERE ranked_days.position > 3
  AND win_set.member_id = ranked_days.member_id
  AND win_set.day = ranked_days.day;
