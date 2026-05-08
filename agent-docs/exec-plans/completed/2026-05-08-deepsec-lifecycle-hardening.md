# DeepSec Lifecycle Hardening

## Goal

Resolve the real, high-value DeepSec findings with simple durable fixes:
keep provider/network side effects out of DB transactions where feasible,
make post-commit wake handoff failures non-destructive, and tighten small
shared hardening gaps around redaction, lock reentrancy, attachment evidence
limits, and smoke PID cleanup.

## Constraints

- Preserve unrelated dirty work in the current checkout.
- Avoid broad refactors, new durable state, or new dependencies.
- Prefer existing store/service boundaries and focused regression tests.
- Keep security/privacy-sensitive output redacted.

## Working Set

- `apps/web/src/lib/device-sync/agent-session-service.ts`
- `apps/web/src/lib/device-sync/wake-service.ts`
- `apps/web/scripts/dev-smoke.ts`
- `packages/assistant-engine/src/assistant/redaction.ts`
- `packages/assistant-engine/src/assistant/inbox-attachment-evidence.ts`
- `packages/runtime-state/src/locks.ts`
- Focused tests near the touched owners.

## State

- Done: token refresh provider calls moved out of DB transactions with current-token rechecks, public response credential leakage removed, post-commit wake workflow starts made best-effort, dev-smoke PID cleanup restricted to recognizable Next owners, assistant redaction/evidence caps tightened, and same-owner directory lock reentry constrained to the same lock identity.
- Now: focused verification passed for touched owners; broad workspace verification is blocked by unrelated dirty Cloudflare/runtime-state work.
- Next: hand off without a scoped commit because the checkout contains substantial unrelated dirty work in overlapping verification owners.
Status: completed
Updated: 2026-05-08
Completed: 2026-05-08
