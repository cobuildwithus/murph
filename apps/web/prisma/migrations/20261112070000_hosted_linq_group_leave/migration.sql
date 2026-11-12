CREATE TABLE "hosted_linq_group_leave" (
    "thread_identity_lookup_key" TEXT NOT NULL,
    "chat_id_encrypted" TEXT NOT NULL,
    "left_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason" VARCHAR(32) NOT NULL,
    CONSTRAINT "hosted_linq_group_leave_pkey" PRIMARY KEY ("thread_identity_lookup_key"),
    CONSTRAINT "hosted_linq_group_leave_reason_check" CHECK ("reason" IN ('oversized', 'operator_cleanup'))
);
