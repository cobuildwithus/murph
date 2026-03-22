# Security

Last verified: 2026-03-23

## Non-Negotiable Rules

- Never read or expose `.env` contents, tokens, private keys, or raw credentials.
- Redact sensitive identifiers from logs, fixtures, examples, and screenshots.
- Treat all auth, wallet, payment, and health-related data flows as high-sensitivity until documented otherwise.
- Do not echo model API keys, base headers, or other provider credentials in CLI output, fixtures, or persisted artifacts.
- Treat AgentMail inbox ids, message metadata, attachment download URLs, and outbound email thread bindings as high-sensitivity operator data; never log or fixture real mailbox details or API keys.

## Bootstrap Security Posture

- No runtime trust boundary is implemented yet.
- Before adding external APIs, auth, wallets, storage, or webhooks, document the trust boundary in `ARCHITECTURE.md` and the concrete rules here.
- Prefer least-privilege defaults and explicit validation at system boundaries.
- `vault-cli inbox model route` sends only the normalized text bundle plus tool catalog to the configured model backend, but that bundle can still contain sensitive health data and must be treated as high-sensitivity operator input.
- Persist only audited bundle/plan/result artifacts for inbox model routing; never persist provider secrets alongside those artifacts.
- AgentMail-backed email polling and delivery must keep API keys in environment variables only, must not write raw Authorization headers to vault/runtime artifacts, and must limit assistant auto-reply to direct email threads.
