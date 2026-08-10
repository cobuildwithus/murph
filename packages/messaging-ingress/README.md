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
message extraction, summaries, and shared types over already-authenticated
updates. Use
`@murphai/messaging-ingress/telegram-webhook-payload` for Telegram webhook
secret-token verification, already-authenticated payload parsing, and sparse
payload minimization.

Linq and Telegram minimizers locally sanitize obvious token, cookie,
authorization-like, and user-home-path values, but callers still own any
broader privacy redaction policy above that transport-level sanitization.

## Current scope

- Linq: webhook signature verification, `message.received`, versioned
  `message.edited`, and participant add/remove parsing, summaries, and sparse
  raw minimization that omits edited replacement text. Signed
  `message.received` payloads with absent or null `parts` normalize to an empty
  message for compatibility, while non-array values and unsupported part types
  remain invalid. Documented `imessage_app` parts retain only their fallback
  text; provider app, layout, and URL metadata are discarded.
- Telegram: webhook secret-token verification, preverified update parsing, thread-target grammar, message extraction/summaries, and sparse raw minimization

## Non-goals

- inbox capture persistence
- polling connectors or provider API clients
- hosted privacy or billing policy
- hosted execution or outbox contracts
