# Cloudflare Hosted Execution Idempotency Follow-Up

This repo now has durable bundle commits and per-event journaling, and hosted assistant replies now queue before commit and drain after commit. It still does not have a full hosted outbox for every externally visible side effect.

## What Is Protected Today

- encrypted `vault` and `agent-state` bundle refs are only advanced through the durable commit path
- repeated worker and runner retries can recover from a lost runner response by replaying the durable commit journal
- already-committed events are treated as consumed and will not re-run the same bundle commit indefinitely
- hosted assistant replies now create durable assistant outbox intents during the one-shot run, and the hosted runner drains those intents only after the durable bundle commit succeeds
- hosted assistant post-commit sends are reconciled through a hosted delivery journal so later hosted wakes can mark already-recorded assistant intents sent without re-sending them first
- hosted onboarding webhook receipts now persist receipt-local side-effect state for Cloudflare dispatches and Linq invite replies before send, then mark those effects `sent` back onto the receipt after delivery
- retries of failed hosted onboarding Linq and Stripe webhooks now reclaim the prior receipt state and only redrain still-pending side effects instead of recomputing or replaying already-sent dispatches

## Remaining Gap

The remaining gap is now narrower and more explicit:

- hosted onboarding Cloudflare dispatches and Linq invite replies now use a receipt-local journal, but future hosted side effects still need the same durable-intent-before-send pattern when they are added
- Linq invite replies still have the residual transport edge where the external send succeeds but the durable `sent` marker write back fails afterward
- hosted assistant delivery still has an analogous residual edge where the external send succeeds but the post-commit hosted delivery journal write fails afterward
- RevNet issuance remains on its dedicated invoice-level idempotency path rather than the hosted webhook receipt side-effect journal

## Next Migration Step

The next production-hardening step is to generalize the same model anywhere hosted code gains a new externally visible side effect:

1. The hosted mutation computes the desired outbound actions.
2. Those actions are durably committed with the owning hosted state or receipt before any external send happens.
3. The sender marks each action sent with a transport-aware idempotency fingerprint or durable sent marker.
4. Retries only resend actions that are still pending.
5. When the upstream transport cannot offer stronger idempotency, keep the residual "send succeeded but sent marker write failed" edge explicit and narrow.

The assistant-only hosted follow-up is in place, and hosted onboarding webhooks now use the same durable-intent-before-send shape for Cloudflare dispatches and Linq invite replies. Any future hosted side effects should extend one of those journaled patterns instead of reintroducing direct fire-and-forget sends.
