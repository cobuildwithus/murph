# Simplify experiment UI test contracts

Status: completed
Created: 2026-09-04
Updated: 2026-09-04

## Goal

Remove tests that freeze implementation spelling or replay mocks, while retaining experiment route, stale-contract, start-action and private-run protection.

## Scope and ownership

Only experiment UI tests change. Production components, query owners, persistence and authorization remain unchanged. Existing layout/header composition and Browser Vault core fixtures provide proof without new harnesses, dependencies or abstractions.

## Evidence and decisions

- The client suite mocks tabs, protocol/results components and a run resolver that its tested components no longer consume.
- Two contact-context tests call a direct export alias and compare mocked return values; the contact-context owner retains its behavior tests.
- The greenfield version assertion pins a constant; the retained stale-version render test protects refresh behavior.
- Route projection tests assert exact resolver spellings and an absent substring. Keep executable metadata, canonical alias, draft rejection and projection parity tests; the separate route-bundle boundary suite remains responsible for dependency constraints.
- Render the real header in layout tests, asserting a visible start action on the protocol route and its absence on results routes. Construct the server layout to prove it does not await contact reads before returning its deferred tree.

## Tasks

1. Remove dead doubles, alias tests and source-string assertions.
2. Replace mocked header prop checks with rendered layout/header assertions.
3. Run focused tests, web typecheck and complexity check; inspect privacy and full diff.
4. Parent candidate review approved; scoped commit and PR handoff.

## Risks and proof

Real components may expose assumptions in the existing DOM harness. Use existing facilities only. Retain the active/paused run tests backed by the real Browser Vault core client, disabled start fallback, stale payload refresh, canonical route selection, route metadata and draft rejection.

## Verification

- Focused Vitest: 29 companion tests passed in the page-projection, contact-context and route-bundle suites; the updated client-contract suite passed all 8 tests after platform setup corrections.
- Real header rendering reuses the existing Linkedom harness with its native Element global; Next Image is a plain image adapter alongside the existing Next Link/navigation adapters.
- Web typecheck: initial clean-worktree attempt found an absent device-syncd service declaration. The existing package build passed; the full web typecheck rerun passed. Shared setup friction is tracked by the sibling cleanup lane.
- Complexity guard passed with no production JS/TS to analyze. Final diff removes 152 test lines and adds 20; no production code or dependency changes.
- Parent candidate review approved the retained proof. The page-projection suite still renders the actual server/client/header composition and asserts its deferred start slot renders; the client suite now checks visible heading/start action and results-route suppression.
- Test-only change: no product behavior, deployment contract or changelog outcome changes.
Completed: 2026-09-04
