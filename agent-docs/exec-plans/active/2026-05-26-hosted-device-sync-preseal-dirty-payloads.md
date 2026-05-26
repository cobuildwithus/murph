# Hosted device-sync dirty payload preseal

Status: active
Created: 2026-05-26
Updated: 2026-05-26

## Goal

- Shorten hosted device-sync dirty-state transaction time by moving zstd
  compression and secure-box sealing for dirty payload rows outside the
  store-owned interactive Prisma transaction wherever the AAD is already known.

## Success criteria

- Store-owned `upsertDirtyConnection()` calls precompute encrypted dirty
  payload rows before opening `$transaction`.
- Caller-owned transaction calls keep current transactional semantics and still
  seal through the provided transaction client.
- Dirty payload AAD, deterministic payload ids, persisted rows, and returned
  runtime resources remain unchanged.
- Focused tests prove the preseal path and caller-owned transaction exception.

## Scope

- In scope:
  - `apps/web/src/lib/device-sync/prisma-store/dirty-connections.ts`
  - `apps/web/test/prisma-store-dirty-connections.test.ts`
- Out of scope:
  - Changing dirty payload codec format or secure-box AAD.
  - Changing device-sync wake/recovery scheduling semantics.
  - Editing unrelated active assistant-runtime or device-sync work.

## Constraints

- Technical constraints:
  - Preserve Prisma transaction retry/contention behavior.
  - Do not weaken encryption, AAD binding, or fail-closed payload handling.
  - Keep helper boundaries small and package-local.
- Product/process constraints:
  - Do not expose provider payloads, user ids, local paths, or secrets in logs,
    tests, docs, or commit output.
  - Preserve unrelated working-tree edits.

## Risks and mitigations

1. Risk: Precomputed payload rows use a stale dirty revision after a
   transaction retry.
   Mitigation: Prepare payload rows separately for the known revision path used
   by each transaction attempt, and keep caller-owned transactions on the old
   in-transaction helper.
2. Risk: Returned dirty resources lose the deterministic `dirtyPayloadId`.
   Mitigation: Build the resource-with-id array together with the row data and
   keep existing hydration tests green.

## Tasks

1. Inspect existing dirty connection and dirty payload helpers.
2. Refactor store-owned upsert paths to precompute sealed payload rows before
   the interactive transaction.
3. Add focused tests for outside-transaction sealing and caller-owned
   transaction behavior.
4. Run scoped hosted-web tests, typecheck, audits, and final review.
5. Finish and commit the plan-bearing task.

## Decisions

- Keep `createDirtyPayloadRows()` as the DB insertion helper and introduce a
  separate preparation helper so the transaction body only inserts already
  sealed rows when no caller-owned transaction is supplied.

## Verification

- Commands to run:
- `pnpm --dir apps/web test -- test/prisma-store-dirty-connections.test.ts`
- `pnpm test:diff apps/web/src/lib/device-sync/prisma-store/dirty-connections.ts apps/web/test/prisma-store-dirty-connections.test.ts`
- `pnpm typecheck`
- `git diff --check`
- Expected outcomes:
- Focused tests and diff-aware verification pass without printing payloads or
  secrets.
