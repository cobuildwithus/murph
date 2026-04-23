# Fix inboxd replay capture identity and mutation cursor stability

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Keep inboxd replay deterministic: canonical envelopes must restore their own deterministic `captureId` and attachment ids into `.runtime`, and rebuilds must not manufacture fresh mutation cursors when the replayed capture state is unchanged.

## Success criteria

- Replaying canonical inbox evidence no longer reuses a mismatched pre-existing runtime `capture_id` for the same `(source, accountId, externalId)` tuple.
- When replay sees a runtime collision on external id with a different `capture_id`, the stale runtime row is replaced so the replayed runtime row uses the canonical envelope `captureId`.
- Stored attachment ids are validated against the effective capture id before runtime persistence so a replayed capture cannot mix one capture id with another capture's deterministic attachment ids.
- Re-running `rebuildRuntimeFromVault()` with unchanged canonical evidence leaves `listInboxCaptureMutations()` / `readInboxCaptureMutationHead()` stable instead of minting new cursors for no-op updates.
- Focused `packages/inboxd` regressions cover both the stale-runtime-row replay case and the repeated no-op rebuild case.
- Required verification, required audit passes, and a scoped landing complete, or any exact blocker is recorded.

## Scope

- In scope:
  - `packages/inboxd/src/kernel/sqlite.ts`
  - directly coupled `packages/inboxd/test/inboxd-runtime-kernel-coverage.test.ts`
  - `agent-docs/exec-plans/active/{2026-04-23-inboxd-replay-identity-and-cursor-guards.md,COORDINATION_LEDGER.md}`
- Out of scope:
  - the already-claimed inboxd persistence lane on `packages/inboxd/src/{indexing/persist.ts,shared.ts}` and its coupled recovery tests
  - the separate active `packages/inboxd/**` attachment-command lane tracked in the shared ledger
  - Linq connector / normalization work already claimed elsewhere in `packages/inboxd/src/connectors/linq/**`
  - broader inboxd schema redesign or a full replay-reset rewrite that drops existing runtime state wholesale

## Constraints

- Technical constraints:
  - Treat the canonical replay envelope as authoritative for runtime `captureId`; do not silently keep a mismatched runtime row just because the external-id uniqueness key collides.
  - Keep mutation-cursor stability scoped to no-op replay updates instead of weakening real mutation signals for actual capture or attachment changes.
  - Preserve rebuildability: any stale-row replacement should use local runtime delete/replace semantics rather than inventing new canonical state.
  - Stay out of the already-claimed `persist.ts` / `shared.ts` seam and enforce the attachment-id invariant inside the SQLite runtime boundary instead.
- Product/process constraints:
  - Treat this as high-risk persisted-state work and capture direct proof in addition to the required package verification lane.
  - Follow the plan-bearing repo workflow, including required `coverage-write` and `task-finish-review` passes.

## Risks and mitigations

1. Risk: a no-op guard that is too broad could suppress legitimate runtime mutation signals for real capture or attachment edits.
   Mitigation: add equality guards only around the replay upsert paths so the update branch runs when indexed capture fields or attachment fields actually change.
2. Risk: replacing a stale runtime row could drop parse-job state or attachment rows for an unrelated in-flight record.
   Mitigation: scope replacement to the exact `(source, accountId, externalId)` collision where the runtime `capture_id` differs from the canonical replay `captureId`, and re-enqueue parse jobs from the canonical attachments after replacement.
3. Risk: attachment-id validation could break fixture-only noncanonical ids rather than real product behavior.
   Mitigation: update the directly coupled SQLite runtime fixture to use the canonical deterministic attachment-id shape instead of weakening the runtime invariant.

## Tasks

1. Register the narrow inboxd replay lane in the coordination ledger and confirm the current replay / trigger behavior against the reported issues.
2. Patch SQLite runtime capture upserts so replayed canonical `captureId` values replace stale colliding runtime rows and attachment ids are validated against the chosen capture id.
3. Add no-op guards to the SQLite capture and attachment upsert paths so unchanged replay updates do not advance mutation cursors.
4. Add focused SQLite runtime regressions for stale-row replacement and repeated no-op replays, then run the required inboxd verification and audits.

## Decisions

- Prefer narrow SQLite upsert guards over a broad "clear runtime tables before rebuild" reset so rebuilds keep valid runtime rows and parse state when canonical evidence is unchanged.
- Replace stale colliding runtime rows in `upsertCaptureIndex()` instead of mutating replayed canonical envelopes to fit the stale runtime identity.
- Enforce attachment-id ownership from the chosen capture id inside the SQLite runtime upsert path so replayed attachments cannot silently drift across captures without touching the already-claimed shared helper seam.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/inboxd/src/kernel/sqlite.ts packages/inboxd/test/inboxd-runtime-kernel-coverage.test.ts`
  - `pnpm --dir packages/inboxd test:coverage`
  - `pnpm test:smoke`
- Direct proof:
  - Run the focused inboxd rebuild regressions proving replay replaces a stale runtime row with the canonical deterministic `captureId` and a second unchanged rebuild does not advance the mutation head.
- Expected outcomes:
  - Canonical replay keeps runtime capture and attachment identities aligned.
  - Repeated no-op rebuilds preserve mutation-cursor stability while real capture or attachment changes still surface through the mutation feed.
- Results:
  - Passed: `pnpm --dir packages/inboxd exec vitest run test/inboxd-runtime-kernel-coverage.test.ts --config vitest.config.ts --no-coverage`
  - Passed: `pnpm --dir packages/inboxd test:coverage`
  - Passed: `pnpm test:smoke`
  - Passed: `git diff --check -- packages/inboxd/src/kernel/sqlite.ts packages/inboxd/test/inboxd-runtime-kernel-coverage.test.ts agent-docs/exec-plans/active/2026-04-23-inboxd-replay-identity-and-cursor-guards.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  - Unrelated blocker: `pnpm typecheck` fails in pre-existing `packages/device-syncd/test/{service,store-test-helpers}.ts` errors.
  - Unrelated blocker: `bash scripts/workspace-verify.sh test:diff packages/inboxd/src/kernel/sqlite.ts packages/inboxd/test/inboxd-runtime-kernel-coverage.test.ts` fans out into pre-existing `packages/inbox-services`, `packages/assistant-cli`, and `packages/vault-usecases` type errors outside this lane.
  - Required audit passes completed with no blockers: `coverage-write` found no missing proof, and `task-finish-review` reported no findings.
Completed: 2026-04-23
