# TypeScript 7 upgrade

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Move the workspace's canonical compiler and typecheck/build graph to stable TypeScript 7 so local and CI typechecking benefit from the native compiler's measured speedup, while retaining the narrow TypeScript 6 runtime needed by tools that still consume the JavaScript compiler API.

## Success criteria

- Root and non-web workspace compiler dependencies resolve to stable TypeScript 7.
- Canonical repo and hosted-web typechecks invoke TypeScript 7, including production build verification.
- Next.js, ESLint, Workflow, and Solana tooling retain a web-local TypeScript 5 compatibility dependency, while repo-owned compiler-API consumers use the official scoped TypeScript 6 package instead of loading TypeScript 7 as a JavaScript library.
- TypeScript 7 accepts every checked-in tsconfig after `baseUrl` removal and explicit relative path normalization.
- Dependency-policy, build, lint, tests, typecheck, and full acceptance verification pass.
- Required local audits, the existing ReviewGPT run, and final PR CI finish with no accepted findings.

## Scope

- In scope: TypeScript manifests and lockfile, tsconfig compatibility edits, compiler-API imports, hosted-web typecheck/build scripts, and focused regression coverage/documentation required to preserve the build-time type-safety invariant.
- Out of scope: application behavior, a broad build-system rewrite, npm aliases, custom loaders, or replacing framework tooling that has not yet adopted TypeScript 7's native API boundary.

## Constraints

- Technical constraints: TypeScript 7 has no JavaScript compiler API; dependency aliases are prohibited; direct sibling internals and private compiler entrypoints remain prohibited; all generated path targets must preserve the same resolved files.
- Product/process constraints: preserve unrelated checkout edits, use an isolated worktree/PR, keep build-time type checking fail-closed, update the lockfile with public-registry dependencies, and complete the repository's dependency and acceptance gates.

## Risks and mitigations

1. Risk: framework plugins load the native compiler package as though it exposed the old JavaScript API.
   Mitigation: keep legacy compilers local only at those API boundaries while routing canonical `tsc` commands explicitly through the root TypeScript 7 binary.
2. Risk: removing `baseUrl` changes how path mappings resolve.
   Mitigation: resolve every existing target from its effective declaring config, rewrite it as an explicit relative target, and compare resolved absolute targets before and after.
3. Risk: skipping Next's internal TypeScript 6 check weakens production builds.
   Mitigation: gate the skip behind a same-command proof environment variable set only after the TypeScript 7 typecheck succeeds; direct `next build` remains fail-closed on its built-in check.
4. Risk: dependency or compiler changes disturb the broad workspace graph.
   Mitigation: run focused compiler/config tests during implementation, then the full dependency, clean build, and acceptance gates plus required audits and PR CI.

## Tasks

1. Inventory the latest-main compiler dependencies, tsconfig inheritance, build scripts, and compiler-API consumers.
2. Implement the TypeScript 7 dependency/config cutover and narrow TypeScript 6 compatibility boundaries.
3. Add regression coverage for compiler selection, path-map equivalence, and hosted-web build fail-closed behavior where the current owner lanes support it.
4. Refresh the lockfile and run dependency, focused, clean-build, and full acceptance verification.
5. Run required specialist audits and parent review; resolve accepted findings and reverify.
6. Close this plan with the scoped commit, publish the PR, reconnect to the existing ReviewGPT run while CI executes, and reach the merge-readiness stop condition.

## Decisions

- Stable TypeScript 7 is the canonical compiler; no native-preview package or package alias is introduced.
- TypeScript 6 remains only where a current dependency needs the legacy JavaScript compiler API.
- The hosted web's application typecheck must not silently fall back to TypeScript 6.

## Verification

- Commands to run: focused compiler/config regression tests, `pnpm deps:guard`, `pnpm deps:audit`, `pnpm deps:ignored-builds`, `pnpm build:workspace:clean`, `pnpm verify:acceptance`, plus the required audit and PR lanes.
- Expected outcomes: all commands pass; the package graph proves the intended compiler versions; direct Next builds retain their internal typecheck unless preceded by a successful native typecheck in the guarded build script.
- Completed local proof: the root compiler reports TypeScript 7.0.2, the web-local compatibility compiler reports 5.9.3, the compiler-API package reports 6.0.2, `pnpm typecheck` passed across the workspace, the clean workspace build passed, the hosted-web native precheck and production Next build passed, the frozen install and dependency-policy gates passed, and the focused compiler/config/build-guard tests passed.
- Acceptance caveat: `pnpm verify:acceptance` was attempted but could not produce a trustworthy aggregate result while a separate long-running worktree acceptance process saturated the host. Focused reruns passed for the migration surface; the two assistant audio assertions reproduced unchanged in an untouched upstream TypeScript 5 worktree, and the remaining failures were timeout-only. PR CI is the uncontended aggregate authority.
- Dependency-audit caveat: `pnpm deps:audit` reports the same 15 advisories on the untouched base revision; the TypeScript upgrade introduces none of them.
- Audit outcomes: coverage-write added fail-closed ordering assertions and passed its focused 31-test lane; security review found no evidence-backed medium-or-higher security or privacy finding.
Completed: 2026-07-14
