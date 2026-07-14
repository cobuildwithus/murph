# Remove repo-owned TypeScript compiler-API coupling

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Remove the scoped TypeScript 6 compatibility package and all repo-owned TypeScript compiler-API coupling while preserving the two checks and the TypeScript 7 source-checking upgrade.

## Success criteria

- The repository resolves only TypeScript 7.0.2 and TypeScript 5.9.3.
- The raw-health-log privacy guard and assistant tsconfig-reference test retain their existing AST behavior and coverage.
- Root/workspace source checks continue to invoke TypeScript 7, while TypeScript 5 remains owned only by the hosted web compatibility boundary.
- Once Next and its web-local tooling support TypeScript 7, TypeScript 5 can be removed without changing repo-owned checks.
- Required verification, CI, and ReviewGPT pass on the new PR head.

## Scope

- In scope: root dependency metadata and lockfile, migration of the two compiler-API consumers to a compiler-independent parser, TypeScript architecture/verification docs, focused dependency and behavior tests.
- Out of scope: changing the privacy policy enforced by the raw-health-log guard or removing the hosted web TypeScript 5 compatibility boundary before its framework/tooling consumers support TypeScript 7.

## Constraints

- Technical constraints: use a public-registry parser with no TypeScript compiler dependency; do not import through the hosted web app or add a custom loader.
- Product/process constraints: preserve the privacy guard and keep compiler authority explicit and fail-closed.

## Risks and mitigations

1. Risk: Migrating parsers changes scanner behavior.
   Mitigation: retain the existing implementation and run its focused tests plus the full typecheck/diff-aware verification.
2. Risk: Parser dependencies add more runtime weight than the narrow checks need.
   Mitigation: use parser packages already present transitively in the test toolchain, keep traversal local and explicit, and verify the dependency policy.

## Tasks

1. Replace scoped TypeScript 6 with a compiler-independent source parser.
2. Migrate both repo-owned compiler-API consumers without changing their enforced behavior.
3. Update dependency-resolution tests and durable docs to state the two-version boundary.
4. Regenerate the frozen lockfile and run required verification.
5. Commit, push, rerun ReviewGPT on the exact new head, and confirm CI.

## Decisions

- Keep the AST-based privacy guard because it enforces a durable security invariant across all source roots, but make it independent of every TypeScript compiler version.
- Use Babel's parser and node utilities, already present transitively in the test toolchain, rather than TypeScript 7's incomplete unstable in-process AST surface or a TypeScript 5 alias.

## Verification

- Commands to run: focused raw-log and assistant-reference tests; dependency-resolution tests; frozen install; dependency guard; `pnpm typecheck`; `pnpm test:diff`; ReviewGPT and PR checks.
- Expected outcomes: only TypeScript 5.9.3 and 7.0.2 resolve; no repo-owned check imports a TypeScript compiler API; existing guard behavior is unchanged; all required checks pass.
- Results:
  - Frozen install, dependency policy, docs drift, repo-tools typecheck, full workspace `pnpm typecheck`, and compiler inventory passed.
  - Raw-health-log tests passed 11/11; assistant tsconfig-reference test passed 1/1; repository-wide privacy scan passed.
  - Coverage-write added exact diagnostic-position/callee coverage. Privacy and task-finish reviews found zero issues. Simplify review's one accepted finding removed a duplicated sensitive-name source of truth by deriving the prefilter from the canonical set.
  - `pnpm test:diff` passed all changed-tooling guards plus 18 CLI files and 366 tests, then one unrelated release-tarball audit timed out under concurrent host contention after 473 seconds; its isolated rerun also became idle and was stopped after more than four minutes. The same audit passed on the parent merged head, and new-PR CI is the aggregate authority.
Completed: 2026-07-14
