-- Add encrypted owner-table source fields needed to re-derive hosted blind indexes
-- during future contact-privacy key rotation backfills.

alter table "hosted_member_identity"
  add column if not exists "phone_number_encrypted" text;

alter table "hosted_member_routing"
  add column if not exists "telegram_user_id_encrypted" text;

update "hosted_member_identity"
set "phone_number_encrypted" = "signup_phone_number_encrypted"
where "phone_number_encrypted" is null
  and "signup_phone_number_encrypted" is not null;
