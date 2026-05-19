CREATE INDEX CONCURRENTLY "device_connection_due_reconcile_sweep_idx"
  ON "device_connection"("status", "next_reconcile_at", "updated_at", "id");
