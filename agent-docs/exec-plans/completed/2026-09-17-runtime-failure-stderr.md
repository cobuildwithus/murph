# Capture Worker stderr in terminal runtime test failures

Status: completed
Created: 2026-09-17
Updated: 2026-09-17

## Outcome and scope

The hosted-local failure excerpt reads only Worker stdout, although structured
warning and error records can be emitted on stderr. Include both bounded streams
when selecting the existing maximum of three container failure records. Preserve
the existing redaction and leave production runtime behavior and test verdicts
unchanged. This improves evidence; it does not establish the underlying cause of
an E2E runtime failure.

## Proof

Parameterize the existing terminal-error regression over stdout and stderr.
Require failure kind retention and private object-key omission in both cases.
Run the focused harness tests, Cloudflare typecheck, complexity and docs checks.
Reuse Frog entry `20260917142016-hosted-local-terminal`; no duplicate entry.

## Release

A test-only PR and exact-head CI own publication. Final ReviewGPT is not required
for this bounded test-harness correction under the completion workflow.

## Implementation result

The new stderr variant failed before the correction because the failure kind
was absent. After reading up to 64,000 characters from each existing stream and
retaining at most three matching lines, all 22 harness tests pass, including
redaction assertions for both streams. Cloudflare typecheck and complexity guard
pass. Parent review confirms no test verdict, production behavior, or public
content changes. Exact-head CI remains the publication gate.
Completed: 2026-09-17
