ALTER TABLE "hosted_member_routing"
  ADD COLUMN "pending_linq_new_chat_reservation_key" TEXT,
  ADD COLUMN "pending_linq_new_chat_reserved_at" TIMESTAMP(3);

CREATE UNIQUE INDEX "hosted_member_routing_pending_linq_new_chat_reservation_key_key"
  ON "hosted_member_routing"("pending_linq_new_chat_reservation_key");
