# Diagnosable terminal Linq recovery

Status: active
Created: 2026-09-08
Updated: 2026-09-08

## Goal

- Recover eligible terminal Linq failures once and report every recovery outcome
  without private content. Original receipts must not regress replacements.

## Success criteria

- Reproduce receipt/retry overlap with real PostgreSQL and prove the correction.
- Diagnose guard skips, provider errors, accepted replacements and consumed claims.
- Pass focused tests, Web typecheck, parent review and routed final review.

## Scope

- In scope: Web-owned retry, receipt ordering, structured diagnostics and tests.
- Out of scope: production resend/deploy, new scheduler, stored message bodies.

## Constraints

- Keep existing delivery/message state owners, one-attempt fence and bounded work.
- Preserve routing, consent, access, supported content and ambiguous-send rules.
- Product UX Patch: eligible direct/group messages recover once; denial and
  unsupported content remain safe. Proof covers the final receipt state.

## Risks and mitigations

1. Concurrent receipt writes can regress or miss accepted identities.
   Mitigation: deterministic interleaving proof and shared receipt ownership.
2. Diagnostic error data can contain private provider content.
   Mitigation: finite codes, stages and shape facts; no prose or payload logging.

## Tasks

1. Audit retry/receipt ordering and official provider contracts.
2. Reproduce confirmed races before the smallest correction.
3. Add bounded diagnostics at the existing Web logging seam.
4. Run focused unit, HTTP, PostgreSQL and typecheck proof; review the full diff.
5. Update owner docs, make changelog decision and prepare scoped commit/PR.

## Decisions

- Web remains the sole retry and receipt owner; no schema or dependency added.
- Historical private incident details are excluded from repository artifacts.

## Verification

- Focused terminal-retry, delivery, HTTP and webhook tests; PostgreSQL concurrency
  suite on an isolated loopback database; Web typecheck; complexity diff.
- One resend at most, replacement receipt convergence, explicit safe diagnostics,
  normal successful acceptance checks quiet, no logger-induced delivery changes.

## Progress

- Confirmed two ordering bugs: receipt/acceptance transactions could miss each
  other's uncommitted state; a legacy receipt could overwrite a replacement
  after reading the old parent identity before promotion.
- Three real-PostgreSQL interleavings fail on the original source and pass with
  shared message locks plus the parent-locked ownership recheck.
- Added safe retry outcome diagnostics, retained all eligibility restrictions
  and the permanent one-attempt fence, and updated durable owner docs.
- Focused transport/webhook/concurrency proof: 314 tests passed in six files.
  The subsequent unit/changelog proof passed 20 tests; Web typecheck passed.
- Complexity diff passes with no new debt; existing store/route hotspots were
  inspected. Independent read-only audit and parent diff review found no
  remaining serious patch issues.
- Remaining: scoped commits, final external PR review, exact-head CI and
  mergeability proof. Production deployment and live resend are out of scope.
