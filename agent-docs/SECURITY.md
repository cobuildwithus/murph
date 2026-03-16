# Security

Last verified: 2026-03-16

## Non-Negotiable Rules

- Never read or expose `.env` contents, tokens, private keys, or raw credentials.
- Redact sensitive identifiers from logs, fixtures, examples, and screenshots.
- Treat all auth, wallet, payment, and health-related data flows as high-sensitivity until documented otherwise.
- Do not echo model API keys, base headers, or other provider credentials in CLI output, fixtures, or persisted artifacts.

## Bootstrap Security Posture

- No runtime trust boundary is implemented yet.
- Before adding external APIs, auth, wallets, storage, or webhooks, document the trust boundary in `ARCHITECTURE.md` and the concrete rules here.
- Prefer least-privilege defaults and explicit validation at system boundaries.
- `vault-cli inbox model route` sends only the normalized text bundle plus tool catalog to the configured model backend, but that bundle can still contain sensitive health data and must be treated as high-sensitivity operator input.
- Persist only audited bundle/plan/result artifacts for inbox model routing; never persist provider secrets alongside those artifacts.
