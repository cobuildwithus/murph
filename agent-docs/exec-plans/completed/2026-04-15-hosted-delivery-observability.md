## Goal

Make hosted assistant delivery failures operator-visible in Cloudflare logs without leaking secrets or changing delivery semantics.

## Scope

- `packages/assistant-runtime/src/hosted-runtime/callbacks.ts`
- Focused hosted delivery tests under `apps/cloudflare/test/**` and/or `packages/assistant-runtime/test/**`

## Guardrails

- Keep existing outbox retry/idempotency behavior unchanged.
- Log only redaction-safe metadata: effect id, user id, operation/failure stage, retryability, and sanitized error text.
- Do not log raw tokens, webhook secrets, Authorization headers, or provider payload bodies.
- Prefer one clear hosted log at the failure boundary over broad noisy logging.

## Plan

1. Trace the hosted post-commit delivery path and choose the narrowest failure boundary that still sees provider-classified errors.
2. Add structured failure logging there using already-sanitized error details where possible.
3. Add focused tests proving the hosted log includes actionable failure metadata and remains redacted.
4. Run truthful verification for the touched hosted slices, complete required audits, and commit the scoped patch.
Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
