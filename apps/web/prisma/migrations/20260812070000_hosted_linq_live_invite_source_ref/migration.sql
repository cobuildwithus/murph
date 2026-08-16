CREATE INDEX CONCURRENTLY "hosted_linq_delivery_live_invite_source_ref_pattern_idx"
  ON "hosted_linq_delivery"("source_ref" text_pattern_ops)
  WHERE "source_ref" IS NOT NULL
    AND "template" IN ('invite_signup', 'invite_signup_fallback')
    AND "status" IN (
      'attempted',
      'provider_dispatch_started',
      'accepted',
      'delivered'
    );
