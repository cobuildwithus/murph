# Computer-use review fixes

## Goal

Resolve accepted ReviewGPT round 2 findings for the hosted computer-use PR while
keeping the architecture simple: one durable `computer_pause_for_user`
checkpoint primitive, web-owned browser lifecycle state, and narrow signed
runner callbacks.

Success criteria:

- Computer-use internal routes require the active runtime write fence.
- Handoff live views are allowlisted in both CSP and service validation.
- Computer-use state participates in account export, deletion, and retention.
- Same-turn computer tools serialize around pause checkpoints.
- Pause messages use a required delivery path instead of best-effort progress
  quota behavior.
- Handoff completion and browser cleanup are idempotent/retryable.
- Unused encrypted CDP state is removed.
- Focused tests, required local audits, and the external ReviewGPT loop pass.

## Constraints

- Preserve the generic `computer_pause_for_user` primitive; do not add a
  one-off final-confirmation tool.
- Prefer deletion and direct helpers over new managers or broad abstractions.
- Keep Kernel API keys, browser URLs, tokens, local paths, and direct personal
  identifiers out of committed artifacts and handoff text.
- Web owns Kernel browser/profile lifecycle; Cloudflare receives only signed
  narrow internal callbacks.

## Approach

1. Re-inspect affected code paths and tests.
2. Patch the review findings at the owning boundary with focused tests.
3. Update durable docs only where the runtime/env contract changed.
4. Run required verification and local audit passes.
5. Commit, push, and rerun the PR ReviewGPT loop.

## State

Completed.

## Notes

- Round 1 was blocked because the branch was not pushed.
- Round 2 found concrete issues in the Cloudflare write fence, handoff CSP,
  account privacy lifecycle, dynamic-tool ordering, pause delivery, handoff
  idempotency, browser cleanup retries, and unused CDP secret state.
- Local re-review confirmed the follow-up fixes for account-deletion race,
  stale checkpointing recovery, and computer-tool execution gating.
- `pnpm test:diff` passed after focused web, assistant-engine, Cloudflare, and
  hosted-execution checks.
Status: completed
Updated: 2026-06-18
Completed: 2026-06-18
