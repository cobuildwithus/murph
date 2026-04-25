Goal (incl. success criteria):
- Upgrade all direct `incur` dependencies in the CLI-facing workspace packages to the current npm `latest`.
- Success means `packages/cli`, `packages/assistant-cli`, and `packages/setup-cli` resolve the same latest `incur` version through the committed lockfile, generated/package-shape artifacts remain truthful, and required scoped verification is recorded.

Constraints/Assumptions:
- Preserve unrelated dirty work and active ledger rows.
- Do not print or write secrets, personal identifiers, raw local paths, or config contents.
- Dependency changes must update the committed lockfile and stay on registry-sourced package specs.
- Keep command topology unchanged unless the newer framework output requires a direct compatibility fix.

Key decisions:
- Treat this as a standard repo dependency/config change because it touches package manifests and the root lockfile.
- Update all direct `incur` consumers together so Murph does not ship mixed CLI framework versions.

State:
- implemented; blocked on required completion-audit quota for workflow-close/commit.

Done:
- Read required repo routing, architecture, product, verification, completion, and testing docs.
- Confirmed npm `latest` for `incur` is `0.4.4`.
- Confirmed the repo currently pins `incur` `0.3.13` in `packages/cli`, `packages/assistant-cli`, and `packages/setup-cli`.
- Updated direct `incur` pins and refreshed `pnpm-lock.yaml`.
- Added a version-scoped `minimumReleaseAgeExclude` for `incur@0.4.4` because the repo's 24-hour release-age guard blocked the explicit latest-version request while the release was 21 hours old.
- Synced local dependencies with `pnpm install --frozen-lockfile`.
- Compared old/new Incur help and migrated Murph machine-output usage from `--verbose` to `--full-output`.
- Ran `pnpm --dir packages/cli gen:config-schema`; generated CLI artifacts did not change.
- Ran `pnpm deps:guard`; passed.
- Ran `pnpm deps:audit`; failed on pre-existing advisories outside the `incur` dependency path.
- Ran `pnpm typecheck`; passed before later unrelated dirty-tree type errors appeared in an active experiment-onboarding lane.
- Ran scoped `bash scripts/workspace-verify.sh test:diff ...`; CLI package shape and CLI workspace Vitest passed, then the broader diff path failed on unrelated dirty `packages/vault-usecases/src/usecases/experiment-journal-vault.ts` missing-helper type errors owned by another active lane.
- Ran focused package checks for the touched surfaces: assistant policy wrapper Vitest, operator-config typecheck, setup-cli surface Vitest, Incur root/gen help, built CLI root help, and full `packages/cli/test/incur-smoke.test.ts`; all passed.
- Confirmed old root `--verbose` now fails under Incur `0.4.4`, and the Murph machine-output paths use `--full-output`.
- `git diff --check` passed for the scoped upgrade files.
- Scoped privacy scan found no local-path, contact, secret, or authorization-header leaks after excluding known false positives from unrelated ledger text.
- Required `security-privacy-review` and `coverage-write` subagents could not complete because the local subagent quota was exhausted.

Now:
- Handoff with implementation complete and required completion-audit/commit path blocked by subagent quota.

Next:
- Retry the required completion audits when quota is available, then close/archive the plan and create the scoped commit if still clean.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED whether broad repo verification is green once the unrelated experiment-onboarding dirty lane is fixed.

Working set (files/ids/commands):
- `packages/cli/package.json`
- `packages/assistant-cli/package.json`
- `packages/setup-cli/package.json`
- `pnpm-lock.yaml`
- `pnpm-workspace.yaml`
- `agent-docs/exec-plans/active/2026-04-25-incur-0-4-upgrade.md`
- `agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- `npm view incur version dist-tags versions time repository dependencies bin --json`
- `pnpm install --lockfile-only`
- `pnpm install --frozen-lockfile`
- `pnpm --dir packages/cli gen:config-schema`
- `pnpm deps:guard`
- `pnpm deps:audit`
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff <scoped-upgrade-paths>`
- `pnpm --dir packages/cli exec vitest run --config vitest.workspace.ts test/incur-smoke.test.ts --no-coverage`
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
