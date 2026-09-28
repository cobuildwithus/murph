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
issue #2378). Complexity is
unchanged at 27 for the existing upload function; no control flow was added.
The Web-only ESLint config ignores Cloudflare paths, so it supplies no lint
proof; TypeScript and the configured complexity guard cover the changed owner.

## Review tooling recovery

The installed review probe recognized only radio controls, so pressed-state
Chat/Work buttons caused a false Work rejection before submission. Extend the
existing dependency patch at its two selectors. A synthetic browser replay
reproduces the original failure and passes ten cases for button/radio selection,
unknown surfaces, and overriding Work usage/breadcrumbs. The actual owned Chat
tab also passes; all diagnostic tabs were closed. Existing model/duration,
configuration and bootstrap tests pass (26 tests). The retry of the original
required CI run passed. No substantive review was submitted on that head.

The same UI also removed model-picker test IDs. Accessible menu/trigger
selectors preserve concrete model proof and the existing power-slider handling.
An unsent synthetic draft selected the explicit model summary successfully; its
owned tab was closed. Ten model-control tests reject effort-only labels, other
models and unavailable controls. Earlier attempts remain pre-submission failures.
