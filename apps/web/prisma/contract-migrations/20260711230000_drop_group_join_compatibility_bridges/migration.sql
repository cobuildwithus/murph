DROP TRIGGER IF EXISTS "hosted_group_join_confirmation_eligibility_bridge"
  ON "hosted_group_member";
DROP FUNCTION IF EXISTS set_hosted_group_join_confirmation_eligibility();

DROP TRIGGER IF EXISTS "hosted_linq_home_participant_clear_bridge"
  ON "hosted_member_routing";
DROP FUNCTION IF EXISTS clear_orphaned_hosted_linq_home_participant();
