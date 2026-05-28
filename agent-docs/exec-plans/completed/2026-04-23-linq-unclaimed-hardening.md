Status: active
Created: 2026-04-23
Updated: 2026-04-25

## Goal

- Close the reported Linq correctness and trust-boundary gaps that are not already claimed by the active sparse-recipient fallback or pending-cleanup-retention lanes.

## Success criteria

- Finalize-required hosted runs persist enough durable Linq cleanup state to retry outbound provider-copy deletion after a restart or finalize boundary, not just wake-derived inbound ids.
- Linq DELETE requests retry on the same transient transport and 408/5xx failure classes that the already-idempotent client contract can safely replay.
- The reported inboxd freshness/liveness findings are explicitly recorded as moot in the current checkout because the completed local-Linq removal lane deleted the cited local webhook connector surface.
- The previous hosted Linq control-plane `occurredAt` target is superseded by `2026-04-25-remove-legacy-linq-control-plane.md`, which deletes the legacy `/api/linq/**` surface instead of hardening dead code.
- Focused regressions cover each behavior without widening into the already-active Linq recipient fallback, local Linq removal, or broader cleanup-redesign lanes.

## Scope

- In scope:
- `apps/cloudflare/src/user-runner/{runner-cleanup.ts,runner-run-processor.ts,runner-state-store.ts}`
- `apps/cloudflare/src/{user-runner.ts,user-runner/types.ts}`
- focused `apps/cloudflare/test/{runner-run-processor.test.ts,user-runner-resume-finalize.test.ts,runner-state-store.bundle-slots.test.ts}` only if required
- `packages/operator-config/src/linq-runtime.ts`
- focused `packages/operator-config/test/http-linq-device-runtime.test.ts`
- `packages/messaging-ingress/src/linq-webhook.ts`
- focused `packages/messaging-ingress/test/linq-webhook.test.ts`
- `agent-docs/exec-plans/active/{2026-04-23-linq-unclaimed-hardening.md,COORDINATION_LEDGER.md}`
- Out of scope:
- Sparse hosted recipient-handle fallback already tracked in `2026-04-23-linq-recipient-handle-fallback.md`
- Broad pending-cleanup sidecar retention semantics already tracked in `2026-04-23-runner-linq-cleanup-retry-state.md`
- Local Linq product-surface removal already tracked in `2026-04-23-remove-local-linq.md`
- Legacy hosted `/api/linq/**` control-plane removal tracked in `2026-04-25-remove-legacy-linq-control-plane.md`
- Linq raw-shape minimization, hosted conversation wake adapter cleanup, or broader hosted/webhook redesign

## Constraints

- Preserve unrelated dirty-tree work in the overlapping runner files.
- Keep the runner change additive on top of the current cleanup-sidecar retention work: extend the durable retry inputs instead of replacing that row's local retry-state contract.
- Treat the completed `2026-04-23-remove-local-linq.md` lane as authoritative for the now-deleted local inboxd connector surface; this lane should document that scope mismatch rather than recreate the removed endpoint just to satisfy the stale report.
- Treat this as a high-risk cross-cutting Linq/runtime trust-boundary change: run the full required verification baseline plus the required completion-workflow audit passes.

## Risks and mitigations

1. Risk: extending durable cleanup state could retain stale or duplicate Linq ids indefinitely.
   Mitigation: persist only deduplicated message ids, merge them into the existing sidecar shape, and clear them only after confirmed cleanup.
2. Risk: broadening Linq retries could accidentally replay non-idempotent operations.
   Mitigation: change retry eligibility only for `DELETE`, which the client already models as idempotent by treating `404` as success.
## Tasks

1. Extend pending Linq cleanup persistence so finalize-resume can retry outbound provider-copy deletion as well as inbound wake cleanup.
2. Make Linq DELETE share the transient retry policy already allowed for replay-safe GET-like cleanup failures.
3. Record that the reported inboxd freshness/liveness findings are already moot in the current checkout because the cited local Linq webhook connector has been removed.
4. Align shared Linq canonicalization with the hosted/onboarding `received_at ?? created_at` contract if that shared parser work remains necessary after the legacy hosted control-plane deletion.
5. Run full verification, direct scenario checks, required audits, and the repo commit flow.

## Decisions

- Reuse the existing pending-cleanup sidecar rather than introducing a second durable retry record for Linq cleanup.
- Do not recreate or patch the deleted hosted Linq control-plane just to satisfy the old timestamp-hardening target.

## Verification

- Required commands:
- `pnpm verify:acceptance`
- focused iteration commands for the touched owners while developing, as needed
- `git diff --check`
- Required audits:
- `coverage-write`
- `task-finish-review`
- Direct scenario proof to capture:
- finalize-required Linq cleanup retains outbound provider ids durably across resume/finalize
- the cited inboxd local webhook connector surface is absent in the current checkout because `2026-04-23-remove-local-linq.md` already removed it
- shared Linq `occurredAt` now follows canonical `received_at ?? created_at` if the shared parser work remains in scope
