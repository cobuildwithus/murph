# Deterministic inbound document auto-preservation for assistant automation

Status: completed
Created: 2026-04-05
Updated: 2026-04-05

## Goal

- Automatically preserve accepted inbound inbox document/file attachments as canonical documents so Murph does not depend on model routing or an explicit user ask to keep durable evidence.

## Success criteria

- Accepted inbox captures with stored `kind=document` attachments are preserved idempotently into canonical document storage.
- Assistant automation invokes that preservation before semantic routing and auto-reply processing.
- Existing manual `inbox promote document` behavior remains available.
- Prompt/docs/test coverage reflect the new invariant without inventing a new storage family.

## Scope

- In scope:
  - Inbox service support for deterministic document preservation.
  - Assistant automation scan integration.
  - Prompt wording that makes Murph more willing to acknowledge logging when appropriate.
  - Focused runtime and inbox service tests.
  - Durable docs for storage/automation behavior.
- Out of scope:
  - Generic image auto-preservation.
  - New structured oxygen or SPO2 sample import logic.
  - New vault folder families for evidence.

## Constraints

- Technical constraints:
  - Preserve unrelated in-progress worktree edits.
  - Keep `raw/inbox/**` as source capture and `raw/documents/**` as the canonical preserved-file home.
  - Do not let automatic document preservation suppress later semantic routing for the same capture.
- Product/process constraints:
  - Behavior should stay deterministic and idempotent.
  - Keep the first implementation simple enough to explain in durable docs and tests.

## Risks and mitigations

1. Risk:
   Automatic preservation could accidentally rely on the old capture-level promotion state and block later routing.
   Mitigation:
   Implement a separate preservation path that dedupes against canonical manifests without writing capture-level promotion entries.

2. Risk:
   Existing assistant automation tests use narrow inbox-service stubs that may not expose the new method.
   Mitigation:
   Keep the scan hook tolerant of absent preservation support in test doubles, then add focused coverage for the integrated path.

3. Risk:
   Duplicate imports could accumulate if idempotence is weak.
   Mitigation:
   Reuse canonical document manifest matching based on verified attachment bytes plus capture provenance before importing.

## Tasks

1. Add a document-preservation inbox result contract and service method.
2. Reuse the existing canonical document import matching logic for attachment-by-attachment idempotence.
3. Invoke preservation from assistant automation before routing/reply decisions.
4. Update prompt/docs/tests for the new default.
5. Run required verification, audit review, and commit with the plan closure helper.

## Decisions

- Use `raw/documents/**` rather than inventing a new evidence folder family.
- Preserve only stored `kind=document` inbox attachments in v1.
- Keep preservation deterministic and separate from semantic/model routing.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- Expected outcomes:
  - New focused assistant automation and inbox preservation tests pass.
  - Repo-required verification is green or any unrelated failure is clearly documented.
- Actual outcomes:
  - `pnpm typecheck` passed.
  - `pnpm exec vitest run packages/cli/test/inbox-cli.test.ts packages/cli/test/assistant-runtime.test.ts --no-coverage` passed after the review-driven fail-closed scanner fix.
  - Required `task-finish-review` found a real fail-open preservation bug in `assistant/automation/scanner.ts`; fixed by blocking downstream routing/reply when automatic preservation throws and by adding focused runtime proof for that path.
  - `pnpm test` remained red in unrelated areas already present on the branch, including `apps/web/test/device-sync-settings-routes.test.ts`, `packages/cli/test/assistant-service.test.ts`, and `apps/cloudflare/test/user-runner.test.ts`.
  - `pnpm test:coverage` remained red for the same unrelated failing suites plus existing hosted-execution coverage threshold misses in `packages/hosted-execution/src/client.ts` and `packages/hosted-execution/src/routes.ts`.
Completed: 2026-04-05
