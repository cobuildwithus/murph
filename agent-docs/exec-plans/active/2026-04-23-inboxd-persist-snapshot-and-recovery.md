Status: active
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Fix the reported inboxd raw-attachment snapshot mismatch and raw-only recovery identity gaps without widening beyond the inbox persistence seam.

## Success criteria

- File-backed attachments are snapshotted before any persisted hash/size metadata is derived, so the committed raw bytes, stored `sha256`, and stored `byteSize` all describe the same artifact.
- In-memory attachments always prefer measured committed bytes over caller-supplied metadata.
- Raw-only crash recovery no longer depends on the current `occurredAt`-derived envelope or ledger shard path when the deterministic capture identity is unchanged.
- Focused inboxd regressions cover both the snapshot-integrity path and the raw-only recovery path.

## Scope

- In scope:
- `packages/inboxd/src/indexing/persist.ts`
- `packages/inboxd/src/shared.ts`
- directly coupled `packages/inboxd/test/{idempotency-rebuild,inboxd-runtime-persist-edge-coverage}.test.ts`
- `agent-docs/exec-plans/active/{2026-04-23-inboxd-persist-snapshot-and-recovery.md,COORDINATION_LEDGER.md}`
- Out of scope:
- broader inbox attachment parsing/inspection work already tracked elsewhere in the ledger
- connector-specific Linq, Telegram, or email normalization changes
- inbox runtime schema changes outside the existing persistence/rebuild contract

## Constraints

- Preserve unrelated dirty-tree work, especially the existing `packages/inboxd/test/linq-connector.test.ts` edit and shared ledger churn.
- Keep the fix additive on the current raw inbox layout instead of redesigning the full owner directory scheme unless a smaller capture-id-first recovery lookup is insufficient.
- Treat this as a high-risk inbox storage/recovery change: keep verification coverage-bearing and add direct crash-recovery proof.

## Risks and mitigations

1. Risk: staging file-backed attachments through temp files could accidentally persist untrusted paths or leak temp residue.
   Mitigation: keep trusted-root checks before snapshotting, create explicit temp snapshots inside the system temp root, and clean them up after write-batch preparation.
2. Risk: switching recovery lookup away from the current envelope path could pick the wrong raw-only capture when duplicate raw envelopes exist.
   Mitigation: match recoverable raw-only candidates by deterministic `captureId` and identity key, then retain the existing stable ordering when multiple interrupted operations exist.
3. Risk: changing stored byte-size precedence could break callers that relied on provider metadata for missing data.
   Mitigation: only replace metadata when measured bytes exist; unstored attachments should continue to remain unstored instead of inventing size/hash values.

## Tasks

1. Add a narrow snapshotting path for file-backed attachments so measured bytes, hash, and copied raw content come from the same staged artifact.
2. Prefer measured byte size for committed attachments over caller-supplied metadata.
3. Change raw-only recovery selection to resolve by deterministic capture identity before any `occurredAt`-derived shard/path check.
4. Add focused inboxd regression coverage for source-file mutation after hashing/stat and for raw-only recovery after `occurredAt` normalization drift.
5. Run scoped verification, required audits, and a scoped commit flow if the dirty tree allows it.

## Decisions

- Prefer a small staged-snapshot helper in `persist.ts` over a broader raw-owner layout redesign for this fix.
- Keep the existing raw inbox directory layout for now and make raw-only recovery identity-driven first.

## Verification

- Required commands:
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/inboxd/src/indexing/persist.ts packages/inboxd/src/shared.ts packages/inboxd/test/idempotency-rebuild.test.ts packages/inboxd/test/inboxd-runtime-persist-edge-coverage.test.ts`
- `pnpm --dir packages/inboxd test:coverage`
- `pnpm test:smoke`
- `git diff --check`
- Required audits:
- `coverage-write`
- `task-finish-review`
- Direct scenario proof to capture:
- a file-backed source mutation after initial metadata collection still yields stored hash/size matching the committed raw bytes
- raw-only recovery still finds the existing deterministic capture when the retry input uses a different `occurredAt` month/path
