# Progress BE0 contract and persistence

Status: completed
Created: 2026-11-16
Updated: 2026-11-16

## Goal

- Supply the BE0 wire contract, sealed persistence and synthetic board responses
  needed by the Progress backend and native lanes.

## Success criteria

- Four additive tables with member cascades and field classification.
- Awards retain their crossing day and survive repeated or shrinking inputs.
- Competing measure patches cannot lose another lane's state.
- All board fixtures decode with the wire types; private friends expose no amount,
  rank, chart line or gap.
- Relevant PostgreSQL tests and typecheck pass; run the requested diff selector,
  resolve detected failures with focused proof, and open a PR.

## Scope

- In scope: contract/parsers, crypto adapter, four tables, state CAS, award
  settle/read/seen, registry types/constants, golden responses and tests.
- Out of scope: route handlers, engines, inference, map/media effects, native UI,
  deployment, ReviewGPT and merge. The integrator owns review and integration.

## Constraints

- Follow the locked plan's decisions and defensiveness budget. No retries,
  swallowed errors, flags, extra state owners or speculative configuration.
- All private content is sealed before writes; keyed lookups use the existing
  privacy owner. Only synthetic people/data enter fixtures.

## Risks and mitigations

1. Lost updates: compare the observed ciphertext, including first-create races.
2. Late authority loss: required transaction callback on every mutation helper.
3. Misleading mock proof: fixtures reproduce presentation, while engine scoring
   and native screenshot proof remain with their lanes.

## Tasks

1. Read locked plan, applicable owners and all board rows used by this lane.
2. Implement contract, schema and persistence at existing owners.
3. Build complete synthetic response fixtures and focused invariant tests.
4. Run checks, inspect privacy/scope, commit, push and open draft PR; mark ready
   after local checks. Wait for required exact-head CI; do not merge.

## Decisions

- Required authority callbacks refine the abbreviated persistence signatures;
  they avoid alternate mutation entrypoints and preserve live session/health checks.
- Synthetic names use the authorized six-name set; Jordan replaces other names
  in mocks. Fourteen-friend fixtures use distinct ids with repeated first names.
- No unchecked Iceland suggestion or extra heart pill on Friends.
- Public fields beyond the starting sketch serve existing screens: independent
  health chart dates, invite/join labels, exact consent audience, existing avatars,
  the plan's incomplete-input result, today's streak obligations (row 11), route
  completion history/picked-for-you (rows 09/15), and health medal faces/age-chart
  amounts (rows 02/06). `departureNotice` represents row 16's footer; BE2 must
  resolve its surviving source after account deletion.
- Open integration details: the plan's map query has no preview identity; the
  deleted-friend footer has no surviving name/date owner; no-game projection is
  null in the locked compute rule although the board shows a next-number label.
  These do not require extra BE0 storage or endpoints.

## Verification

- Schema validate/generate and full migration deployment to an isolated local
  test database: passed, exit 0.
- Focused contract/crypto/privacy-guard tests: 99 passed, exit 0 (53 complete
  response fixtures).
- Focused PostgreSQL tests: 12 passed, exit 0, including both CAS races.
- Web typecheck, complexity, focused lint, docs drift and diff whitespace: exit 0.
- Requested `pnpm test:diff` over all changed paths: exit 1 after 15,428 passed
  tests and one privacy-schema expectation failure. Added the five reviewed
  cascade relations to that existing guard; all 11 guard cases pass in the final
  focused run. No runtime change was needed. Required exact-head CI remains the
  PR gate; the broad local suite is not repeated for an expectation-only repair.
Completed: 2026-11-16
