-- Widen the bounded reason set without changing old rows or old writers.
ALTER TABLE "hosted_linq_group_leave"
  DROP CONSTRAINT "hosted_linq_group_leave_reason_check",
  ADD CONSTRAINT "hosted_linq_group_leave_reason_check"
    CHECK ("reason" IN ('oversized', 'operator_cleanup', 'assistant')) NOT VALID;
ALTER TABLE "hosted_linq_group_leave"
  VALIDATE CONSTRAINT "hosted_linq_group_leave_reason_check";
