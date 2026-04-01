# `@murphai/messaging-ingress`

Shared stateless ingress semantics for Murph messaging providers.

This package owns provider-specific webhook parsing, verification, target grammar,
message extraction, summary helpers, and sparse allowlisted payload minimization.
It does not own polling drivers, local runtime state, hosted member lookup,
privacy redaction, or execution dispatch orchestration.

## Current scope

- Telegram webhook parsing, thread-target grammar, message summaries, and sparse raw minimization
- Linq webhook signature verification, canonical `message.received` parsing, summaries, and sparse raw minimization

## Non-goals

- inbox capture persistence
- polling connectors or provider API clients
- hosted privacy or billing policy
- hosted execution or outbox contracts
