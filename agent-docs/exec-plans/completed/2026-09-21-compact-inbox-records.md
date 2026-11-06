# Compact expired inbox capture records

## Outcome and invariant
Remove expired legacy capture copies only when an equivalent expired current-format
record remains in the same shard. Preserve retry identity, event/audit links, source
metadata, attachments and retention state. No new ledger or schema.

## Owner and evidence
Envelope migration appends v2 while retaining v1. Text retention clears both but
keeps both permanently. Extend the canonical-lock-owned retention pass with exact
semantic equivalence after excluding schema/envelope/retirement timestamps. Keep
unknown records, mismatches, unpaired records, and live content unchanged.

## State and recovery
Use the existing bounded capture budget and canonical shard rewrite. A matching v2
record remains the authority; no reader migration or rollback floor. Retry is a
no-op. No original attachments or source files are deleted by copy compaction.

## Product UX
Patch: smaller workspace after existing inbox maintenance; no query or inbox
behavior change. Prove migration pairs, old already-expired pairs, budget progress,
mismatches, runtime rebuild and repeat no-op. Keep unrelated records byte-semantically
unchanged. No assistant prompt/tool or UI changes.

## Work
- [x] Implement exact duplicate elimination in the existing retention owner.
- [x] Focused retention/migration/rebuild tests and inbox typecheck.
- [x] Parent review, scoped PR, exact-head CI and ReviewGPT.

## Evidence
Retention and envelope-migration suites: 24 passed. Inbox typecheck and complexity
guard passed (no hotspot above 20). Parent review confirms current rows and
canonical identities survive. PR owns final ReviewGPT and exact-head CI; no
production or private workspace was mutated. Changelog not applicable: internal
physical duplicate cleanup with unchanged reader and member behavior.
Status: completed
Updated: 2026-09-21
Completed: 2026-09-21
