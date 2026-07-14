# PR 528 delivery-log redaction CI repair

## Goal

Restore the delivery-ambiguity restart E2E by ensuring outbox delivery error
diagnostics satisfy the existing hosted runtime-log privacy contract before the
runner posts them to web.

Success criteria:

- Delivery error messages and selected string details use the existing strict
  redacted-log normalization boundary.
- Values such as an already-redacted home-directory placeholder cannot make the
  runtime-log request fail validation.
- Safe provider diagnostics remain available, while unsafe values fail closed.
- Focused tests, affected typechecks, completion audits, exact-head CI, and
  ReviewGPT pass.

## Evidence

- Two exact-head E2E attempts failed after web rejected
  `deliveryErrorSummaries[0].deliveryErrorMessage` as a local filesystem path.
- The producer called the generic structured-log text sanitizer for that field.
- The generic sanitizer permits `<HOME_DIR>`, while the runtime-log parser
  intentionally rejects it.
- The same producer file already owns a stricter `redactHostedRuntimeLogString`
  helper that converts that placeholder and rejects any remaining unsafe text.

## Approach

1. Add a focused regression that sends delivery error message and selected
   detail values containing an already-redacted home-directory placeholder
   through the real phase and runtime-log parser.
2. Reuse the existing strict redacted-log string helper for delivery error
   messages and selected string details.
3. Run focused owner tests/typechecks and the required coverage and
   security/privacy completion audits.
4. Commit, verify the latest base is merged, push, and rerun exact-head CI and
   ReviewGPT.

## Constraints

- Keep the web parser fail-closed.
- Do not add a second sanitizer or weaken privacy validation.
- Preserve useful safe diagnostics and durable retry behavior.
- Preserve unrelated working-tree and ledger changes.
- Do not expose secrets or direct personal identifiers in artifacts.

## Verification

- The focused producer/parser regression passed after first failing against the
  uncorrected producer.
- `pnpm test:diff` passed assistant-runtime typecheck, 73 test files with 1,592
  passed and 2 skipped, and reverse-dependent Cloudflare verification with 102
  test files and 1,759 passed.
- The coverage audit added direct proof for the selected-detail branch; its
  post-edit assistant-runtime run passed the same 1,592 tests with 2 skipped.
- The independent security/privacy audit found no evidence-backed medium-or-
  higher issue and confirmed that the web parser remains fail-closed.
- `git diff --check` passed.
- Latest `origin/main` remains an ancestor of the repair head.

## State

Completed locally pending final commit and exact-head PR gates.
Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
