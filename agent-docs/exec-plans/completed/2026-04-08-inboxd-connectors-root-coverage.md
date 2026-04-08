# Inboxd Connectors Root Coverage

## Goal

Raise the owned `packages/inboxd` email and iMessage connector seams above the shared root per-file coverage gate without changing package or root coverage policy.

## Scope

- Allowed source files:
  - `packages/inboxd/src/connectors/email/connector.ts`
  - `packages/inboxd/src/connectors/email/normalize.ts`
  - `packages/inboxd/src/connectors/email/normalize-parsed.ts`
  - `packages/inboxd/src/connectors/email/parsed.ts`
  - `packages/inboxd/src/connectors/imessage/connector.ts`
- Allowed tests:
  - `packages/inboxd/test/inboxd-connectors-coverage.test.ts`
  - `packages/inboxd/test/email-connector-coverage.test.ts`
  - `packages/inboxd/test/imessage-connector-edge.test.ts`

## Constraints

- Preserve existing dirty edits outside the owned files.
- Do not touch root/shared coverage config or other inboxd seams.
- Prefer deterministic tests and existing package-local helpers.
- Verify with package-local commands using `pnpm --config.verify-deps-before-run=false` as needed.

## Plan

1. Inspect the owned connector source and current tests to identify the remaining uncovered branches.
2. Add the smallest deterministic test coverage and only the minimal source changes needed to make hard-to-reach branches testable.
3. Run package-local typecheck and coverage until the owned files clear the root per-file gate.
4. Run the required final review, then hand off exact commands, coverage evidence, and changed files.

## Outcome

- Added targeted iMessage connector edge tests only in `packages/inboxd/test/imessage-connector-edge.test.ts`.
- No package runtime source or coverage-config changes were needed in this lane.
- Package-local `typecheck` passed.
- Package-local `test:coverage` still fails for unrelated existing `telegram` and `persist` seams, but the owned files now clear the shared root per-file gate:
  - `src/connectors/imessage/connector.ts`: `97.79 / 89.07 / 100 / 97.77`
  - `src/connectors/email/connector.ts`: `94.28 / 84.93 / 90.47 / 94.28`
  - `src/connectors/email/normalize.ts`: `91.91 / 82.09 / 91.3 / 91.91`
  - `src/connectors/email/normalize-parsed.ts`: `98 / 80 / 100 / 97.87`
  - `src/connectors/email/parsed.ts`: `88.5 / 81.92 / 100 / 88.77`
- A read-only local review worker was launched for the required final audit but did not return findings before being treated as stuck and stopped.
