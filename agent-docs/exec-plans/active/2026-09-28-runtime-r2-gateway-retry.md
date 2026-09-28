# Retry transient snapshot gateway responses

Status: active
Created: 2026-09-28

## Outcome and scope

Outcome: A transient gateway response during an idle snapshot upload receives
one existing bounded retry before execution falls back to durable recovery.
Reaches: Hosted runtimes using direct conditional or managed multipart uploads.
Proof: Synthetic port tests cover success, repeated failure, conflict,
cancellation, expiry, and identical encrypted bytes; focused typecheck and review.

## Cause and design

The snapshot PUT response classifier admits 429, 500, and 503 but omits 502
and 504. Extend its existing status set only. Preserve two attempts, jitter,
original presigned deadline, cancellation, object/session binding, and completion
verification. No schema, scheduler, state owner, or protocol change.

Old and new Worker/container versions remain wire-compatible. The runner bundle
must converge through the normal Cloudflare rollout to receive the correction.
Persistent failures continue through existing durable runtime recovery.

## Tasks

- [x] Prove missing gateway retries against unchanged source.
- [x] Extend the status set and its existing composed test matrix.
- [x] Run focused tests, typecheck, complexity and documentation checks.
- [ ] Review and commit the scoped correction; complete applicable PR gates.

## Evidence boundary

All committed fixtures and review artifacts are synthetic. No production rows,
private identifiers, exact incident timestamps, or raw logs enter the patch.

## Local results

Both conditional and managed 502-to-success fixtures fail on the original
classifier and pass after its two-line correction. All 280 runner-platform tests
pass, including the 30-case HTTP/upload-mode/outcome matrix and existing abort,
expiry, transport, and authority checks. All 10 changelog rendering tests pass.
Cloudflare typecheck passes after ordinary Prisma generation (existing Frog
issue #2378); no new workaround or friction record is needed. Complexity is
unchanged at 27 for the existing upload function; no control flow was added.
The Web-only ESLint config ignores Cloudflare paths, so it supplies no lint
proof; TypeScript and the configured complexity guard cover the changed owner.
