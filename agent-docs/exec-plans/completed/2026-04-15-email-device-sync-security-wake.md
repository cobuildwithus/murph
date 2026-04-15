# Email Device-Sync Security Wake

## Goal

Apply the watched ChatGPT security-audit patch where it cleanly matches the current repo, keeping scope limited to hosted email replay/size hardening and device-sync error redaction.

## Scope

- `apps/cloudflare/src/hosted-email.ts`
- `apps/cloudflare/src/hosted-email/worker-ingress.ts`
- `apps/cloudflare/test/hosted-email.test.ts`
- `apps/cloudflare/test/index.test.ts`
- `apps/web/src/lib/device-sync/agent-session-service.ts`
- `packages/device-syncd/src/hosted-runtime.ts`
- `packages/device-syncd/src/http.ts`
- `packages/device-syncd/src/public-ingress.ts`
- `packages/device-syncd/src/service.ts`
- `packages/device-syncd/test/hosted-runtime.test.ts`
- `packages/device-syncd/test/http-control-helpers.test.ts`
- `packages/device-syncd/test/http.test.ts`
- `packages/device-syncd/test/service.test.ts`

## Constraints

- Treat the downloaded patch as intent, not overwrite authority.
- Keep the diff scoped to the returned email/device-sync hardening only.
- Preserve unrelated in-flight work in the repo and ledger.
- Run repo-required verification and note unrelated blockers separately.

## Planned Shape

1. Make hosted raw-email ids deterministic but opaque and reject oversized raw payloads before persistence.
2. Sanitize provider-sourced device-sync error text before it reaches runtime state, logs, or operator-facing responses.
3. Tighten the shared bearer-token redaction path so it still redacts secrets without mutating plain status text.
4. Update only the targeted tests needed to cover the landed behavior.

Status: completed
Updated: 2026-04-15
Completed: 2026-04-15
