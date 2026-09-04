# Preserve device-sync progress in bounded metadata

## Outcome and architecture

Keep provider progress intact when a sync result adds metadata to a full
16-entry envelope. The existing metadata merge remains the storage boundary;
the Junction owner supplies its existing historical-progress keys. Keep
sanitization, the entry limit, canonical version fences, and bounded retry.
No new persistence, scheduler, dependency, or recovery service.

## Product UX: Patch

- Outcome: scheduled connected-health refreshes retain progress and finish.
- Reaches: ordinary completion, provider failure, and cold retry with full metadata.
- Proof: real-store progress preservation, canonical apply acceptance, and existing
  stale-write rejection tests with entirely synthetic fixtures.

## Tasks

- [x] Reproduce bounded metadata eviction through the existing store.
- [x] Preserve provider-owned history keys before optional patch fields.
- [x] Prove successful and failed sync results, history coverage composition,
  canonical apply acceptance, and unchanged privacy limits.
- [x] Run focused tests, typechecks, package build, and parent review.
- [x] Add changelog and durable contract for the scoped implementation commit.

## Local evidence and walkthrough

The two real-store regressions fail on the original metadata implementation:
both success and failure evict historical window fields. The corrected store
keeps those fields through a second full diagnostic patch. The Web test uses
the actual store and apply owner: a stale timestamp still fails, and the fresh
version accepts the full metadata plus cadence exactly once. Coverage merging
also preserves summary progress at capacity. Product UX verdict: Ready for
the existing scheduled refresh and failure/retry journeys; no UI changes.

- Device-sync metadata, store, and hosted-runtime tests: 172 passing cases.
- Web runtime-authority tests: 89 passing cases.
- Device-sync typecheck and build: passed.
- Web typecheck: passed.
- Complexity and docs drift: passed; no source hotspot exceeds 20.

External completion remains the exact pushed-head ReviewGPT gate and required
CI. The draft PR's assigned number will be added to the isolated changelog
entry before candidate admission. Preserve the worktree while those gates run.

## Ownership and deployment

Independent task branch: `fix/device-sync-metadata-progress`.
Existing retained-wake and runtime-diagnostic PRs remain separate.
The shared package is bundled by Web and Cloudflare; the wire and persisted
shape remain unchanged. Updated runners must converge before claiming runtime
recovery. No production mutation is part of local verification.

Status: completed
Updated: 2026-09-04
Completed: 2026-09-04
