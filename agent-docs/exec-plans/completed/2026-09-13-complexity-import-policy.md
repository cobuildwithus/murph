# Simplify workspace import policy

Status: completed
Created: 2026-09-13
Updated: 2026-09-13

## Outcome and invariant

Reduce the import-policy hotspot (cyclomatic complexity 126) while preserving every admitted import and exact first-failure diagnostic. The existing workspace boundary scanner remains the only policy owner. No production behavior, persisted state, or deployment contract changes.

## Evidence and approach

The current remote base is b7b467b9a2a42068bc45c6d0e4e6e25cc4a09809. The repository analyzer inspected 3,333 authored JS/TS files with zero parser errors and found 855 functions above 20. This function ranks seventh. Repeated binding restrictions duplicate member, specifier, path and imported-name matching. Represent those restrictions as ordered data using the existing binding matcher. General import restrictions remain explicit and precede binding restrictions; their predicates are disjoint from the binding rules except empty imports, whose existing priority is preserved.

## Scope and risks

Only the import-policy owner, focused regression proof, and this plan. No new dependency or general policy framework. Preserve named, aliased, namespace and default binding detection; test member/path exceptions and diagnostic precedence. Eight merged, clean inactive checkouts passed guarded retirement preflight to make room for the requested ten independent PRs.

## Tasks

1. Replace repeated binding branches with ordered rule data.
2. Run existing tests, independent base/head differential cases, syntax/type checks, and complexity ratchet.
3. Review privacy and full diff; commit; open a draft PR; mark Ready and start final ReviewGPT concurrently with CI.
4. Resolve the final review and exact-head CI.

## Verification

Passed: 42 focused import-policy tests; 17,622 synthetic base/head cases with exact diagnostic equality; tools typecheck (`node scripts/run-typescript.mjs package -p tsconfig.tools.json --pretty false`); Node syntax check; whitespace check; complexity ratchet (126 to 54, debt reduced by 72). The remaining explicit general-boundary conditions protect distinct owner exceptions; further conversion would enlarge the matching schema. Parent diff review confirmed the binding rules preserve their original order and constraints. No changelog: internal repository tooling only. Final ReviewGPT and exact-head CI remain PR completion gates owned by the originating session.
Completed: 2026-09-13
