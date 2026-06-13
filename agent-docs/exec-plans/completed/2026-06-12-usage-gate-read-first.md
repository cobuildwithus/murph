Goal (incl. success criteria):
- Stop running the mutating AI usage-allowance gate transaction (period upsert + lock + carryover) multiple times per inbound message on the reply hot path.
- One owner: the Temporal admission check (reconciliation facts) keeps the mutating gate and owns period-row lifecycle; all other gate call sites use a read-first check that only escalates to the mutating gate when the read decision would block AI work.
- Success means: webhook planner, mailbox fetch, payload fetch, and manual-wake assert do zero usage-period writes on the steady-state allow path; denial decisions remain identical to today (read-deny is always confirmed by the mutating gate before acting); reconciliation-facts admission behavior is unchanged.

Constraints/Assumptions:
- Web stays the owner of usage-allowance decisions (per hosted Temporal ADR); no new persisted state, no schema changes.
- Admission (reconciliation facts) runs the mutating gate before every conversation turn (`hostedRuntimeReconciliationNeedsAiUsageGate` returns true on conversation-lane lag), so period bootstrap/rollover always happens before spend accounting.
- A stale read-allow (e.g. stale period limit after a plan downgrade) is bounded by the authoritative mutating admission gate that follows on the same message path.
- Observability invariant (docs/contracts/00-invariants.md): bookkeeping must not sit on the user-visible reply path without a correctness reason.

Key decisions:
- Add `checkHostedAiUsageGate` (read; if not allowed, confirm via `resolveHostedAiUsageGate`) in `usage-allowance.ts` as the default gate entry point; denials stay authoritative, allows stay write-free.
- `resolveHostedRuntimeAiUsageGate` default mode becomes the read-first check; explicit `"mutating"` stays reserved for admission (reconciliation facts), explicit `"read_only"` stays pure for GET/status surfaces.
- `webhook-provider-linq.ts` switches from the raw mutating gate to `checkHostedAiUsageGate` (it needs the full decision for quota notices).
- Merge the two copy-pasted `...NeedsAiUsageGate` route predicates into one shared `hostedRuntimeMailboxEntryNeedsAiUsageGate` in `runtime-usage-decision.ts`.

State:
- Implementation, audits, and verification complete; ready for scoped commit + PR.

Done:
- Hot-path audit identified 4 sequential mutating gate transactions per inbound Linq message (webhook planner, reconciliation facts, mailbox fetch, payload fetch).
- Implemented `checkHostedAiUsageGate` (read-first, confirm denials via the mutating gate), flipped the runtime wrapper default to it, switched the Linq webhook planner, merged the duplicated route predicates.
- Updated the linq usage-reset e2e: the webhook no longer creates the fresh-month period row (turn admission owns period bookkeeping; spend accounting ensure-creates as backstop).
- security-privacy-review: no medium+ findings. coverage-write added carryover-rescue and mixed-batch route tests. task-finish-review: three low findings fixed (README period-bookkeeping sentence, gate comment wording, this plan refresh).
- Verification: apps/web `pnpm verify` green; focused suites green (full web suite 2324 passing / 1 pre-existing skip).

Now:
- Scoped commit via `scripts/finish-task`, then PR.

Next:
- After a day of prod traces, re-measure `hosted_ingress_latency_trace` segments to confirm the gate-consolidation win.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- apps/web/src/lib/hosted-execution/usage-allowance.ts
- apps/web/src/lib/hosted-orchestration/runtime-usage-decision.ts
- apps/web/src/lib/hosted-onboarding/webhook-provider-linq.ts
- apps/web/app/api/internal/hosted-mailbox/fetch/route.ts
- apps/web/app/api/internal/hosted-mailbox/payload/fetch/route.ts
- apps/web/test/hosted-execution-usage-allowance.test.ts
- apps/web/test/hosted-runtime-internal-routes.test.ts
- apps/web/test/hosted-onboarding-linq-dispatch.test.ts
Status: completed
Updated: 2026-06-12
Completed: 2026-06-12
