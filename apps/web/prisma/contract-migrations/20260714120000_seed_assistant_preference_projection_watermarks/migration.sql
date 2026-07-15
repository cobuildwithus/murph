UPDATE "hosted_member" AS member
SET
  "assistant_tone_causal_seq" = CASE
    WHEN member."assistant_tone" IS NULL THEN NULL
    ELSE GREATEST(
      COALESCE(member."assistant_tone_causal_seq", 0),
      COALESCE(causal_counter."next_seq" - 1, 0)
    )
  END,
  "assistant_voice_causal_seq" = CASE
    WHEN member."assistant_voice" IS NULL THEN NULL
    ELSE GREATEST(
      COALESCE(member."assistant_voice_causal_seq", 0),
      COALESCE(causal_counter."next_seq" - 1, 0)
    )
  END
FROM "hosted_mailbox_lane_counter" AS causal_counter
WHERE causal_counter."user_id" = member."id"
  AND causal_counter."lane" = 'causal'
  AND (
    member."assistant_tone" IS NOT NULL
    OR member."assistant_voice" IS NOT NULL
  );
