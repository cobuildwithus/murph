# Add privacy-preserving hosted assistant context fingerprint logs

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Add privacy-preserving hosted assistant diagnostics that can confirm whether signup welcome delivery and later Linq inbound replies resolve through the same direct conversation identity.
- Keep the change observability-only: no assistant behavior, routing, delivery, or session-resolution semantics should change.

## Why

- A duplicate signup welcome likely came from a later auto-reply resolving to a fresh assistant session because Linq's internal direct `chatId` differed from the signup welcome route's thread id.
- Current hosted run logs expose only booleans such as `notificationRouteThreadIdPresent`; they do not expose safe equality evidence for route/chat/session continuity.

## Scope

- Hosted assistant/runtime logging and directly coupled tests only.
- Expected working files:
  - `packages/assistant-engine/src/assistant/**`
  - `packages/assistant-runtime/src/hosted-runtime/**`
  - focused tests under `packages/assistant-engine/test/**` and/or `packages/assistant-runtime/test/**`
  - this plan plus `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`

## Out of scope

- Fixing the direct Linq session keying bug.
- Changing onboarding prompts, response policies, delivery dedupe, or webhook routing behavior.
- Logging raw member ids, phone numbers, Linq chat ids, assistant session ids, run ids, provider payloads, or message text.

## Constraints

- Fingerprints must be one-way and stable within one deployment environment.
- Logs must be useful without exposing contact identifiers: include equality fingerprints for route parts and computed conversation keys, plus session created/reused state and transcript replay count.
- Prefer existing hosted run log plumbing over a new log sink.

## Risks and mitigations

1. Risk: diagnostics accidentally leak user/contact/session identifiers.
   Mitigation: log only HMAC-derived short fingerprints and booleans/counts; add focused tests for raw-value exclusion.
2. Risk: diagnostics become noisy or hard to correlate.
   Mitigation: emit a small number of structured lifecycle records at notification route handling, Linq inbound handling, and assistant session resolution.
3. Risk: fingerprinting creates a new required secret.
   Mitigation: prefer an existing server-side secret source when available; if no secret is configured, log only presence/scope fields and omit fingerprints.

## Tasks

1. Register the narrow hosted logging lane and inspect existing hosted log plumbing.
2. Add a small reusable fingerprint helper for hosted diagnostics.
3. Log notification route fingerprints, Linq inbound capture fingerprints, and assistant session-resolution/transcript replay diagnostics.
4. Add focused coverage for fingerprint redaction and the new diagnostics shape.
5. Run focused verification, then deploy through `pnpm cf:deploy`.

## Verification

- `pnpm --filter @murphai/assistant-engine exec tsc -p tsconfig.typecheck.json --pretty false`
- `pnpm --filter @murphai/assistant-runtime exec tsc -p tsconfig.typecheck.json --pretty false`
- `pnpm --filter @murphai/cloudflare-runner exec tsc -p tsconfig.typecheck.json --pretty false`
- `pnpm --filter @murphai/assistant-engine exec vitest run --config vitest.config.ts test/assistant-hosted-context-diagnostics.test.ts test/assistant-notification-turn-runtime.test.ts test/assistant-local-service-runtime.test.ts --no-coverage`
- `pnpm --filter @murphai/assistant-runtime exec vitest run --config vitest.config.ts test/hosted-runtime-events.test.ts test/hosted-runtime-events-coverage.test.ts test/hosted-runtime-maintenance.test.ts --no-coverage`
- `pnpm --filter @murphai/cloudflare-runner exec vitest run --config vitest.node.workspace.ts test/env.test.ts test/node-runner-hosted-assistant.test.ts --no-coverage`
- `git diff --check`
- Full `pnpm typecheck` and `pnpm test` were attempted; both failed in unrelated `packages/cli/test/setup-cli.test.ts` public-url/setup changes already present outside this lane.
Completed: 2026-04-25
