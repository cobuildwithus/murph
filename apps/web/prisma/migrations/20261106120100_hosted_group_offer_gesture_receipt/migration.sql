CREATE TABLE "hosted_group_offer_gesture_receipt" (
  "id" TEXT NOT NULL,
  "group_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "hosted_group_offer_gesture_receipt_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "hosted_group_offer_gesture_receipt_group_id_fkey"
    FOREIGN KEY ("group_id") REFERENCES "hosted_group"("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "hosted_group_offer_gesture_receipt_group_id_idx"
  ON "hosted_group_offer_gesture_receipt"("group_id");
