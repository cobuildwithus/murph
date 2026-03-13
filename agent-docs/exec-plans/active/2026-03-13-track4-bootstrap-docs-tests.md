# 2026-03-13 Track 4 Bootstrap Docs Tests

## Goal

Land the user-requested Track 4 follow-up patch as far as it can be applied truthfully on top of the current tree, keeping docs and tests aligned with the already-landed inbox/parser package shape.

## Scope

- `README.md`
- `ARCHITECTURE.md`
- `packages/parsers/README.md`
- `packages/inboxd/README.md`
- `packages/parsers/test/parsers.test.ts`
- coordination cleanup and verification evidence for this lane only

## Constraints

- Do not revert unrelated in-flight work already present in parser/inbox files.
- Keep docs truthful to the current repo state; do not document CLI/setup commands that do not exist in this tree yet.
- Keep verification green under the required repo commands.

## Current state

- Track 1 seams are already present in the tree (`createInboxParserService`, `createParsedInboxPipeline`, `runInboxDaemonWithParsers`).
- Track 3 parser-toolchain commands and bootstrap script are now present in the shared tree (`vault-cli inbox setup|parse|requeue`, `pnpm setup:inbox`, parser toolchain config/discovery helpers).
- Parser auto-drain, runtime requeue, parser-toolchain discovery, and queue-control coverage already exist in current tests; avoid duplicating weaker patch tests in overlapping files.
- The remaining Track 4 gap is keeping top-level and package docs truthful to the now-landed inbox/parser bootstrap path and queue-control surface.

## Planned changes

1. Update top-level and package docs for the inbox/parser package boundaries and derived/runtime storage.
2. Reuse the already-landed parser/inbox test coverage instead of duplicating weaker Track 4 patch tests in overlapping files.
3. Run required checks, record unrelated failures, and commit the exact touched files if the lane remains doc-only.

## Verification notes

- `pnpm typecheck`: fails outside this lane in `packages/contracts/scripts/generate-json-schema.ts` and `packages/contracts/scripts/verify.ts` because `@healthybob/contracts/schemas` is unresolved in the current tree.
- `pnpm test`: fails outside this lane during the shared workspace build in `packages/cli/src/commands/event.ts`, `packages/cli/src/commands/provider.ts`, and `packages/cli/src/commands/provider-event-read-helpers.ts`.
- `pnpm test:coverage`: fails for the same shared workspace build errors as `pnpm test`.
