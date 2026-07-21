# Hosted CLI Latency Specificity Remediation

## Goal

Resolve the accepted PR 802 ReviewGPT round-two finding so a filtered
blood-test row cannot confidently expose an overlapping but unrequested marker.

## Work

1. Rank nested marker matches at the existing presentation boundary: exact
   first, then leading whole-token or phrase, then a unique loose substring.
2. Omit `matchedResult` when the best available match remains ambiguous.
3. Add production-shaped CLI regressions for VLDL/LDL, Non-HDL/HDL, and a
   broad ambiguous cholesterol query, then run scoped verification and
   ReviewGPT correction round three.

## Constraints

- Keep the hosted runner at one vCPU.
- Keep matching at the existing blood-test list presentation boundary.
- Do not add state, a query protocol, cache, owner, service, or fallback read.
- Preserve bounded output and generic/unfiltered list compaction.

## Verification

- Pre-fix production-shaped proof failed exactly: `--text LDL` returned the
  earlier `VLDL Cholesterol` value.
- Focused CLI passed `24/24`; vault-usecases passed `204/204`; the full CLI
  owner lane passed `1,075 passed / 1 skipped`; both owner typechecks passed.
- `git diff --check` and the privacy scan passed.
- Fresh coverage-write audit: zero findings and no edits.
- Remaining: finish and push the scoped commit, then run ReviewGPT correction
  round three concurrently with CI.
Status: completed
Updated: 2026-07-20
Completed: 2026-07-20
