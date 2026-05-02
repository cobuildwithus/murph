# Hosted mailbox derived payload metadata

Status: completed
Created: 2026-05-02
Updated: 2026-05-02

## Goal

- Make hosted mailbox append compute payload byte count and payload hash from
  `payloadSerializedJson` inside `appendHostedMailboxItemTx`.
- Remove caller authority to supply spoofable payload metadata.

## Success criteria

- `AppendHostedMailboxItemBaseInput` no longer accepts caller-supplied
  `payloadBytes` or `payloadHash`.
- Storage choice, dedupe conflict checks, and inserted rows use metadata derived
  from the exact serialized payload string being encrypted/stored.
- Focused tests prove callers cannot spoof payload byte count or hash.
- Required verification and completion audits pass, or unrelated blockers are
  documented precisely.

## Scope

- In scope:
  - `apps/web/src/lib/hosted-mailbox/store.ts`
  - Direct hosted mailbox tests.
- Out of scope:
  - Prisma schema changes.
  - Changing mailbox payload encryption format or AAD beyond the current append
    metadata invariant.
  - Hosted ingress behavior outside adapting call sites to the tightened append
    input.

## Constraints

- Preserve fail-closed hosted mailbox validation.
- Do not log plaintext mailbox payloads, hashes, raw ciphertext, secrets, or
  direct personal identifiers.
- Preserve unrelated active hosted cleanup work.

## Tasks

1. Inspect append and direct call sites.
2. Move payload byte/hash derivation into `appendHostedMailboxItemTx`.
3. Update focused tests for spoof-resistant metadata.
4. Run focused verification, typecheck/test lanes, and required audits.
5. Close the plan and commit if the scoped commit is safe in the dirty tree.

## Decisions

- Use a narrow execution plan because this touches encrypted hosted mailbox
  persisted metadata and overlaps an active broader hosted cleanup row.

## Verification

- Commands to run:
  - Focused hosted mailbox tests.
  - `pnpm typecheck`
  - Diff-aware verification for touched paths if tractable.
  - `git diff --check`
- Completed:
  - `pnpm --dir apps/web test -- hosted-mailbox-store.test.ts` passed.
  - `bash scripts/workspace-verify.sh test:diff apps/web/src/lib/hosted-mailbox/store.ts apps/web/test/hosted-mailbox-store.test.ts` passed.
  - `git diff --check -- apps/web/src/lib/hosted-mailbox/store.ts apps/web/test/hosted-mailbox-store.test.ts agent-docs/exec-plans/active/2026-05-02-hosted-mailbox-derived-payload-metadata.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md` passed.
  - Security/privacy review passed with no findings.
  - Coverage-write review made no edits and found existing coverage sufficient.
  - Final task review passed with no findings.
  - Post-close `git diff --check` for the touched mailbox/plan/ledger files
    passed.
- Known unrelated blocker:
  - `pnpm typecheck` failed in `apps/cloudflare` on `src/user-runner.ts` and
    `test/user-runner-alarm.test.ts` TS2554 call-arity errors after `apps/web`
    typecheck had passed.
- Commit state:
  - Scoped commit is blocked by overlapping dirty work in
    `apps/web/test/hosted-mailbox-store.test.ts`; the broader hosted cleanup row
    owns the concurrent AAD regression block that this signature change must
    adapt.
Completed: 2026-05-02
