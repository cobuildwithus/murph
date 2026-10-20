# Adopt tsrs for verification and replace ESLint with Oxlint

Status: completed
Created: 2026-10-20
Updated: 2026-10-20

## Goal

Use faster lint and typechecking for local development and CI while preserving existing verification coverage and build output.

## Success criteria

- Oxlint replaces the Web ESLint command with reviewed Next, React, accessibility and TypeScript rule coverage.
- tsrs runs no-emit workspace, Web and tooling checks through the shared compiler runner with bounded workers.
- Focused runner tests, migrated lint, workspace typechecks and dependency safeguards pass; exact-head CI validates supported hosts.

## Scope

- In scope: pinned tools, runner routing, manifests, lint config, relevant CI caches, regression tests and durable verification docs.
- Out of scope: application behavior, deployment and compiler emission changes.

## Constraints

- Preserve TypeScript 7 emission and Web TypeScript 5 compiler API consumers.
- Preserve supply-chain controls and shared-host resource budgets.
- Keep artifacts free of personal identifiers and use an isolated task worktree.

## Risks and mitigations

1. Migrating lint can lose unsupported rules. Inspect migration output and preserve required rules through supported JS plugins.
2. tsrs is experimental and its platform matrix is narrower. Pin the benchmarked release, preserve the stable emitter and provide explicit compatible-host routing.
3. Incremental caches or watch can hide errors. Exercise error/repair transitions and compiler switching.

## Tasks

1. Inventory and benchmark the current lint configuration; migrate and review rule parity.
2. Add explicit tsrs check routing and preserve emission paths and resource controls.
3. Validate lint, tests, typechecks and dependencies; update owner documentation.
4. Review and commit the scoped change, then obtain hosted CI evidence through the PR workflow.

## Decisions

- Use tsrs for no-emit checks first. The earlier benchmark found identical JavaScript emission but differences in 24 declaration files/maps, so emitted artifacts stay on TypeScript 7.

## Verification

- Planned: runner regression tests, lint baseline/comparison, workspace typecheck, dependency guard/audit/ignored-builds, documentation checks and PR CI.

## Implementation and evidence

- Added an explicit `check` lane for package/tooling no-emit commands; `web` and `watch` also select pinned tsrs. Stable TypeScript 7 remains the emitter, and the Web-local TypeScript 5 API boundary remains intact.
- Supported native hosts are Linux x64/arm64 and macOS arm64. Unsupported hosts retain TypeScript 7. `MURPH_TYPECHECK_COMPILER` permits explicit comparison and rejects unsupported tsrs requests.
- Existing worker limits remain in force; unbounded tsrs defaults are replaced with the prior TS7 four-checker default. CI explicitly selects tsrs and hashes the compiler runner in its cache key.
- Replaced the Web ESLint CLI/config with Oxlint 1.88.0 and retained the existing versions of Next/React/React Hooks plugins for non-equivalent or missing native rules. No runtime application code changed. The 1.89.0 release was still inside the supply-chain waiting period, so the previous mature release is pinned without adding an exemption.
- ESLint baseline: zero errors, 78 warnings. Oxlint: zero errors, 82 warnings. All 74 unused-variable warnings remain; four additional warnings concern two images and two accessibility properties. The same symbol in a multiline declaration has a different diagnostic start line. Legacy suppression comments remain effective.
- Three alternating local CLI benchmark rounds, without lint caches, on the same Apple Silicon host: ESLint 45.197/44.471/43.134 seconds; Oxlint 22.389/21.814/20.981 seconds. Medians 44.471 vs 21.814 seconds, a 2.04x improvement. This is a local CLI comparison, not a Linux/Blacksmith timing claim.
- Earlier compiler evaluation on the same host found cold no-emit improvements of roughly 3–4x across core, tools, Web and Cloudflare, with all 54 package-config checks passing both compilers. Declaration differences are why emission remains on TypeScript.
- Full `pnpm typecheck` passed in 58 seconds including generated prerequisites and guards. The contracts prerequisite continued using TypeScript 7; the package/app fanout used tsrs.
- Runner tests cover platform routing, explicit fallback, no emission, failure and repair across compiler cache switches. Manual watch probe passed initial/error/repair transitions and the session-owned process exited on SIGTERM.
- Focused workspace verification/source-resolution tests passed (61 tests); runner and lint tests passed (21 tests); Health Commons CLI coverage passed (5 tests). Initial lint test assumptions about diagnostic aliases and an impure fixture were corrected to the actual rule behavior; no lint rule was disabled to make a fixture pass.
- Dependency policy, frozen installation, docs drift/gardening and artifact hygiene passed. New tsrs/Oxlint packages have no lifecycle scripts, and build permissions are unchanged. `pnpm deps:ignored-builds` returned zero but reported that it could not identify ignored builds; package manifests and the explicit allowlist were reviewed directly.
- `pnpm deps:audit` fails on existing advisories. Separate baseline and candidate audits have identical advisory IDs and severity counts: 16 low, 92 moderate, 83 high, 11 critical. This migration does not fix that unrelated dependency backlog.
- Complexity guard passes with unchanged existing runner hotspot 28 (debt 8); membership checks avoid increasing its branch count. Parent review keeps the shared budget owner rather than introducing another scheduler or compiler-config parser.
- Final ReviewGPT is exempt for this tooling-only migration: no runtime protocol, state, public API, auth or deployment behavior changed. Existing build and framework compiler boundaries remain in place.
- Hosted exact-head CI is pending PR submission; no claim of hosted execution or deployment is made from local evidence.
Completed: 2026-10-20
