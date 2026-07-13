DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "hosted_mailbox_item"
    LEFT JOIN "hosted_mailbox_lane_counter"
      ON "hosted_mailbox_lane_counter"."user_id" = "hosted_mailbox_item"."user_id"
      AND "hosted_mailbox_lane_counter"."lane" = "hosted_mailbox_item"."lane"
    WHERE "hosted_mailbox_item"."kind" = 'member.preferences.updated'
      AND "hosted_mailbox_item"."causal_seq" IS NULL
      AND "hosted_mailbox_item"."lane_seq" > COALESCE(
        "hosted_mailbox_lane_counter"."consumed_seq",
        0
      )
  ) THEN
    RAISE EXCEPTION
      'Cannot require preference causal sequences while an unhandled legacy preference item remains.'
      USING ERRCODE = 'check_violation';
  END IF;
END
$$;

ALTER TABLE "hosted_mailbox_item"
  ADD CONSTRAINT "hosted_mailbox_item_preferences_causal_seq_check"
  CHECK (
    "kind" <> 'member.preferences.updated'
    OR "causal_seq" IS NOT NULL
  ) NOT VALID;
