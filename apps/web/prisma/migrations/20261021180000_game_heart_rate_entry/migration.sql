-- Expand the existing entry vocabulary without changing per-day attempt caps.
ALTER TABLE "game_entry" DROP CONSTRAINT "game_entry_attempt_check";
ALTER TABLE "game_entry" ADD CONSTRAINT "game_entry_attempt_check"
CHECK ("kind" IN ('photo', 'heart_rate', 'excuse')
  AND "attempt" BETWEEN 0 AND 2
  AND ("attempt" = 0) = ("kind" = 'excuse'));
