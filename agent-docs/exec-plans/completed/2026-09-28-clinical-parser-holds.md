# Preserve historical clinical parser holds during refresh

Status: completed
Created: 2026-09-28
Updated: 2026-09-28

Final review found that newly supported observations can conflict with an existing
parser hold at the same source revision and abort unrelated retrieval work.
The user resumed remediation and requires a pause before merging medical PRs.

Keep generic source-revision conflicts and provider withdrawals unchanged.
At the clinical application owner, under the existing canonical lock, retain only
known historical parser holds whose exact identity, revision, immutable page and
resource contents match. Count them as review-held, without claiming imported
laboratory results. Explicit recovery keeps using canonical correction.

Reuse core lookup semantics through a batched lookup so one import adds two
ledger scans, not two scans per observation. Read each old evidence page once
per batch, with existing manifest/resource bounds and source/patient attestation.
Prove refresh with unrelated results and later pages, exact replay, changed
same-revision evidence rejection, withdrawal protection and source integrity.
Run owner tests, typechecks, complexity and a new final review. Hold before merge.

## Implementation and evidence

The clinical owner retains only the three demonstrated parser-hold reasons after
exact identity/revision, manifest/hash and unchanged-resource checks. Core exposes
a batched form of its existing lookup; no schema or source-revision exception was
added. Existing canonical locking covers lookup through the decision batch.

Focused proof: 370 core tests, 35 vault execution tests and 39 hosted clinical
runtime tests passed. Core, vault and runtime typechecks passed. Corrupt historical
bytes and changed same-revision evidence fail closed; authoritative withdrawals
remain protected. Runtime proof completes later pages and clears the successful
checkpoint. Complexity and docs drift passed; existing hotspots did not grow.

PR #3765 owns the new exact-head final review and CI evidence. The user requires
a pause before merging either medical PR; implementation completion is not merge
or deployment approval.
Completed: 2026-09-28
