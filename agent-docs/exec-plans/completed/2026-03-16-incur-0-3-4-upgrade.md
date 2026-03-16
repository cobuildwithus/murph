# Incur 0.3.4 upgrade

Status: completed
Created: 2026-03-16
Updated: 2026-03-16

## Goal

- Upgrade `packages/cli` from `incur` `0.3.3` to the current npm `latest` release and keep the built CLI behavior, generated typings, and repo verification truthful.

## Success criteria

- `packages/cli/package.json` and `pnpm-lock.yaml` resolve `incur` `0.3.4`, which is the npm `latest` dist-tag as of 2026-03-16.
- Any framework-owned help, CTA, schema, or typegen output changes introduced by `0.3.4` are reflected in repo code/tests/generated artifacts.
- Required repo verification passes after the upgrade.

## Scope

- In scope:
- `incur` dependency upgrade for `packages/cli`
- generated artifact refresh if the newer `incur` version changes typegen output
- focused test/doc assertion updates required by the release-note behavior change
- completion-workflow audit passes plus required repo verification
- Out of scope:
- unrelated CLI feature work
- command-topology redesign unrelated to the framework upgrade

## Constraints

- Preserve adjacent setup-lane edits already present in the worktree.
- Do not restate or invent framework behavior beyond what upstream `incur` now emits.
- Keep generated `incur` artifacts aligned only if the upstream tool output actually changes.

## Risks and mitigations

1. Risk: `0.3.4` changes CLI help wording and breaks brittle assertions.
   Mitigation: verify actual built CLI output after the upgrade and update only the affected expectations.
2. Risk: the generated `incur` register typings or built CLI output drift silently.
   Mitigation: regenerate/build as needed and rely on the repo verification path plus focused smoke coverage.
3. Risk: overlapping worktree changes in CLI/docs could make blanket rewrites unsafe.
   Mitigation: keep the lane narrow to dependency, generated artifacts, and directly affected tests.

## Tasks

1. Confirm the latest upstream `incur` release and the release-note delta from `0.3.3`.
2. Upgrade the dependency and refresh the lockfile/generated artifacts.
3. Fix any help/CTA/schema assertions or other code fallout caused by `0.3.4`.
4. Run simplify, coverage, and finish-review audits, then execute required repo verification.

## Verification

- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Focused checks as needed while iterating: package-local `packages/cli` build/test paths and targeted Vitest smoke cases

## Outcome

- Upgraded `packages/cli` from `incur` `0.3.3` to `0.3.4` and refreshed the lockfile.
- Confirmed the upstream `0.3.3 -> 0.3.4` tarball diff is limited to `Help`/`Cli` help-text and CTA-formatting files plus package metadata/tests.
- Updated the built-CLI smoke test to match the `0.3.4` root help wording and to cover the changed built-in command descriptions explicitly.

## Verification results

- `pnpm typecheck` ✅
- Focused built-CLI verification for `packages/cli/test/incur-smoke.test.ts` and `packages/cli/test/inbox-incur-smoke.test.ts` ✅
- `pnpm test` ⚠️ fails on pre-existing assertions outside the upgrade lane:
- `packages/cli/test/selector-filter-normalization.test.ts` expects `search ... --from/--to` to succeed, but `bounded.ok` is `false`
- `packages/cli/test/stdin-input.test.ts` expects `currentProfilePath` to match `bank/current/...`, but the current output is `bank/profile/current.md`
- `pnpm test:coverage` ⚠️ fails on the same two unrelated assertions
Completed: 2026-03-16
