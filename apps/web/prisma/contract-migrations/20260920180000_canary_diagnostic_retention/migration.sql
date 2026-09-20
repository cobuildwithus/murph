-- Diagnostic retention is independent of mailbox content retention. Ordinary
-- account deletion explicitly removes these rows; fixed canary resets retain
-- them for the existing time-bounded diagnostic sweep.
-- Deploy the member-fenced trace writers and drain old Web instances first.
ALTER TABLE "hosted_ingress_latency_trace"
  DROP CONSTRAINT IF EXISTS "hosted_ingress_latency_trace_user_id_mailbox_item_id_fkey";
