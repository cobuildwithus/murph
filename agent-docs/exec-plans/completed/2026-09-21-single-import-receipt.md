# Use one durable device import receipt

## Outcome and invariants
Automatic device batch publication writes one integration-ingest receipt instead
of a redundant success audit. Keep atomic evidence/events/samples, exact replay,
member corrections and reconciliation diagnostics. Historical audits and all
non-device/user mutation audits remain unchanged.

## Existing owner and smallest change
The ingest already owns identity, outputs, evidence and counts. Add optional
publication-effect counts outside provenance/delivery identity. Remove the audit
writer and summary formatter, return auditPath null for applied imports, and
provide thin receipt inspection using existing archive-aware readers. No new
ledger, query index, alias map or historical rewrite.

## Product and evolution
Device imports no longer add entries to audit lists/exports; inspect their ingest
receipt instead. Old receipts without effect counts remain supported. New optional
receipt metadata is a forward-format change: deploy the co-bundled reader/writer
and do not restore a newly written workspace into older strict readers. Preserve
current evidence on failure; no background audit pruning in this PR.

## Proof
Atomic publication without audit, exact retry, corrections, omission retraction,
member-edit preservation, archived receipt inspection, old receipt acceptance,
focused core/contract/CLI tests and typechecks. Existing historical audit readers
and user mutation audit paths remain unchanged. Parent review, exact-head CI and
ReviewGPT are final PR gates.

## Local completion evidence
Core device-import and ingest suites: 232 passed plus the corrected historical
replay proof passed separately; new legacy-receipt proof passed. CLI samples/audit
suite: 14 passed after regenerating the CLI config/type/skill-hash artifacts.
Core, contracts and CLI typechecks passed. Complexity guard passed without debt
increase. Parent review complete. Final PR owns exact-head CI and ReviewGPT.
Historical audit bytes remain; this change prevents future duplicate growth.
Changelog not applicable: operator-facing receipt/audit bookkeeping, with no
member health-record or conversation change. No deployment or private mutation.
Status: completed
Updated: 2026-09-21
Completed: 2026-09-21
