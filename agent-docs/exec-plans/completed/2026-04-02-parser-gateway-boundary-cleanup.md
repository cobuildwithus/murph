# Parser And Gateway Boundary Cleanup

## Goal

Remove the remaining `@murphai/parsers -> @murphai/inboxd` and `@murphai/gateway-local -> @murphai/assistant-core` dependency leaks by moving parser/inbox composition to the inbox owner and by inverting gateway-local's assistant-backed projection/send wiring.

## Scope

- Extract the parser runtime contracts that `@murphai/parsers` needs into `@murphai/parsers` itself and remove its direct dependency on `@murphai/inboxd`.
- Move the inbox-plus-parser composition helpers to `@murphai/inboxd`, update call sites, tests, and package exports accordingly.
- Define gateway-local adapter contracts in a shared lower layer, remove the direct `@murphai/assistant-core` dependency from `@murphai/gateway-local`, and make higher layers inject the assistant-backed implementation.
- Update the small set of runtime and test callers that currently rely on gateway-local's assistant defaults.

## Constraints

- Preserve runtime behavior; this is an ownership cleanup, not a user-visible feature change.
- Do not introduce workspace dependency cycles.
- Preserve unrelated dirty worktree edits and keep this refactor limited to the two package-boundary seams discussed with the user.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`

## Outcome

- Completed. Removed the `parsers -> inboxd` and `gateway-local -> assistant-core` boundary leaks, fixed the hosted gateway-send proof gap in the root suite, and updated the first-chat health-goals wording.
Status: completed
Updated: 2026-04-02

## Final Verification

- `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-events.test.ts --no-coverage`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
Completed: 2026-04-02
