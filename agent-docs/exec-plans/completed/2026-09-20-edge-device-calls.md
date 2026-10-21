# Remove redundant device control requests

Status: completed
Created: 2026-09-20
Updated: 2026-09-20

## Goal

Remove empty hosted device apply callbacks and duplicate source-authority reads
within a summary resource operation. Preserve current source admission before
canonical imports, disconnect fencing, and bounded pass inventory reuse.

## Scope and owners

Assistant Runtime owns connection-delta publication. Device Sync owns provider
inventory projection and canonical import admission. Web remains source authority.
No protocol, persisted state, provider request, or dependency changes are needed.

## Evidence and approach

The reconciliation do/while sends an empty update even when no differences exist.
Use a bounded while loop. Summary resource execution projects freshly loaded
inventory and then reads source authority again for import without intervening
provider work. Pass that operation's fresh source rows into projection and import;
retain only provider inventory in the existing pass cache.

## Risks and proof

Test source disconnect during provider fetch, unavailable source authority,
mixed-source filtering, and a later cached-inventory job after an epoch change.
Prove unchanged reconciliation issues no apply request and changed state still
publishes. Run focused package tests, both package typechecks, and complexity diff.
No test database or production access is needed. Existing Web/Worker/container
versions remain compatible because request and persisted shapes are unchanged.

## Tasks

- [x] Implement and test both reductions.
- [x] Update the ingestion owner and review the scoped diff.
- [x] Prepare the scoped candidate for draft PR delivery and parent-owned final gates.

## Verification

- Device Sync focused proof: 58 tests passed across admission-source-reads,
  timeseries-source-reuse, and provider-history-recovery suites.
- Hosted device reconciliation proof: all 147 tests passed. No-op scenarios now
  assert zero calls; actual changed-state publication remains covered.
- Both affected package typechecks passed.
- `pnpm complexity:diff` passed: no debt or maximum increase in either file.
  The changed resource-job function remains at 21; existing larger functions
  are outside this bounded request reduction and retain their current owners.
- Privacy and `git diff --check` passed. Frog inventory inspected; no new
  repository friction required an entry.

One empty apply request is removed per unchanged reconciliation. A summary
resource operation with fresh inventory projection drops from two source reads
to one; later operations retain a fresh read even when provider inventory is
reused. Local callers without a source reader preserve existing projection.
No provider-visible prompt, tool, or UI behavior changes; no changelog entry.
Required exact-head CI and final ReviewGPT remain with the original session.
No merge is authorized.
Completed: 2026-09-20
