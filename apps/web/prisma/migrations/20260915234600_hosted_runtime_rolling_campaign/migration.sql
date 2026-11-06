-- Rolling is a discovery/compatibility campaign, not an execution pause.
ALTER TABLE hosted_runtime_cutover DROP CONSTRAINT hosted_runtime_cutover_phase_check;
ALTER TABLE hosted_runtime_cutover ADD CONSTRAINT hosted_runtime_cutover_phase_check
  CHECK (phase IN ('legacy', 'rolling', 'draining', 'postgres'));
