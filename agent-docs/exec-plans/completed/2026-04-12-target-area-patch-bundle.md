# Land target-area boundary patch bundle cleanly

Status: completed
Created: 2026-04-12
Updated: 2026-04-12

## Goal

- Land the supplied target-area boundary/follow-up patches cleanly so the current repo state keeps the intended owner seams around messaging ingress, query knowledge search, device-sync public ingress, and the remaining knowledge contract cleanup.

## Success criteria

- The still-applicable parts of the three supplied patches are merged onto the current tree without reverting unrelated dirty work.
- Messaging-ingress keeps explicit Telegram and Linq owner subpaths, with the Telegram thread-target regression covered.
- Query keeps derived-knowledge search behavior and contracts owned by the search seam instead of leaking back through graph loaders or compatibility shims.
- Device-sync public ingress stays provider-agnostic and does not leak daemon config/http helpers.
- Required verification for the touched owners passes, or any unrelated blocker is identified concretely.
- Required audit passes complete and the task finishes with a scoped commit.

## Scope

- In scope:
- `packages/messaging-ingress/**`
- `packages/query/**`
- `packages/device-syncd/**`
- `packages/inboxd/src/connectors/telegram/normalize.ts`
- `apps/web/src/lib/hosted-onboarding/{telegram.ts,webhook-provider-linq.ts}`
- `packages/operator-config/{package.json,src/index.ts,src/knowledge-contracts.ts}`
- `packages/assistant-engine/src/knowledge.ts`
- `agent-docs/references/data-model-seams.md`
- `scripts/verify-workspace-boundaries.mjs`
- Focused tests or guards directly required by the landed changes
- Out of scope:
- Unrelated assistant target/runtime work already active in `packages/operator-config` and `packages/assistant-engine`
- Broader hosted-onboarding refactors outside the two touched webhook consumers
- Any new compatibility layers beyond what the current repo still demonstrably needs

## Constraints

- Preserve overlapping dirty-tree edits and do not revert unrelated work.
- Treat the supplied patches as behavioral intent, not overwrite authority.
- Keep the landing narrow and behavior-preserving except where the patch explicitly hard-cuts obsolete compatibility surfaces.
- Do not expose personal identifiers from local paths, usernames, or legal names in repo files, commits, or handoff text.

## Risks and mitigations

1. Risk: The patch bundle overlaps already-dirty files in `apps/web`, `operator-config`, and `assistant-engine`.
   Mitigation: Read the current files before editing, merge only the still-applicable hunks, and keep the write set narrow.
2. Risk: Hard-cutting old exports can break callers if any supported import path remains.
   Mitigation: Search the workspace for live callers first and keep only the hard cuts with repo-local evidence.
3. Risk: Boundary changes can look green while leaving hidden re-export drift behind.
   Mitigation: Strengthen or keep the focused workspace-boundary guard in the same change.

## Tasks

1. Compare the current target-area files against the three supplied patches and identify which hunks are already landed versus still needed.
2. Merge the still-applicable hunks onto the current tree with focused tests and boundary-guard updates.
3. Run the required verification for the touched owners and capture any direct proof needed for the Telegram thread-target fix or boundary guards.
4. Run the required `coverage-write` and `task-finish-review` audit passes, address findings, and re-run affected checks.
5. Finish the task with a scoped commit via `scripts/finish-task`.

## Decisions

- Use one plan for the three supplied patches because they all target the same boundary-cleanup seam and share owners.
- Prefer hard cuts over compatibility shims when the current workspace has no supported callers left.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:diff packages/messaging-ingress packages/query packages/device-syncd packages/inboxd apps/web packages/operator-config packages/assistant-engine`
- `pnpm test:smoke`
- Focused direct checks if a required command is blocked by a credibly unrelated failure
- Expected outcomes:
- Touched-owner verification passes, or any unrelated blocker is recorded with the failing command, failing target, and why the current diff did not cause it.
- Results:
- `node scripts/verify-workspace-boundaries.mjs` passed.
- `node scripts/check-workspace-package-cycles.mjs` passed.
- `pnpm typecheck` failed for an unrelated pre-existing hosted-web typecheck error in `apps/web/test/hosted-onboarding-csrf.test.ts:77` where the branch-local env fixture still leaves `linqConversationPhoneNumbers` optional while `HostedOnboardingEnvironment` now requires it.
- Scoped owner verification passed for the knowledge-boundary slice: `pnpm --dir packages/assistant-engine typecheck`, `pnpm --dir packages/cli typecheck`, `pnpm --dir packages/query typecheck`, `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/knowledge-boundary.test.ts test/knowledge-entrypoint.test.ts --no-coverage`, `pnpm --dir packages/query exec vitest run --config vitest.config.ts test/knowledge-boundary.test.ts test/knowledge-contracts-root-surface.test.ts --no-coverage`, `pnpm exec vitest run --config packages/cli/vitest.workspace.ts packages/cli/test/knowledge-boundary.test.ts packages/cli/test/device-knowledge-command-coverage.test.ts --no-coverage`, and `pnpm test:smoke`.
- `bash scripts/workspace-verify.sh test:diff ...` failed for unrelated pre-existing reverse-dependent tests outside the knowledge seam: `packages/cli/test/assistant-harness.test.ts` (3 failures under assistant model-resolution behavior) and `packages/cli/test/release-script-coverage-audit.test.ts` (1 failure expecting an older `@cobuild/review-gpt` pin in `pnpm-workspace.yaml`).
Completed: 2026-04-12
