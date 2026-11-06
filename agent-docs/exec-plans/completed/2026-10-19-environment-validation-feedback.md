# Restore missing-version feedback after timestamp compatibility correction

## Reproduced issue and bounded correction

Final CI after ReviewGPT round three found two assistant-engine failures. One
assertion expected a string-only schema instead of the reviewed datetime union.
The other exposed a production regression: an omitted automation version yields
invalid_union, so the existing validation digest no longer labels it missing and
the existing inspect-and-retry guidance is omitted.

Extend the existing missing-required classification to rejected unions when the
actual submitted value is undefined. Present malformed values remain invalid.
Do not change schemas, timestamp parsing, mutation authority, retry owners or
provider declarations. Update the shape assertion and cover absent/null/invalid
values in the existing digest test. The composed dynamic-tool regression must
pass unchanged.

## Verification and review scope

Run the digest, model-schema and composed failure-boundary tests, affected
assistant-engine typecheck, complexity and documentation checks, then exact-head
CI. The three-round ReviewGPT cap has been reached. A new production correction
requires an explicit continuation decision before a fourth substantive round;
complete and publish the concrete fix and verification first.

This is a single existing-owner correction with no new helper or dependency. The
cap retrospective is that full CI caught one downstream error-shape consumer
after the prior review passed; earlier focused checks covered date readers and
cron replay but missed the existing dynamic-tool failure-boundary suite. Keep
the feature deletion and compatibility fix, and review this bounded correction
in the same thread if continuation is authorized.

## Completion evidence

The three focused suites pass all 98 tests, including the unchanged composed
missing-version repair test. Assistant-engine typecheck, complexity, docs drift
and whitespace checks pass. Present null and malformed string values remain
invalid_union; only undefined values become missing_required. The schema-shape
assertion now recognizes the already-reviewed two timestamp branches.

Implementation is complete. Push the scoped correction and run final-head CI.
ReviewGPT round three passed the prior production snapshot; completion of a
fourth round awaits the explicit cap-continuation decision recorded on the PR.
Status: completed
Updated: 2026-10-19
Completed: 2026-10-19
