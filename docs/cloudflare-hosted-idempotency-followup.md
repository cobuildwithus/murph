# Cloudflare Hosted Execution Idempotency Follow-Up

This repo now has durable bundle commits plus a generic committed side-effect journal for hosted one-shot runs. Hosted assistant delivery is the first concrete side-effect kind on that path, and future hosted outward mutations should extend the same contract instead of adding direct fire-and-forget sends.

## What Is Protected Today

- encrypted `vault` and `agent-state` bundle refs are only advanced through the durable commit path
- repeated worker and runner retries can recover from a lost runner response by replaying the durable commit journal
- already-committed events are treated as consumed and will not re-run the same bundle commit indefinitely
- hosted one-shot runs now collect due outbound side effects before the durable commit and persist those side effects alongside the committed hosted result
- hosted assistant replies still create durable assistant outbox intents during the one-shot run, but post-commit delivery now resumes from the committed side-effect journal instead of treating assistant sends as a separate special-case path
- hosted side-effect sends are reconciled through a hosted delivery journal so later hosted wakes can mark already-recorded actions sent without re-sending them first
- hosted onboarding webhook receipts now persist receipt-local side-effect state for Cloudflare dispatches and Linq invite replies before send, then mark those effects `sent` back onto the receipt after delivery
- retries of failed hosted onboarding Linq and Stripe webhooks now reclaim the prior receipt state and only redrain still-pending side effects instead of recomputing or replaying already-sent dispatches
- committed hosted retries now resume post-commit side effects from the committed journal without rerunning the original one-shot compute stage first

## Remaining Gap

The remaining gap is now narrower and more explicit:

- hosted onboarding Cloudflare dispatches and Linq invite replies still use their receipt-local journal rather than the Cloudflare execution-side-effect journal, so the repo currently has two durability shapes rather than one shared implementation
- Linq invite replies still have the residual transport edge where the external send succeeds but the durable `sent` marker write back fails afterward
- hosted assistant delivery still has the analogous residual edge where the external send succeeds but the post-commit hosted side-effect journal write fails afterward
- RevNet issuance remains on its dedicated invoice-level idempotency path rather than the hosted webhook receipt side-effect journal
- only assistant delivery is implemented as a Cloudflare hosted side-effect kind today; future provider mutations or callbacks still need concrete handlers on the same committed-side-effect contract

## Standard Rule

Anywhere hosted code gains a new externally visible side effect, it should follow the same model:

1. The hosted mutation computes the desired outbound actions.
2. Those actions are durably committed with the owning hosted state or receipt before any external send happens.
3. The sender marks each action sent with a transport-aware idempotency fingerprint or durable sent marker.
4. Retries only resend actions that are still pending.
5. When the upstream transport cannot offer stronger idempotency, keep the residual "send succeeded but sent marker write failed" edge explicit and narrow.

The Cloudflare hosted execution lane now enforces that rule through a committed side-effect journal, and hosted onboarding webhooks already use the same durable-intent-before-send shape on their receipt journal. Any future hosted outward effect should extend one of those journaled patterns instead of reintroducing direct fire-and-forget sends.
