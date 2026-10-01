ALTER TABLE "hosted_operator_task" ADD COLUMN "feedback_id" TEXT;
ALTER TABLE "hosted_operator_task" ADD CONSTRAINT "hosted_operator_task_feedback_id_fkey"
  FOREIGN KEY ("feedback_id") REFERENCES "hosted_product_feedback"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "hosted_operator_task_feedback_id_created_at_idx" ON "hosted_operator_task"("feedback_id", "created_at");
ALTER TABLE "hosted_ai_usage" ADD COLUMN "operator_task_id" TEXT;
