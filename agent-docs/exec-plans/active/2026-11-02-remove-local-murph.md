# Retire local Murph product surfaces

Status: active
Created: 2026-11-02
Updated: 2026-11-02

## Goal

Delete local Murph entrypoints and polling runtime while preserving the hosted product.

## Success criteria

Four scoped commits remove OpenClaw, setup and the murph binary, local assistant wrappers, and inbox polling. Hosted onboarding paths and single-pass maintenance remain intact. Generated contracts, affected tests, typechecks, workspace guards, and runner assembly pass.

## Scope

Slices 1–4 of the reviewed removal map, plus the murph binary. Keep device daemon tooling, hosted-local development, shared delivery and persistence, and npm release machinery except OpenClaw. Completed plans remain immutable.

## Constraints

Work only in the assigned isolated checkout. No pushes, PRs, production access, or stashes. Use real generators, public package entrypoints, scoped commit helpers, and the existing supply-chain policy.

## Risks and mitigations

- Preserve hosted onboarding by moving its registration and tests before deleting assistant-cli.
- Preserve hosted maintenance and normalization by tracing callers and splitting mixed tests.
- Update every runner binary expectation together and run full assembly to verify startup and package shape.

## Tasks

1. Remove OpenClaw package and inventories; verify and commit.
2. Remove setup, model picker, and murph binary; regenerate contracts; verify and commit.
3. Move hosted onboarding; delete assistant wrappers and continuous loop; verify and commit.
4. Remove inbox polling; narrow retained services; complete docs, verification, review, and final plan-bearing commit.

## Decisions

- Hosted members use channels and iOS; vault-cli remains the runtime/operator binary.
- No hosted behavior change is intended beyond removing obsolete runtime prompt guidance.
- No publication or external review is started because the task explicitly forbids pushing and PRs.

## Verification

### Slice 1

- Removed OpenClaw source, tests, distribution assets, release entry, build/test inventories, and active documentation.
- Passed: pnpm install; pnpm build; pnpm verify:workspace-boundaries; pnpm verify:workspace-package-cycles; pnpm deps:guard; pnpm no-js; pnpm docs:drift; pnpm --dir packages/cli typecheck; focused release-script-coverage-audit tests (38 passed, one opt-in tarball test skipped).
- Initial release audit exposed ignored residue in the removed directory; removing the entire retired directory fixed it. The workspace coverage guard also required its expected owner count to decrease from 26 to 25.
- Full pnpm test:repo-tools is running; focused workspace-verify and release-verification-lanes rerun passed (61 tests).

CI-only broad coverage and production deployment remain outside this task.

### Slice 2

Removed setup-cli, operator setup helpers, model picker, setup wrappers and root scripts, the murph binary, terminal UI dependencies, and the local installer and its landing-page entrypoints. Retained hosted signup, device tooling, and all four hosted onboarding commands.

Generated the CLI schema, Incur command types, skill hash, and prepared runtime with the real generators. Workspace build and CLI/assistant-engine/operator-config/inbox-services/Web/Cloudflare typechecks pass. Operator-config tests: 455 passed; inbox-services tests: 67 passed; Web landing tests: 3 passed; focused prompt/access tests: 64 passed. CLI full suite passed 1396 tests before two stale expectations failed; both corrected and focused rerun passed 86 tests. Edited engine tests passed except one prompt digest snapshot, regenerated with Vitest and verified. Cloudflare Node workspace passed 4643 tests before two stale package/schema expectations failed; corrected focused rerun passed 12 tests. Containers helper passed 20 tests. The full verify:cli gate passed: 357 tests in 20 files, typechecks, prepared runtime, and package shape.

The repository-tool full run passed 880 tests and failed 28: one obsolete package count was fixed and its focused suite passed; 27 pre-existing review-context fixture tests attempt Git commits with a non-noreply synthetic email rejected by the machine privacy hook. Both fixture source files are byte-identical to origin/main. No guard was weakened.

Product UX: retired local install links and instructions are removed; hosted signup and account routes remain. Hosted channel/onboarding behavior is covered by the preserved runtime contracts. Source readback confirms hosted sections remain; rendered readback and focused real-Codex proof remain pending.

Full runner assembly passed: CLI total 9,532,087 bytes, startup closure 19,857 bytes (33,200 budget); runner entry 77,854 bytes, static boot closure 2,014,162 bytes versus recorded 2,047,343 baseline (-33,181 bytes), 22 chunks, total 12,430,391 bytes. Exact origin/main bundle delta is deferred to final measurement.
