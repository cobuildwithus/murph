CREATE TABLE "hosted_operator_task" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "requested_by_member_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "request_mailbox_item_id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "result_encrypted" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosted_operator_task_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hosted_operator_task_idempotency_key_key"
ON "hosted_operator_task"("idempotency_key");

CREATE UNIQUE INDEX "hosted_operator_task_request_mailbox_item_id_key"
ON "hosted_operator_task"("request_mailbox_item_id");

CREATE INDEX "hosted_operator_task_member_id_created_at_idx"
ON "hosted_operator_task"("member_id", "created_at");

CREATE INDEX "hosted_operator_task_requested_by_member_id_created_at_idx"
ON "hosted_operator_task"("requested_by_member_id", "created_at");

CREATE INDEX "hosted_operator_task_status_expires_at_idx"
ON "hosted_operator_task"("status", "expires_at");

ALTER TABLE "hosted_operator_task"
ADD CONSTRAINT "hosted_operator_task_member_id_fkey"
FOREIGN KEY ("member_id") REFERENCES "hosted_member"("id")
ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "hosted_operator_task"
ADD CONSTRAINT "hosted_operator_task_requested_by_member_id_fkey"
FOREIGN KEY ("requested_by_member_id") REFERENCES "hosted_member"("id")
ON DELETE SET NULL ON UPDATE CASCADE;
