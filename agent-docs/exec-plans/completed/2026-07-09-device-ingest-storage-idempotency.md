# Device Ingest Storage Idempotency

Status: completed
Updated: 2026-07-10

## Why

Overlapping wearable sync windows already reconcile repeated provider records to
one canonical event, but the import boundary still persists a fresh integration
ingest and audit for byte-identical evidence whenever receipt time changes. That
unbounded warm-vault growth also inflates every hosted workspace snapshot.

## Goal

Make a semantically unchanged device replay a true storage no-op while retaining
every new or corrected canonical output and every genuinely novel raw-only
evidence part.

## Invariants

- Preserve foreground and scheduled sync behavior; do not reduce provider pull
  windows or silently discard novel provider data.
- Canonical event reconciliation remains the source of truth for new,
  superseded, and unchanged events.
- Raw-only evidence with changed content remains durable even when it yields no
  canonical event or sample.
- Avoid a second blob store, index, or lifecycle subsystem; derive idempotency
  from the existing integration-ingest journal.
- Do not log raw health payloads, credentials, or direct identifiers.

## Work

1. Expose per-record reconciliation outcomes at the core import boundary.
2. Retain evidence for new or superseded outputs and dedupe unreferenced
   raw-only evidence by stable provider/account/role/content identity.
3. Return a typed no-op without a canonical write or vault audit when nothing
   novel remains.
4. Add focused regression coverage for unchanged replay, corrections, mixed
   batches, and changed versus unchanged raw-only evidence.
5. Run required security/privacy, coverage, parent review, scoped verification,
   draft-PR, ReviewGPT, and CI gates.

## Verification

- Focused novelty and full device-import suites passed, including bounded-tail,
  large-evidence, corrupt-history, month-boundary, raw-only, receipt, event-link,
  sample-link, and real WHOOP importer replay coverage.
- Full core and importer coverage suites passed above repository thresholds;
  the affected package typechecks, full workspace build, and 201-scenario smoke
  manifest verification passed.
- `pnpm test:diff` passed every guard, all 18 affected typechecks, and the full
  551-test core suite. Its broader assistant-runtime test fan-out reported seven
  unrelated timing/checkpoint failures; the Linq failure passed immediately in
  isolation, and a representative exact checkpoint failure was independently
  reproduced on clean `main` during verification.
- Required coverage-write, security/privacy, and performance reviews completed
  with no accepted production finding remaining. Pushed-head ReviewGPT and CI
  remain PR publication gates rather than implementation work.

## Deployment

No coordinated app deployment is expected. The reader must remain compatible
with historical integration-ingest rows; this change only suppresses redundant
new writes.
Completed: 2026-07-10
