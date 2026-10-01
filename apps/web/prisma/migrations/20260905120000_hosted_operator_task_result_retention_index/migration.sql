CREATE INDEX CONCURRENTLY "hosted_operator_task_result_retention_idx"
  ON "hosted_operator_task"("completed_at", "id")
  WHERE "result_encrypted" IS NOT NULL;
