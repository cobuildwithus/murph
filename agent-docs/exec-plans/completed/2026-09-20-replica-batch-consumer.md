# Batch replica upload bookkeeping

Status: completed
Created: 2026-09-20
Updated: 2026-09-20

## Outcome and protected invariant

Reduce the Browser Vault refresh upload bookkeeping from 72 per-object callbacks
plus an outer admission/settlement pair and an owner preflight to two callbacks.
Keep every physical multipart upload independently recoverable, retain the
compatibility root, and preserve live ownership and irreversible retirement checks.
This changes internal coordination only, not product behavior or provider input.

## Owner and evidence

The replica store writes one compatibility root, three shards and 32 metric
buckets. The Worker adapter owns those physical writes; Web's existing receipt
and orphan tables own admission, retention and recovery. Previously the adapter
admitted and released every write separately, while the handler also held an
outer non-multipart receipt for the same root. Final receipt admission already
checks live runtime ownership and retirement under the existing transaction locks.

## Implementation and failure model

- Extend the existing callback with bounded admission and settlement batches,
  keeping single-object commands for deployed Workers. Use one transaction,
  one set-based receipt insert and one root orphan update for admission.
- Allocate empty multipart uploads with concurrency four, then admit all exact
  IDs before encrypted bytes. The existing store still drains child writes
  before writing its compatibility root.
- Settle only complete or confirmed-aborted receipts. Unknown outcomes stay
  pending for the existing cleanup owner. Lost admission responses send no bytes;
  lost settlement responses retain safe recovery. Reusing any receipt rejects
  the whole batch so retries cannot dispatch a second physical upload.
- Delete the duplicate outer receipt and preliminary owner HTTP call. Keep final
  publication ownership checks and the old per-object callback consumer.
- Extend the existing live Web protocol probe with both real batch parsers.
  Web must deploy and converge before the new Worker; the existing deployment
  gate blocks older Web. Revert and converge the Worker before reverting Web.
  No new service, queue, table, fallback or authority cache is added.

## Verification

Focused contract tests cover bounds, duplicates and old command compatibility.
Worker tests cover two callbacks for 36 writes, failure and unknown outcomes,
partial success, delayed sibling completion, no preflight, and unchanged root
ordering. Real isolated PostgreSQL proof covers atomic admission, nine database
operations at maximum cardinality, stale owners, retirement, member deletion,
partial settlement, and exact-upload recovery. Protocol proof rejects missing
and incomplete Web evidence. Relevant typechecks and complexity review are
required before the draft PR. Parent owns final review and exact-head CI.

## Progress

Implementation and self-review complete. Focused checks passed:

- Replica contracts: seven tests.
- Worker replica and outbound selection: 15 tests, including delayed siblings.
- Isolated PostgreSQL replica selection: four tests, nine operations at 36 uploads.
- Web protocol admission: six tests.
- Worker deploy protocol, resource client and purge: 44 tests.
- Cloudflare, Web and hosted-execution typechecks passed.
- Complexity guard passed with no added debt. Existing unrelated snapshot,
  general outbound and automation timing hotspots retain their previous scores.
- Diff whitespace/privacy inspection passed. No member-facing changelog: internal
  callback consolidation preserves Browser Vault contents and publication.

The parent retains final candidate review, ReviewGPT and exact-head CI ownership.
No deployment or merge is included in this task.
Completed: 2026-09-20
