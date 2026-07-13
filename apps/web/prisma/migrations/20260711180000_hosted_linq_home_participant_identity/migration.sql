ALTER TABLE "hosted_member_routing"
  ADD COLUMN "linq_participant_contact_kind" TEXT,
  ADD COLUMN "linq_participant_contact_lookup_key" TEXT;

-- A warm prior deployment clears only the home-chat columns. Preserve the
-- tuple invariant at the database boundary until those functions have drained.
CREATE FUNCTION clear_orphaned_hosted_linq_home_participant()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."linq_chat_lookup_key" IS NULL THEN
    NEW."linq_participant_contact_kind" = NULL;
    NEW."linq_participant_contact_lookup_key" = NULL;
  END IF;

  RETURN NEW;
END;
$$;

CREATE TRIGGER "hosted_linq_home_participant_clear_bridge"
BEFORE UPDATE OF "linq_chat_lookup_key" ON "hosted_member_routing"
FOR EACH ROW
EXECUTE FUNCTION clear_orphaned_hosted_linq_home_participant();
