# `@murphai/messaging-ingress`

Workspace-private shared stateless ingress semantics for Murph messaging providers.

This package owns provider-specific webhook parsing, verification, target grammar,
message extraction, summary helpers, and sparse allowlisted payload minimization.
It does not own polling drivers, local runtime state, hosted member lookup,
privacy redaction, or execution dispatch orchestration.

Use `@murphai/messaging-ingress/linq-webhook` for Linq webhook verification,
summary helpers, and sparse payload minimization.
Use `@murphai/messaging-ingress/telegram-webhook` for Telegram thread targeting,
summaries, and shared types. Use `@murphai/messaging-ingress/telegram-webhook-payload`
for raw Telegram webhook parsing and sparse payload minimization.

## Current scope

- Telegram webhook parsing, thread-target grammar, message summaries, and sparse raw minimization
- Linq webhook signature verification, canonical `message.received` parsing, summaries, and sparse raw minimization

## Non-goals

- inbox capture persistence
- polling connectors or provider API clients
- hosted privacy or billing policy
- hosted execution or outbox contracts
