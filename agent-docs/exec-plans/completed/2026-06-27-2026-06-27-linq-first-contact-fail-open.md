# Linq first-contact classifier fail-open

Status: completed
Created: 2026-06-27
Updated: 2026-06-27

## Goal

- Unknown Linq first-contact messages should still be admitted when the OpenAI classifier is unavailable, while explicit classifier blocks still block.
- Keep admission state retry-safe: once the path chooses a fallback allow or model decision, retries should observe one recorded event decision instead of repeatedly calling OpenAI.

## Success criteria

- Classifier transport/timeout/invalid-output failures record a deterministic fallback allow decision and proceed through normal first-contact admission.
- Model `block` decisions still block before member, invite, mailbox, wake, read-receipt, or send side effects.
- Budget claim and decision record do not land in a half-saved state for successful/fallback admissions.
- Focused hosted Linq admission tests prove fail-open and low-confidence allow behavior.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-onboarding/linq-first-contact-admission.ts`
  - `apps/web/src/lib/hosted-onboarding/webhook-service.ts`
  - Focused hosted onboarding Linq tests.
  - Durable architecture/security docs for the changed admission policy.
- Out of scope:
  - Outbound delivery retry architecture.
  - New queues, schedulers, or persisted handoff tables.
  - Changes to known-member Linq ingress.

## Constraints

- Technical constraints:
  - Keep outbound send/read-receipt/wake handling outside the admission persistence transaction.
  - Do not persist raw OpenAI prompts, responses, provider bodies, contact lookup keys, or provider credentials.
  - Preserve event-id decision idempotency and per-contact budget cap semantics.
- Product/process constraints:
  - User preference: inbound admission should not be blocked just because the classifier is unavailable.
  - Keep architecture simple and avoid speculative abstraction.

## Risks and mitigations

1. Risk: Fail-open admits messages the classifier would have blocked.
   Mitigation: Fail open only for classifier-unavailable states; explicit model blocks and deterministic textless blocks still block.
2. Risk: Admission DB writes become coupled to outbound delivery.
   Mitigation: Only admission/budget state is transactional; delivery remains downstream best-effort/retry-owned.

## Tasks

1. Done: add a deterministic fallback allow helper for classifier-unavailable outcomes.
2. Done: persist budget claim and admission decision atomically after model/fallback admission.
3. Done: update focused Linq admission and dispatch tests, including low-confidence allow and typed-error-only fail-open proof.
4. Done: update durable architecture/security docs for the fail-open policy.
5. Done: run focused verification and required completion review.

## Decisions

- Do not add a new delivery recovery mechanism in this change.
- Treat classifier-unavailable as deterministic fallback allow, not model allow, so logs/records distinguish it from a real classifier decision.

## Verification

- Passed:
  - `pnpm exec vitest run --config apps/web/vitest.workspace.ts --no-coverage apps/web/test/hosted-onboarding-linq-first-contact-admission.test.ts apps/web/test/hosted-onboarding-linq-dispatch.test.ts` (2 files, 109 tests).
  - `pnpm --dir apps/web lint` (0 errors; existing warnings only).
  - `pnpm docs:drift`.
  - `git diff --check`.
- Blocked by unrelated existing failures:
  - `pnpm typecheck` fails in `apps/web/src/lib/phone-calls/retell-runtime.ts` because `retell-sdk` imports cannot resolve and adjacent `unknown` error accesses are already red.
  - Earlier `pnpm --dir apps/web test:prepared -- hosted-onboarding-linq-first-contact-admission.test.ts hosted-onboarding-linq-dispatch.test.ts` expanded into a broader hosted-web suite and was blocked by unrelated migration-enum, default-model, and `retell-sdk` failures.
- Completion reviews:
  - Security/privacy pass: no medium-or-higher findings.
  - Coverage-write pass: added typed-error-only fail-open regression and reran the focused suite.
  - Deep review: found stale `ARCHITECTURE.md` wording; fixed and reran doc drift.
Completed: 2026-06-27
