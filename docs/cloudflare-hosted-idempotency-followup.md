# Cloudflare Hosted Execution Idempotency Follow-Up

This repo now has durable owner-specific idempotency lanes for every currently implemented hosted outward effect. The Cloudflare hosted runner keeps durable bundle commits plus committed side-effect state for hosted one-shot runs, while `apps/web` owns canonical hosted execution ingress rows, `HostedExecutionCursor`, `HostedRun` recovery rows, receipt-local hosted webhook side-effect state for Linq/Telegram, and queued hosted Stripe event facts.

## What Is Protected Today

- encrypted `vault` and `agent-state` bundle refs are only advanced through the durable commit path
- repeated worker and runner retries can recover from a lost runner response by replaying the durable commit journal
- Cloudflare now commits hosted runner results inside the Durable Object that owns the active run lease and journal state, so stale runner retries no longer race through a separate `/commit` callback path to challenge or recreate committed state
- web-owned hosted ingress rows plus cursor compare-and-swap remain the only committed high-water and pending-work truth; Cloudflare replays against that ingress/cursor seam and resumes finalize work through web-owned `HostedRun` recovery instead of maintaining a second pending/consumed queue owner
- hosted one-shot runs now collect due outbound side effects before the durable commit and persist those side effects alongside the committed hosted result
- committed hosted assistant-delivery effects now carry the outbound payload and transport metadata needed to redrive from the hosted journal alone, so hosted replay no longer depends on reconstructing a local outbox dispatch request
- hosted assistant replies still create durable assistant outbox intents during the one-shot run, but post-commit delivery now resumes from the committed side-effect journal instead of treating assistant sends as a separate special-case path
- hosted side-effect sends are reconciled through a hosted delivery journal so later hosted runs can mark already-recorded actions sent without re-sending them first
- hosted non-idempotent assistant delivery now treats the hosted delivery journal as the authoritative recovery surface, keeps `pending` as an implicit no-record state, persists `sending`, `sent`, `failed`, and `failed_ambiguous` journal states, disables hosted fallback to persisted outbox delivery snapshots, promotes stale non-idempotent `sending` records to terminal `failed_ambiguous` instead of retrying confirmation forever, and treats an already-recorded durable `failed` as terminal instead of re-sending
- Cloudflare-bound hosted execution dispatches from onboarding, hosted share acceptance, hosted email ingress, and hosted device-sync ingress events now append canonical hosted ingress rows directly instead of detouring through a second dispatch queue
- hosted onboarding webhook receipts now persist the planned response plus receipt-local side-effect state for Linq or Telegram replies before send, append canonical hosted ingress in the same transaction as the owning hosted state mutation, and reclaim expired processing leases so abandoned attempts can resume instead of burning the event
- third-party webhook request paths now acknowledge after the durable receipt and canonical hosted-ingress append complete; any immediate hosted-execution drain is only a non-blocking best-effort nudge, with web-owned run acquisition and cursor recovery owning retries
- Stripe webhook ingress now dedupes at durable fact insertion time and retries through the hosted Stripe event queue plus reconciler instead of trying to resume receipt-local inline work
- committed hosted retries now resume post-commit side effects from the committed journal without rerunning the original one-shot compute stage first

## Remaining Gap

The remaining gap is now narrower and more explicit:

- the repo still uses multiple durable-idempotency shapes (hosted ingress rows plus `HostedExecutionCursor` / `HostedRun`, receipt-local webhook side effects, the hosted Stripe fact queue, and the Cloudflare committed side-effect state) rather than one shared implementation
- Linq invite replies still have the residual transport edge where the external send succeeds but the durable `sent` marker write back fails afterward
- hosted assistant delivery still has the analogous residual edge where the external send succeeds but the post-commit hosted side-effect journal write fails afterward
- only assistant delivery is implemented as a Cloudflare hosted side-effect kind today; future provider mutations or callbacks inside the hosted runner still need concrete handlers on that committed-side-effect contract

## Standard Rule

Anywhere hosted code gains a new externally visible side effect, it should follow the same model:

1. The hosted mutation computes the desired outbound actions.
2. Those actions are durably committed with the owning hosted state or receipt before any external send happens.
3. The sender marks each action sent with a transport-aware idempotency fingerprint or durable sent marker.
4. Retries only resend actions that are still pending.
5. When the upstream transport cannot offer stronger idempotency, keep the residual "send succeeded but sent marker write failed" edge explicit and narrow.

The current hosted code already follows that rule through owner-specific durable lanes: the Cloudflare committed side-effect state, canonical hosted ingress plus `HostedExecutionCursor` / `HostedRun` rows in Postgres, the hosted webhook receipt side-effect journal, and the hosted Stripe fact queue. Any future hosted outward effect should extend one of those journaled patterns instead of reintroducing direct fire-and-forget sends.

For hosted assistant delivery specifically:

- idempotent transports may still redrive from pending journal state when their transport contract allows it
- non-idempotent transports must never auto-resend once the journal enters `failed_ambiguous`
- non-idempotent transports should also treat a durable hosted `failed` record as terminal operator-visible state, not as an automatic resend trigger
- local outbox delivery snapshots remain useful execution residue, but they are no longer authoritative hosted recovery proof on their own
- local outbox delivery state for hosted sends should be treated as a mirror for operator visibility and scheduling, not as a second durable owner for hosted outbound recovery; repeated observation of the same hosted `sending` attempt should not mint a new local attempt
