# A thrown error is the caller's fault only when a request boundary says so

Status: active
Created: 2026-11-14
Updated: 2026-11-14

## Goal

- An HTTP surface answers 4xx only for a rejection it declared. Everything it
  does not recognize is a server failure.
- Shared parsers report that a value failed validation and assign no blame.
  The boundary that read the value decides what the failure means.

## Why

Three mappers decide blame from the JavaScript error type: Web
`createJsonErrorResponse`, Worker `classifyPublicRouteError`, and the runner
container's request decoder. `TypeError`, `RangeError` and `URIError` are 400
"Invalid request".

- The runtime throws those types for bugs and for failed `fetch`.
- The same parser runs on both sides of a boundary, so the same failure is the
  caller's fault in Web and an upstream fault in the runner.
- `TypeError` is also the convention for server faults. In a sample of 60
  random `new TypeError(` sites in `apps/web/src`, about 8 reject caller input
  and about 50 are configuration, crypto, stored-data or invariant failures.

A wrong 400 is not retried by callers that retry 5xx, is logged as a caller
mistake, and tells a model to fix arguments that were fine. On 2026-11-14 it
replaced a finished recap show with the plain fallback (#4957 fixed that one
message by string match).

## Target design

1. **Validators throw `ContractValidationError`.** Neutral: no HTTP, no retry,
   no logging. Lives in a zero-import subpath of `@murphai/contracts`.
2. **`parseInput(value, parser)` is the only translation.** It runs a
   synchronous parser, turns a `ContractValidationError` into a
   `RequestInputError`, and rethrows anything else unchanged. Server-derived
   parser options are read outside it.
3. **Readers own their own rejections.** The bounded body reader throws an
   explicit limit error at the byte-limit branch. `JSON.parse` and
   `decodeURIComponent` are caught only around the exact call.
4. **Mappers recognize explicit rejections and domain errors. Nothing else.**
   Each surface keeps its own response adapter (Web envelope and matchers,
   Worker `{ error }`, container diagnostics); they share one small classifier.
5. **Replay stays with the operation owner.** No retry is added or moved.

Deep service validation: pure input-shape checks move to (or are exposed at)
the parse step; state-dependent rejections stay with the service as domain
errors with their established status; invariants stay server failures.

## Review outcome (ReviewGPT architecture review, 2026-11-14)

Accepted:

- Boundary classification with a neutral validation signal, not "anything
  thrown inside the parse step is 400". Reason: the second still hides parser
  bugs, and the group-tool route's parse expression also reads environment
  config.
- No wholesale relabel of `TypeError` sites. Migration follows each route
  family's reachable parser graph, including nested parsers in other packages
  (for example `parseAssistantRuntimeIssueRecord` under runtime-control).
- Do not wrap `requireHostedCloudflareCallbackJsonRequest` whole. It reads
  bytes, loads config, verifies a signature and consumes a nonce before it
  decodes JSON. Keep that order and narrow its internals.
- Body-limit rejection gets one representation (today: a `RangeError`, a
  message prefix, and several wrappers).
- Local `instanceof TypeError` checks are migrated by the decision they make,
  not deleted wholesale. Highest value: the control client's response parser,
  the mailbox handoff rule that drops a pending item on any `TypeError`, and
  the Worker recap upload handler that reports storage failures as invalid
  input.
- Family-by-family flip gated on tests, not on elapsed time. Provider webhooks
  last, one provider at a time, each with its own recovery proof.
- The container's 503 means configuration failure to the Worker. Web's
  fetch-to-503 rule is not copied there.
- `withRetryableServerFailures` also sets `retryable: true` on domain 5xx; that
  policy moves to the route-family adapter before the wrapper is deleted.

Rejected:

- A `{ parse, handle }` route framework. One `parseInput` call per route adds
  no branches and fits the complexity guard.
- A schema-library migration or result-returning parsers everywhere. Existing
  `safeParse` uses stay; nothing else needs it.
- Waiting one or two weeks on shadow logs before choosing.

Adopted as a migration device, deleted in the last stage:
`ContractValidationError extends TypeError` and reports the name `TypeError`
from the instance, the prototype and the constructor, so every existing
consumer behaves the same until its family flips. A pre-landing review of
stage 1 found three consumers that tell errors apart by name and would have
changed otherwise; the last stage has to migrate each on purpose:

