-- Personality projections may be NULL even when the pre-cutover canonical
-- vault has a chat-only override, so every dial needs the cutover barrier.
UPDATE "hosted_member" AS member
SET
  "assistant_humor_causal_seq" = GREATEST(
    COALESCE(member."assistant_humor_causal_seq", 0),
    COALESCE(causal_counter."next_seq" - 1, 0)
  ),
  "assistant_push_causal_seq" = GREATEST(
    COALESCE(member."assistant_push_causal_seq", 0),
    COALESCE(causal_counter."next_seq" - 1, 0)
  ),
  "assistant_detail_causal_seq" = GREATEST(
    COALESCE(member."assistant_detail_causal_seq", 0),
    COALESCE(causal_counter."next_seq" - 1, 0)
  )
FROM "hosted_mailbox_lane_counter" AS causal_counter
WHERE causal_counter."user_id" = member."id"
  AND causal_counter."lane" = 'causal';
