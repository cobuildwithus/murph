DELETE FROM "hosted_linq_delivery" AS "delivery"
WHERE "delivery"."template" IN ('invite_signup', 'invite_signup_fallback')
  AND "delivery"."source_ref" LIKE 'linq-invite-signup:%'
  AND split_part("delivery"."source_ref", ':', 2) <> ''
  AND NOT EXISTS (
    SELECT 1
    FROM "hosted_member" AS "member"
    WHERE "member"."id" = split_part("delivery"."source_ref", ':', 2)
  );
