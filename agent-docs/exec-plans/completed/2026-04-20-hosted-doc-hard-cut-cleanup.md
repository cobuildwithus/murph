## Title

Hard-cut hosted execution docs to the run-centric model.

## Goal

Remove stale hosted execution wording from the current canonical docs so they describe the greenfield hard-cut accurately: web owns ingress and run recovery truth, Cloudflare is execution-only, and the old wake-by-wake compatibility lane is gone.

## Scope

- `agent-docs/references/hosted-run-protocol.md`
- `apps/web/README.md`
- `ARCHITECTURE.md`
- `agent-docs/references/data-model-seams.md`
- `agent-docs/operations/verification-and-runtime.md`
- `packages/cloudflare-hosted-control/README.md`

## Constraints

- Keep this as a docs/process-only cleanup; do not broaden into runtime, schema, or package code.
- Preserve unrelated dirty-tree edits and active hosted-run / hosted-wake implementation rows.
- Describe the run-centric hard cut directly; do not leave “compatibility lane” wording behind.
- Remove stale references to legacy wake fallback, terminal receipts, fetch proofs, pending-commit DO state, `assistantNextWakeAt`, and `HostedWake` as the final mental model.

## Verification

- planned: direct readback of the touched docs
- planned: `git diff --check`

## Notes

- The final executor-facing mental model is `acquire hosted run` -> `runDrain` -> commit/finalize via web-owned run state.
- `HostedWake` may still appear only as ingress terminology where needed, not as the final runtime protocol description.
