# Restore inboxd canonical-evidence authority over runtime dedupe and rebuild

Status: completed
Created: 2026-04-23
Updated: 2026-04-24

## Goal

- Make canonical or recoverable vault evidence the first dedupe authority for `processCapture()`.
- Make `rebuildRuntimeFromVault()` replace the inboxd projection instead of merge-upserting stale rows and parser state.

## Why

- `processCapture()` currently trusts `runtime.findByExternalId()` before it consults canonical or recoverable vault evidence, so a stale `.runtime` row can suppress canonical persistence and still let poll connectors advance cursors and mark messages processed.
- `rebuildRuntimeFromVault()` currently only upserts replayed captures, so stale captures and parser-derived attachment state can survive even when they are no longer backed by canonical inbox evidence.

## Scope

- `packages/inboxd/src/kernel/pipeline.ts`
- `packages/inboxd/src/indexing/persist.ts`
- `packages/inboxd/src/kernel/sqlite.ts`
- directly coupled `packages/inboxd/test/{idempotency-rebuild,inboxd,inboxd-runtime-kernel-coverage}.test.ts`
- `agent-docs/exec-plans/active/{2026-04-23-inboxd-canonical-evidence-rebuild-authority.md,COORDINATION_LEDGER.md}`

## Out of scope

- inbox attachment inspection or CLI command UX changes from the broader active inboxd lane
- Linq-specific connector work already claimed elsewhere
- broader gateway-local projection redesign beyond the minimum inboxd mutation signaling needed for this fix

## Constraints

- Treat vault evidence as authoritative: runtime rows alone must not suppress `persistCanonicalInboxCapture()` or `ensureStoredCaptureCanonicalEvidence()`.
- Rebuild must preserve explicitly local source cursors while clearing capture/search/attachment/job projection state.
- Keep the patch narrow to inboxd runtime persistence and directly coupled regression coverage.
- Coordinate carefully with the broader active `packages/inboxd/**` row by staying on the reported authority/rebuild seam only.

## Risks and mitigations

1. Risk: clearing the projection during rebuild could break downstream incremental readers.
   Mitigation: keep capture mutation signaling explicit for replayed captures and removals, and add focused regression proof.
2. Risk: removing runtime-first dedupe could create duplicate canonical captures.
   Mitigation: keep `findStoredCaptureEnvelope()` and deterministic capture ids as the first dedupe authority, then persist canonically only when no vault-backed evidence exists.
3. Risk: rebuild could accidentally wipe durable local cursors.
   Mitigation: limit the reset to capture/search/attachment/job projection tables and add a cursor-preservation assertion.

## Tasks

1. Register the narrow lane and inspect the current inboxd pipeline, rebuild, and mutation behavior.
2. Patch `processCapture()` so vault-backed evidence is consulted before any runtime dedupe path.
3. Add an inboxd runtime projection-replacement path that clears stale capture/search/attachment/job state, preserves cursors, and replays canonical/recoverable evidence.
4. Preserve mutation visibility for replayed captures and removed stale captures during rebuild.
5. Add focused regression tests, run the required verification lane, then complete the required audits and scoped commit flow.

## Verification

- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/inboxd/src/kernel/pipeline.ts packages/inboxd/src/indexing/persist.ts packages/inboxd/src/kernel/sqlite.ts packages/inboxd/test/idempotency-rebuild.test.ts packages/inboxd/test/inboxd.test.ts packages/inboxd/test/inboxd-runtime-kernel-coverage.test.ts`
- `pnpm --dir packages/inboxd test:coverage`
- `pnpm test:smoke`

## Direct proof

- A stale runtime-only capture row no longer suppresses canonical inbox persistence or parse-job creation.
- A rebuild removes stale runtime-only captures, resets parser-derived attachment state, preserves source cursors, and keeps deletion/update mutation signals visible to downstream readers.
Completed: 2026-04-24
