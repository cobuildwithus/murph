# Remove remaining legacy compatibility seams

Status: completed
Created: 2026-03-30
Updated: 2026-03-30

## Goal

- Remove the four explicitly approved legacy compatibility seams from live Murph tooling and runtime code: the deprecated standalone coverage-audit preset redirect, hosted assistant-delivery side-effect records without idempotency keys, stored assistant cron jobs without persisted cron timezones, and Garmin importer support for the legacy `files` alias plus legacy `activity-file:*` raw-artifact roles.

## Success criteria

- Live review tooling no longer registers or requires `test-coverage-audit`, and active docs stop advertising it as a reusable preset.
- Hosted assistant-delivery side-effect records require non-empty `idempotencyKey` values on parse/read paths, with focused regression coverage for missing-key rejection.
- Assistant cron storage requires `timeZone` on persisted `cron` schedules, existing legacy rows are quarantined/rebuilt instead of silently preserved, and new jobs still resolve a vault/default timezone before persistence.
- Garmin snapshot normalization accepts `activityFiles` only, treats top-level `files` as an unsupported retained section, and emits non-legacy activity-file raw-artifact roles with focused regression coverage.
- Focused package checks and the repo-required `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` have been run, with any unrelated failures called out explicitly.

## Scope

- In scope:
- `agent-docs/prompts/test-coverage-audit.md`
- live review-tool config/docs that still reference the deprecated preset
- hosted side-effect parsing/types/tests in `packages/hosted-execution` and any direct runtime/test consumers
- assistant cron schedule contracts, storage/read behavior, and focused cron regressions in `packages/cli`
- Garmin snapshot normalization, raw-artifact role naming, importer docs, and focused importer regressions
- Out of scope:
- immutable completed execution plans and historical worker prompts
- unrelated assistant cleanup lanes already active in the shared worktree
- broader assistant/runtime compatibility shims not included in the user-approved 1-4 list

## Constraints

- Technical constraints:
- Preserve unrelated dirty worktree edits and adjacent active assistant lanes.
- Keep new cron-job creation behavior working by resolving vault/default cron timezones before persistence, even though stored jobs now hard-require that field.
- Product/process constraints:
- Use narrow, behavior-driven removals rather than adding new migration paths.
- Run required `simplify` then `task-finish-review` audit passes before final handoff because production code/tests are changing.

## Risks and mitigations

1. Risk: Cron hard-cuts could accidentally break normal job creation by requiring `timeZone` too early at the CLI/input boundary.
   Mitigation: Introduce an explicit input-vs-stored schedule seam, then keep the persisted schema strict while resolving the timezone during job creation/install.
2. Risk: Hosted side-effect hard-cuts could expose tests or resume paths that were still writing null idempotency keys.
   Mitigation: Update focused runtime tests and any mocked persisted delivery records so the new invariant is exercised end-to-end.
3. Risk: Garmin role renames could silently desynchronize activity-event `rawArtifactRoles` from the retained raw artifacts.
   Mitigation: Update normalization helpers and focused tests together, including metadata-only descriptor coverage.

## Tasks

1. Remove the deprecated `test-coverage-audit` prompt/preset from active config and docs, and delete the redirect file.
2. Require hosted assistant-delivery side-effect `idempotencyKey` values on parse/read paths and update focused runtime coverage.
3. Require stored cron-expression schedules to include `timeZone`, keep new-job timezone resolution before persistence, and update cron regression coverage around legacy rows.
4. Remove Garmin `files` alias handling, rename legacy activity-file raw-artifact roles, and update importer docs/tests.
5. Run focused verification, repo-required checks, required audit passes, and finish through the plan commit flow.

## Decisions

- Split assistant cron schedule handling into a permissive creation/input seam and a strict persisted schedule seam so the hard cut applies to stored state without degrading normal CLI ergonomics.
- Treat Garmin top-level `files` as an unsupported retained snapshot section after the hard cut instead of rejecting the payload outright.

## Verification

- Commands to run:
- Focused package checks for touched areas (`packages/hosted-execution`, focused CLI cron test, focused importer tests).
- Repo-required `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`.
- Expected outcomes:
- Focused checks pass for the hard-cut behavior.
- Repo-required checks either pass or fail only for documented, pre-existing unrelated reasons.

## Outcomes

- Completed the four approved hard cuts: removed live `test-coverage-audit` tooling/docs references and deleted the redirect prompt; required hosted assistant-delivery side-effect `idempotencyKey`; hard-cut stored cron-expression schedules without persisted `timeZone` while keeping a separate input seam; removed Garmin `files` alias normalization and renamed retained activity file roles to `activity-asset:*`.
- Focused verification passed:
  - `pnpm --dir packages/hosted-execution typecheck`
  - `pnpm exec vitest run packages/hosted-execution/test/hosted-execution.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run packages/importers/test/device-providers.test.ts --no-coverage --maxWorkers 1`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/index.test.ts apps/cloudflare/test/outbox-delivery-journal.test.ts apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/node-runner.test.ts --no-coverage --maxWorkers 1 -t "side-effect|hosted assistant deliveries|committed side effects"`
  - `bash scripts/check-agent-docs-drift.sh`
  - `bash scripts/doc-gardening.sh --fail-on-issues`
- Direct scenario evidence passed:
  - hosted side-effect parser accepts explicit `idempotencyKey` and rejects missing keys
  - persisted cron schema rejects missing `timeZone` while the creation/input seam remains permissive
- Repo-required wrappers remain blocked by unrelated dirty-tree failures:
  - `pnpm typecheck`: `packages/assistant-runtime/src/hosted-runtime/usage.ts` type error, then retry noise from `packages/core/dist` cleanup
  - `pnpm test`: `packages/assistantd/src/{http,service}.ts` cannot resolve `@murph/assistant-services/runtime`
  - `pnpm test:coverage`: malformed `packages/assistantd/package.json`
- Mandatory audit delegation was attempted through the built-in spawn tool and then the local `codex-workers` fallback, but this environment did not return a usable simplify-audit result. Main-lane self-review did not surface additional scope-reduction changes.
Completed: 2026-03-30
