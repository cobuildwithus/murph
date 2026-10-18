# Attribute failures in the Linq no-replay proof

Status: completed
Created: 2026-10-16
Updated: 2026-10-16

## Goal and evidence

The pre-accept rich-link recovery proof compares a shared scenario's global
Responses API count with its baseline plus one. A mismatch currently prints
only numbers. Existing sanitized scenario diagnostics are bypassed, leaving
both target replay and unrelated requests plausible. This does not establish
that the assertion is wrong or that any additional requests are benign.

## Scope

ReviewGPT authors the smallest failure-only diagnostic using existing test
capture and sanitized failure reporting. Keep exact assertions, execution,
timeouts, retries and all production behavior unchanged. Only bounded synthetic
fixture categories/counts may supplement existing safe diagnostics. A failed
secondary diagnostic must not mask the original mismatch.

## Ownership and verification

No current open PR changes this count assertion or its missing observation.
Other release owners retain their worktrees and workflows. This separate
checkout owns only the test-observability correction and its Frog entry.

Prove target replay and unrelated request mismatch remain failures but are
distinguishable; prove passing assertions do not read diagnostics; prove
secondary failures preserve the original assertion. Inspect privacy and cost,
run focused tests and applicable typecheck/complexity/docs checks, then exact
pushed-head ReviewGPT and required CI before any authorized merge. Follow the
canonical production-admission owner; no manual bypass or blind retry.

## Status

ReviewGPT authored the three test-file changes. The focused diagnostic test
fails against the original helper, then both helper suites pass all 78 tests.
Ten synthetic cases distinguish target replay, memory/prewarm and prior fixture
requests, retain the exact assertion object and actual/expected counts, keep
passing paths silent, and preserve failure on rejected diagnostic reads. A
negative Vitest reporter reproduction confirms the original numeric mismatch
and added safe counts are both visible in real failure output.

Parent verified that removing the two catch wrappers and inlining the unchanged
fixed marker restores the original E2E path. Capture counts are snapshotted
synchronously before the existing bounded status read (ten-second request
budget); the new diagnostic path omits raw bodies, URLs, identifiers, hashes and
log tails. Category output is bounded to 50 combinations. Production sources,
provider stub behavior, retries, timeouts, assertions and success paths are
unchanged. Cloudflare typecheck, complexity guard and docs checks pass.

Final ReviewGPT and required CI remain pending. The original hosted integration
failure remains unresolved until relevant evidence distinguishes its cause.
Completed: 2026-10-16
