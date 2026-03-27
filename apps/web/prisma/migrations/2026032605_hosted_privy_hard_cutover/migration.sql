drop table if exists "hosted_passkey_challenge";

drop table if exists "hosted_passkey";

alter table "hosted_member"
  drop column if exists "webauthn_user_id";

drop type if exists "HostedPasskeyChallengeType";
