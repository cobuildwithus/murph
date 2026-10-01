# Preserve complexity ratchets across exact function moves

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal

Allow exact function relocation without new complexity debt while preserving the per-file debt and maximum ratchets for edited or newly introduced code.

## Success criteria

- Actual Git CLI fixtures accept exact moves and reject copies, changed bodies, reused donors, and unrelated regressions.
- Focused repo-tool tests, tools typecheck, and the complexity guard pass.
- Publish a scoped draft prerequisite PR for the six responsibility extractions; the parent owns candidate review, CI, and readiness.

## Scope and ownership

The existing Babel-based complexity script owns parsing, Git comparison, and reporting. Extend that owner without new dependencies, runtime state, thresholds, or source exclusions. Tests remain in its existing test file. Product UX, runtime behavior, and deployment are unaffected.

## Evidence and design

The existing evaluator compares changed files independently. Moving a complex function yields matching source debt reduction and destination increase, but the destination fails. Derive exact function identity from the existing parsed AST, excluding source metadata and comments. Reserve same-file occurrences before pairing removed and added functions once. Remove matched functions from both ratchet sides, preserving full source summaries and hotspot visibility in reports. This prevents either donor or recipient from hiding an unrelated regression.

## Risks and mitigations

- Copy or duplicate allowance: consume same-file instances first, then each removed donor at most once.
- Changed bodies or signatures: retain their AST fields in the fingerprint.
- Nested complexity: retain independent traversal frames and test nested moves and modified wrappers.
- Failure and evolution: parse and Git failures stay fail-closed; no persisted state or runtime rollout changes.

## Tasks

1. Add composed Git-diff regression cases and exact move accounting at the existing owner.
2. Run focused tests, tools typecheck, complexity, and privacy/diff review.
3. Record the reproducible Frog entry, close this plan, commit, push, and open a draft PR for parent review.

## Verification

- Passed: `pnpm exec vitest run --config scripts/vitest.config.ts --no-coverage scripts/check-cyclomatic-complexity.test.ts` (25 tests).
- Passed: `node scripts/run-typescript.mjs package -p tsconfig.tools.json --pretty false` after the full frozen offline dependency install resolved missing workspace dependencies from the initial root-only installation.
- Passed: `pnpm complexity:diff --base b2a559812972d70644cffb2bf43923fc9211047d`; changed tooling has debt zero and maximum 17, both unchanged.
- Passed: `git diff --check` and privacy-safe diff review.
- Read-only integration checks passed on the document evidence, group tool context, and provider diagnostic extraction candidates, matching 32, 16, and 63 moved frames respectively while preserving their reported hotspots.
- The synthetic async typed function with trailing commas failed before position normalization and passed afterward. Babel's `parenStart` and `trailingComma` extras are source offsets; syntax-bearing extras remain part of identity.
- Logged task-owned Frog entry `20260910111447-complexity-guard-rejects` and updated the existing testing map. Product UX and changelog are not applicable because this changes internal verification only.
- Parent owns the draft PR's final review, exact-head CI, and readiness; no merge or deployment is part of this prerequisite task.
Completed: 2026-09-10
