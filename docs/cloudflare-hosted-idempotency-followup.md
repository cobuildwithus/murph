# Cloudflare Hosted Execution Idempotency Follow-Up

This repo now has durable bundle commits and per-event journaling, but it does not yet have a full outbox for externally visible side effects.

## What Is Protected Today

- encrypted `vault` and `agent-state` bundle refs are only advanced through the durable commit path
- repeated worker and runner retries can recover from a lost runner response by replaying the durable commit journal
- already-committed events are treated as consumed and will not re-run the same bundle commit indefinitely

## Remaining Gap

If a hosted run performs an external side effect before the durable commit succeeds, that side effect can still happen twice on retry. Examples:

- a Linq, Telegram, or AgentMail assistant reply succeeds, then the runner crashes before bundle commit
- a future hosted provider callback or mutation succeeds, then the event retries

## Next Migration Step

The next production-hardening step is an outbox pattern that lives outside the local-first core semantics:

1. One-shot hosted runs compute desired outbound actions.
2. Those actions are durably committed with the updated hosted state.
3. A separate sender marks each action sent with an idempotency fingerprint.
4. Retries only resend actions that are still unsent.

This overlaps the assistant and channel delivery path and is intentionally left for a dedicated follow-up branch so the current hosted execution layer can stay thin around the existing one-shot Healthy Bob seams.
