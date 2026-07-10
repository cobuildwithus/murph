# PR 458 ReviewGPT Round 38

## Goal

Resolve the evidence-backed final review findings for PR #458 without adding a
second clinical state owner or keeping unused clinical code on the hosted boot
path.

Success criteria:

- No-known-allergy truth is reconciled by one patient-snapshot identity and a
  newer complete conflicting snapshot cannot leave an older assertion live.
- A newer comparable resource routed to review prevents an older revision from
  becoming or remaining live, using the existing event-ledger deletion marker.
- Clinical planning is available only through an explicit importer subpath and
  is absent from the unrelated hosted static boot closure.
- Focused transition tests, owner coverage, typecheck, bundle assembly, PR CI,
  and ReviewGPT pass on the final pushed head.

## Constraints

- Keep `packages/core` as the sole canonical mutation owner and the event
  ledger as the sole persisted ordering owner.
- Reuse existing versioned external references and retraction decisions; do not
  add a review-watermark store, queue, or reconciliation service.
- Preserve raw evidence and fail closed when a resource cannot form a
  comparable source identity.
- Keep the direct release-package declarations required to bundle private
  transitive workspace dependencies; remove the static import path instead of
  weakening package installability or increasing the runner bundle budget.

## Plan

1. Add failing transition regressions for aggregate no-known-allergy truth and
   newer-review/older-upsert ordering.
2. Move the no-known-allergy canonical decision to one patient snapshot
   identity and convert comparable review decisions into existing core
   retraction holds at the execution boundary.
3. Remove the broad importer re-export, add an explicit clinical importer
   subpath, and add a direct static-boot guard while retaining required release
   packaging declarations.
4. Run focused tests, owner coverage, bundle assembly, typecheck, required
   audits, PR CI, and ReviewGPT.

## Verification

- Clinical-records coverage: 8 tests, 91.54% statements.
- Importers coverage: 347 tests, 90.78% statements; focused clinical and
  package-boundary proof: 76 tests.
- Cloudflare runner guard/typecheck, web source-resolution test/typecheck,
  scenario integrity, release packaging, and full hosted bundle assembly pass.
- The diff-wide lane passed owner/reverse-dependent typechecks, then hit two
  unrelated assistant-runtime timing timeouts under full parallel load; both
  exact cases passed on focused rerun.
- Security/privacy review found no medium-or-higher findings.

Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
