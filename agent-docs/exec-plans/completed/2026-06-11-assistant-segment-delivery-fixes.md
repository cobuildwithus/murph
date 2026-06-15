# Assistant segment delivery fixes

Status: completed
Created: 2026-06-11
Updated: 2026-06-11

## Goal

- Fix PR 140 review findings so steered Codex assistant turns preserve every completed final segment, keep duplicate same-text segments distinct through local outbox delivery, and attach response media to the segment that produced it.

## Success criteria

- Codex adapter no longer relies on final text equality to identify trailing segment duplication.
- Local service persists and delivers same-text pre-steer and final responses as distinct segments when they are distinct provider segments.
- Local outbox dedupe includes stable per-segment identity so duplicate same-text bubbles in one turn do not collapse.
- Response media is segmented with the final text boundary that owned it.
- Focused tests cover repeated same-text segments, real outbox dedupe, and pre-steer media association.
- Required package verification and completion audits pass or have documented unrelated blockers.

## Scope

- In scope: `packages/assistant-engine` Codex provider turn segmentation, local delivery, outbox dedupe identity, response media segmenting, and focused tests.
- Out of scope: broad assistant runtime refactors, new delivery transports, provider protocol redesign, or hosted platform changes.

## Constraints

- Technical constraints: keep segment identity owned by the adapter/order-aware delivery path instead of inferring identity from message text; preserve retry idempotency for each segment.
- Product/process constraints: keep the implementation small and composable; preserve unrelated worktree changes; avoid secrets and direct identifiers in committed artifacts.

## Risks and mitigations

1. Risk: changing delivery identity could break retry behavior.
   Mitigation: reuse existing delivery idempotency keys as stable segment dedupe tokens and add focused outbox-backed coverage.
2. Risk: media segmenting could misorder attachments.
   Mitigation: snapshot and clear media at the same final-message boundary used for text.

## Tasks

1. Done: inspect current segment extraction, delivery, outbox, and tests.
2. Done: move trailing-segment ownership out of local text equality and into ordered segment data.
3. Done: thread per-segment dedupe tokens through delivery into outbox.
4. Done: segment response media alongside text.
5. Done: add focused regression tests and run required checks/audits.

## Decisions

- Use the existing delivery idempotency key shape as the local outbox dedupe token for segment bubbles, avoiding a second identity scheme.
- Use the delivery idempotency key as the default final-reply outbox dedupe token when present, so hosted retries stay stable even if local turn ids or model text drift.
- Keep legacy `precedingResponses` as a fallback compatibility field while Codex now returns structured `precedingResponseSegments`.

## Verification

- Passed: `pnpm --dir packages/assistant-engine exec vitest run test/assistant-codex-runtime.test.ts test/assistant-local-service-runtime.test.ts test/assistant-service-runtime.test.ts test/assistant-outbox-runtime.test.ts --config vitest.config.ts --no-coverage`.
- Passed: `pnpm typecheck`.
- Passed: `pnpm test:diff packages/assistant-engine/src/assistant-codex.ts packages/assistant-engine/src/assistant/providers/types.ts packages/assistant-engine/src/assistant/providers/codex-cli.ts packages/assistant-engine/src/assistant/delivery-service.ts packages/assistant-engine/src/assistant/local-service.ts packages/assistant-engine/src/assistant/outbox.ts packages/assistant-engine/test/assistant-codex-runtime.test.ts packages/assistant-engine/test/assistant-local-service-runtime.test.ts packages/assistant-engine/test/assistant-service-runtime.test.ts packages/assistant-engine/test/assistant-outbox-runtime.test.ts`.
- Passed: `git diff --check`.
- Completion audits run: simplify, security/privacy, coverage-write, deep-review, and task-finish-review. Stale-ref findings matched already-fixed local behavior; accepted coverage/final dedupe proof gap was addressed with real outbox retry coverage and final delivery-key dedupe proof.
Completed: 2026-06-11
