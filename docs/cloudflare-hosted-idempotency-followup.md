# Cloudflare Hosted Execution Idempotency Follow-Up

This repo now has durable bundle commits and per-event journaling, and hosted assistant replies now queue before commit and drain after commit. It still does not have a full hosted outbox for every externally visible side effect.

## What Is Protected Today

- encrypted `vault` and `agent-state` bundle refs are only advanced through the durable commit path
- repeated worker and runner retries can recover from a lost runner response by replaying the durable commit journal
- already-committed events are treated as consumed and will not re-run the same bundle commit indefinitely
- hosted assistant replies now create durable assistant outbox intents during the one-shot run, and the hosted runner drains those intents only after the durable bundle commit succeeds
- hosted assistant post-commit sends are reconciled through a hosted delivery journal so later hosted wakes can mark already-recorded assistant intents sent without re-sending them first

## Remaining Gap

The remaining gap is now narrower:

- non-assistant hosted side effects still do not use the same outbox pattern
- a hosted assistant send can still duplicate in the residual edge where the external send succeeds but the post-commit hosted delivery journal write does not
- a future hosted provider callback or mutation succeeds, then the event retries

## Next Migration Step

The next production-hardening step is to generalize the same model beyond hosted assistant replies:

1. One-shot hosted runs compute desired outbound actions.
2. Those actions are durably committed with the updated hosted state.
3. A separate sender marks each action sent with an idempotency fingerprint.
4. Retries only resend actions that are still unsent.

The assistant-only hosted follow-up is now in place, but the broader migration still overlaps the rest of the assistant and channel delivery path plus any future hosted side effects and should stay in a dedicated follow-up branch.
