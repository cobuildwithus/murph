# Demo web vault

Status: completed
Created: 2026-03-16
Updated: 2026-03-16

## Goal

- Add a richer repo-owned demo vault fixture that the local web observatory can render meaningfully without pointing at a personal vault.

## Success criteria

- A persistent fixture vault exists under `fixtures/` with profile, goals, journal, events, samples, assessments, and profile snapshot data.
- The web app can be launched directly against that fixture with a documented command.
- The change stays fixture/doc scoped and does not overlap the active CLI/contracts lanes.

## Scope

- In scope:
- new demo vault fixture files under `fixtures/`
- lightweight README updates for the recommended web demo command
- a narrow fixture-verifier adjustment so web-only fixtures are not forced into CLI smoke scenario coverage
- verification for the new fixture against existing web/read-model commands
- Out of scope:
- changing web app behavior
- CLI/contracts/runtime refactors

## Constraints

- Keep the fixture human-reviewable and repo-owned.
- Use canonical file shapes already exercised by query/web tests.
- Avoid personal data and direct identifiers.

## Verification

- `pnpm --dir packages/web test`
- `pnpm test`
Completed: 2026-03-16