- `classifyCleanupError` in Web's runtime resource cleanup reads the
  prototype's own `name` to call a parse-stage failure "validation".
- Web's `describeLoggedErrorType` and hosted-execution logging read
  `constructor.name` for the logged error type.
- `deriveHostedExecutionErrorCode` and `readHostedExecutionSafeErrorName` read
  `error.name`; the container puts both on the wire and the Worker reads the
  code. A translated rejection therefore reports its cause's diagnostics.

## Stages

Each stage is safe to stop at.

1. **Signals, no behavior change.** `ContractValidationError`,
   `RequestInputError`, `parseInput`; the three mappers recognize
   `RequestInputError` and keep native inference. Done (#4972).
2. **Sweep, no behavior change.** Every `new TypeError(` in `apps/web/src`,
   `apps/cloudflare/src` and `packages/*/src` is classified. A throw that
   rejects a value for what it is becomes `ContractValidationError`; a throw
   about configuration, crypto, I/O, stored-state conflicts or invariants
   stays a `TypeError`. The diff is the constructor rename, one import per
   file and dependency wiring, and is checked mechanically.
3. **One signal for an oversized body.** `RequestBodyTooLargeError` at the
   byte-limit branch of each reader; consumers test that class (#4977).
4. **Narrow the mappers.** Each mapper answers 400 for a
   `ContractValidationError` or an explicit request rejection, and a server
   error for a bare `TypeError`, `RangeError` or `URIError`. JSON and path
   decoding failures are raised explicitly at the exact call. This is where
   bugs, failed fetches, configuration and crypto failures stop being the
   caller's fault. Gate: with native inference off, the Web, Cloudflare and
   package suites name every path that still depends on it; each is either a
   missed validator (convert it) or a server fault that a test pinned as 400
   (change the test on purpose and say so). Runner callbacks and member
   routes first; provider webhooks one at a time with their own recovery
   proof.
5. **Mark the boundaries.** Routes read caller input through `parseInput`,
   deep input validation in services becomes a domain rejection or moves to
   the parse step, and the mappers stop answering 400 for a bare
   `ContractValidationError`. This is where a corrupt stored record or a bad
   upstream response stops being the caller's fault.
6. **Local type checks, by meaning.** The control client's response parser,
   Worker local catches, container request decoding, and the remaining
   `instanceof TypeError` / `RangeError` decisions.
7. **Delete:** native inference, the `fetch failed` string match, the
   `TypeError` and `RangeError` bases and the name device on the explicit
   errors, the Worker rethrow wrappers that exist only because its mapper
   infers from types, and the shadow log field.

## Progress

- Stage 1: merged (#4972).
- Stage 2: this PR. 2,249 sites converted, about 1,000 left as server faults.
- Stage 3: #4977.
- Merged alongside, from stage 6: the mailbox handoff retry rule (#4974) and
  the Worker media catches (#4976).

Validators deliberately not converted because a consumer tells a subclass
from a plain `TypeError` by prototype identity; each needs its consumer
changed before stage 4 reaches it:

- `apps/web/src/lib/better-auth` record, record-query, record-crypto and
  adapter validators (17 sites): the auth session logger checks the error's
  immediate prototype.
- `apps/cloudflare/src/runtime-platform/connected-apps-port.ts` (1 site): a
  test pins `TypeError.prototype`.

## Scope of this PR (stage 2)

- In scope: the constructor rename at validation sites in `apps/web/src`,
  `apps/cloudflare/src` and `packages/*/src`, the import each file needs, and
  the `@murphai/contracts` dependency for `runtime-state`, `parsers`,
  `messaging-ingress` and `cloudflare-hosted-control`.
- Out of scope: route files under `apps/web/app`, any `RangeError` or
  `URIError` throw, every catch and `instanceof` check, and any status, body,
  header, log or retry change.

## Success criteria (stage 2)

- Every removed line of the diff differs from an added line only by
  `new TypeError(` becoming `new ContractValidationError(`.
- Every existing test passes with its expectations untouched, apart from one
  parity test that compared error constructors against a copy of the old
  parser and now compares error names.
