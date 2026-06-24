# Fix assistant input cursor mixed timestamp ordering

Status: completed
Created: 2026-06-24
Updated: 2026-06-24

## Goal

- Assistant input pagination must terminate and return each stored input once
  when legacy cursors without `createdAt` coexist with new cursors that include
  `createdAt`.

## Success criteria

- Mixed `createdAt`/`occurredAt` cursor ordering uses a partner-independent
  timestamp key.
- `listAssistantInputEvents` paginates the A/B/L mixed-state regression until
  empty without duplicates.
- `createStoreBackedAssistantInputSource` proves the same mixed-state ordering
  after crossing its 100-record scan boundary.
- Focused assistant-engine tests, package/diff verification, and typecheck pass.

## Scope

- In scope: `packages/assistant-engine` input cursor tests and any minimal
  comparator correction needed in `input-store.ts`.
- Out of scope: migrations, new runtime state, repeated-cursor guards, or
  broader assistant admission refactors.

## Constraints

- Technical constraints: keep the comparator stateless and retain existing
  tie-breakers after timestamp comparison.
- Product/process constraints: land on `main`, commit through
  `scripts/finish-task`, and push `main` after verification.

## Risks and mitigations

1. Risk: source-level pagination can still loop if filtering skips a full scan
   page and the cursor order is unstable.
   Mitigation: add a source-backed regression with 100 known records before the
   mixed A/B/L records.

## Tasks

1. Re-read current comparator and existing cursor tests.
2. Patch or confirm the partner-independent timestamp key.
3. Add mixed-state store and source regressions.
4. Run focused tests plus required verification.
5. Final-review, finish-task commit, and push `main`.

## Decisions

- The current `main` comparator already uses `cursor.createdAt ??
  cursor.occurredAt`; this task will keep production code unchanged unless a
  later verification pass finds another partner-dependent ordering path.

## Verification

- Commands to run: focused Vitest for assistant input store/source tests,
  `pnpm --dir packages/assistant-engine test:coverage`, `pnpm test:diff` for
  the touched files, and `pnpm typecheck`.
- Expected outcomes: all commands pass.
Completed: 2026-06-24
