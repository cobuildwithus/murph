# Cloudflare Hosted Execution Idempotency Follow-Up

This repo now has durable owner-specific idempotency lanes for every currently implemented hosted outward effect. The Cloudflare hosted runner has durable bundle commits plus a generic committed side-effect journal for hosted one-shot runs, while `apps/web` uses the shared Postgres `execution_outbox`, receipt-local hosted webhook side-effect state for Linq/Telegram, queued hosted Stripe event facts, and invoice-owned RevNet issuance state for the other hosted outward edges.

## What Is Protected Today

- encrypted `vault` and `agent-state` bundle refs are only advanced through the durable commit path
- repeated worker and runner retries can recover from a lost runner response by replaying the durable commit journal
- already-committed events are treated as consumed and will not re-run the same bundle commit indefinitely
- hosted one-shot runs now collect due outbound side effects before the durable commit and persist those side effects alongside the committed hosted result
- hosted assistant replies still create durable assistant outbox intents during the one-shot run, but post-commit delivery now resumes from the committed side-effect journal instead of treating assistant sends as a separate special-case path
- hosted side-effect sends are reconciled through a hosted delivery journal so later hosted wakes can mark already-recorded actions sent without re-sending them first
- Cloudflare-bound hosted execution dispatches from onboarding, hosted share acceptance, and hosted device-sync wakes now go through the shared Postgres `execution_outbox` instead of fire-and-forget dispatches
- hosted onboarding webhook receipts now persist the planned response plus receipt-local side-effect state for Cloudflare dispatches and Linq or Telegram replies before send, transactionally queue hosted execution dispatches into `execution_outbox`, and reclaim expired processing leases so abandoned attempts can resume instead of burning the event
- Stripe webhook ingress now dedupes at durable fact insertion time and retries through the hosted Stripe event queue plus reconciler instead of trying to resume receipt-local inline work
- hosted RevNet issuance now fails closed once a tx hash exists, so a broadcast followed by a write-back failure is held for operator repair instead of being misclassified as a clean retry
- committed hosted retries now resume post-commit side effects from the committed journal without rerunning the original one-shot compute stage first

## Remaining Gap

The remaining gap is now narrower and more explicit:

- the repo still uses multiple durable-idempotency shapes (`execution_outbox`, receipt-local webhook side effects, the hosted Stripe fact queue, invoice-owned issuance state, and the Cloudflare committed side-effect journal) rather than one shared implementation
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

The current hosted code already follows that rule through owner-specific durable lanes: the Cloudflare committed side-effect journal, the shared Postgres `execution_outbox`, the hosted webhook receipt side-effect journal, the hosted Stripe fact queue, and the invoice-owned RevNet issuance state. Any future hosted outward effect should extend one of those journaled patterns instead of reintroducing direct fire-and-forget sends.
