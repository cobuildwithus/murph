alter table "linq_recipient_binding"
  add column if not exists "recipient_phone_mask" text;

create index if not exists "linq_recipient_binding_user_id_recipient_phone_mask_idx"
  on "linq_recipient_binding" ("user_id", "recipient_phone_mask");
