ALTER TABLE "hosted_ingress_latency_trace"
  ADD COLUMN "runner_job_accepted_at" TIMESTAMP(3),
  ADD COLUMN "runtime_phase_started_at" TIMESTAMP(3),
  ADD COLUMN "workspace_restore_done_at" TIMESTAMP(3),
  ADD COLUMN "mailbox_import_done_at" TIMESTAMP(3);
