# Device-sync transient read retry

Status: completed
Created: 2026-08-20
Updated: 2026-08-20

## Goal

- Preserve the existing device-sync retry budget when hosted artifact reads or
  canonical checkpoint publication fail for a proven transient transport reason.

## Success criteria

- Typed transient artifact-read failures become retryable device-sync failures
  instead of terminal `SYNC_JOB_FAILED` results.
- Proven transient checkpoint transport failures retry after existing
  reconciliation has ruled out an ambiguous committed result.
- Authority, lease, parser, integrity, deterministic response, and caller
  cancellation failures remain terminal or retain their existing semantics.
- Focused tests and affected package typechecks pass, followed by required
  ReviewGPT and exact-head CI gates.

## Scope

- In scope: hosted device-sync error translation, focused tests, and durable
  retry documentation where the existing contract would otherwise be unclear.
- Out of scope: changing provider fetch windows, retry counts, canonical write
  authority, checkpoint durability, Junction height conflict behavior, or
  adding another queue.

## Constraints

- Keep canonical writes atomic and fail closed on ambiguous checkpoint state.
- Reuse existing typed errors and the existing durable job retry owner.
- Log and persist only bounded metadata; never expose provider payloads or
  member identifiers.

## Tasks

1. Prove the current error-translation gap from the hosted artifact and
   checkpoint boundaries through device-sync job classification.
2. Add the narrow transient translations and focused regression coverage.
3. Run focused tests, affected package typechecks, diff/privacy inspection,
   ReviewGPT, and exact-head CI.
4. Hand off the green, reviewed PR for the separately authorized merge and
   deployment boundary.

## Decisions

- Equal-revision Junction height conflicts remain unchanged: they are expected
  fail-closed provider-data-integrity protection and require the provider to
  advance or correct its revision.
- Reuse the current job row and attempt budget; no new retry state owner is
  introduced.

## Verification

- `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/device-sync-service.test.ts`
  passed with 4 tests.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-platform.test.ts`
  passed with 197 tests after the accepted specialist finding was reproduced
  and fixed with a real `Response` whose erroring body follows a known `401`.
- `pnpm --dir packages/device-syncd exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/service.test.ts -t "keeps per-attempt failure diagnostics after a later job success|exposes safe structured diagnostics for provider failures"`
  passed with 2 focused retry-policy tests.
- `pnpm --dir packages/assistant-runtime typecheck` and
  `pnpm --dir apps/cloudflare typecheck` passed.
- `pnpm --dir apps/web test:prepared -- test/changelog-fragments.test.ts`
  passed with 7 tests, and `pnpm --dir apps/web typecheck` passed.
- The full Cloudflare suite passed with 148 files, 2,612 tests, and 2 skipped.
- Preliminary specialist ReviewGPT found one medium transport-classification
  issue: a known non-OK checkpoint status could be lost when its optional body
  failed. The finding was accepted, reproduced before the fix, and resolved by
  making the received status authoritative while preserving caller
  cancellation.
- Final full ReviewGPT round 2 reviewed exact head
  `67eeca843bdb2183409b6d49332159cbfaaf6b1a`, confirmed the specialist finding
  resolved, reported no findings, and returned `ROUND_OUTCOME: PASS` with the
  required `REVIEW_COMPLETE` marker.
- All required exact-head GitHub checks passed. The first release
  build/typecheck attempt reached 679 passing verification-tool tests before
  an unrelated GitHub Markdown-rendering HTTP 403; its failed-job rerun passed.
- `git diff --check` passed. PR #2095 is ready for the separately authorized
  merge/deploy step; neither action was performed in this task.
Completed: 2026-08-20
