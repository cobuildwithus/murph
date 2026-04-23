# `@murphai/messaging-ingress`

Workspace-private shared stateless ingress semantics for Murph messaging providers.

This package owns provider-specific parsing, verification where implemented,
target grammar, message extraction, summary helpers, and sparse allowlisted
payload minimization. It does not own polling drivers, local runtime state,
hosted member lookup, higher-level privacy policy, or execution dispatch
orchestration.

Use `@murphai/messaging-ingress/linq-webhook` for Linq webhook verification,
parsing, summaries, and sparse payload minimization.
Use `@murphai/messaging-ingress/telegram-webhook` for Telegram thread targeting,
message extraction, summaries, and shared types. Use
`@murphai/messaging-ingress/telegram-webhook-payload` for Telegram webhook
parsing and sparse payload minimization. Telegram does not currently ship a
verification helper in this package.

Linq and Telegram minimizers locally sanitize obvious token, cookie,
authorization-like, and user-home-path values, but callers still own any
broader privacy redaction policy above that transport-level sanitization.

## Current scope

- Linq: webhook signature verification, `message.received` parsing, summaries, and sparse raw minimization
- Telegram: webhook parsing, thread-target grammar, message extraction/summaries, and sparse raw minimization

## Non-goals

- inbox capture persistence
- polling connectors or provider API clients
- hosted privacy or billing policy
- hosted execution or outbox contracts
