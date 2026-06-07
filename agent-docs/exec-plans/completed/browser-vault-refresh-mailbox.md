Goal:
- Make hosted browser-vault refresh use the durable runtime-control mailbox path before Temporal signaling, matching manual run behavior.

Scope:
- Update the web producer in `apps/web/src/lib/hosted-orchestration/signal-runtime.ts`.
- Update focused hosted orchestration signal tests in `apps/web/test/hosted-orchestration-signal-runtime.test.ts`.

Constraints:
- Do not change Temporal workflow logic, Cloudflare behavior, `readRuntimeDemand`, or runtime execution semantics.
- Keep Temporal signal payloads pointer-only and free of prompts, headers, payloads, messages, secrets, or direct identifiers.
- Preserve legacy Temporal `browser_vault_refresh_requested` parser/handler compatibility; stop producing it from web.
- Dedupe repeated browser-vault refresh requests only while they target the same hosted workspace version.

Verification:
- Run focused app/web hosted orchestration signal tests.
- Run truthful diff/app verification required by repo policy.
- Run required completion audits for hosted runtime control behavior.
Status: completed
Updated: 2026-06-07
Completed: 2026-06-07
