Goal (incl. success criteria):
- Land the retained Pro patch intent for the CLI type-safety hard cut.
- Canonical typed add/save commands should no longer hide raw `--input` JSON payload fallbacks for capture, meal, measurement, workout, and workout format.
- Explicit `import-json` escape hatches, generated CLI artifacts, command discovery/capabilities, and regression coverage should match the new command surface.

Constraints/Assumptions:
- Keep changes scoped to the retained assistant response and downloaded patch.
- Preserve unrelated dirty work in the shared checkout.
- The patch is implementation intent, not overwrite authority; port drifted contracts pieces manually where needed.

Key decisions:
- Apply clean CLI hunks from the patch and adapt contracts verification/capability intent to the current source layout.
- Do not recreate `packages/contracts/src/command-capabilities.ts`; it was already removed from this checkout as obsolete command-capability taxonomy. Keep coverage on generated CLI types, config schema, and command manifest discovery instead.

State:
- completed_pending_commit

Done:
- Read the retained assistant response and patch summary.
- Confirmed patch does not apply cleanly only on drifted contracts targets.
- Applied the clean CLI hunks.
- Confirmed the skipped contracts capability hunk is stale against the current checkout.
- Ported stale typed-parity tests so raw JSON coverage now targets explicit `import-json` commands.
- Verified focused CLI hard-cut tests, package CLI source suite, package CLI typecheck, package CLI coverage acceptance, contracts verify, and scoped diff-check.
- Required security/privacy and coverage-write audits completed with no findings or file changes.

Now:
- Archive this task plan and create a scoped commit without absorbing unrelated shared-ledger churn.

Next:
- Handoff the commit hash and the unrelated repo-wide typecheck blocker.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `output-packages/chatgpt-watch/cli-hard-cut-1-2-5/assistant-response.md`
- `output-packages/chatgpt-watch/cli-hard-cut-1-2-5/downloads/murph-cli-type-safety-hard-cut.patch`
- `packages/cli/**`
- `packages/contracts/scripts/verify.ts`
- `packages/contracts/src/**`
- `pnpm exec vitest run --config packages/cli/vitest.workspace.ts --no-coverage packages/cli/test/canonical-json-input.test.ts packages/cli/test/capture-add-typed-parity.test.ts packages/cli/test/meal-add-typed-parity.test.ts packages/cli/test/measurement-add-typed-parity.test.ts packages/cli/test/workout-add-typed-parity.test.ts packages/cli/test/workout-format-save-typed-parity.test.ts packages/cli/test/cli-typed-agent-inputs-schema.test.ts packages/cli/test/document-meal-intervention-coverage.test.ts packages/cli/test/workout-command-coverage.test.ts` passed.
- `pnpm --dir packages/cli test:source` passed.
- `pnpm --dir packages/cli typecheck` passed.
- `pnpm --dir packages/contracts verify` passed.
- `pnpm --dir packages/cli verify:coverage` passed.
- `pnpm typecheck` failed in unrelated active Cloudflare work: `apps/cloudflare/test/runner-state-store.bundle-slots.test.ts` references missing `RunnerStateStore.writeTrackedAuthoritativeCursor` / `readTrackedAuthoritativeCursor`.
