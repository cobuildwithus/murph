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
4. **Mark the boundaries.** Routes and Worker handlers read caller input
   through `parseInput` or throw `RequestInputError` for a caller value they
   reject themselves; the container decoder does the same. Most routes
   already reject with an explicit domain error and need nothing. Still
   behavior-neutral: a `RequestInputError` and a native `TypeError` are both
   400 today.
5. **Flip the mappers to explicit only.** Each mapper answers 4xx for a
   `RequestInputError`, a `RequestBodyTooLargeError` or a recognized domain
   error, and a server error for everything else, including a bare
   `ContractValidationError`. There is no intermediate stage in which a bare
   validation error is a 400: four independent audits of stage 2 found that
   many validators are shared between request input, stored data and service
   responses, so the label on a throw cannot say whose fault a failure is.
   JSON and path decoding failures are raised explicitly at the exact call;
   schema `.parse` calls on caller input go through `assertContract`. Gate:
   with the flip applied, the Web, Cloudflare and package suites name every
   path that still depends on inference; each is a boundary to mark, a
   service entry point that validates caller input (mark it there), or a
   server fault that a test pinned as 400 (change the test on purpose and say
   so). Provider webhooks flip one at a time with their own recovery proof.
6. **Local type checks, by meaning.** The control client's response parser,
   Worker local catches, container request decoding, and the remaining
   `instanceof TypeError` / `RangeError` decisions.
7. **Delete:** native inference, the `fetch failed` string match, the
   `TypeError` and `RangeError` bases and the name device on the explicit
   errors, the Worker rethrow wrappers that exist only because its mapper
   infers from types, and the shadow log field.

## Progress

- Stage 1: merged (#4972).
- Stage 2: merged (#4978). 2,243 sites converted, about 1,000 left as server
  faults; audit corrections follow in their own PR.
- Stage 4: this PR.
- Stage 3: merged (#4977).
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

Also not converted: the six query validators in
`apps/web/src/lib/changelog.ts`. The changelog guard treats any change to
that file as a change to changelog content, so they move with the public
changelog route's boundary work.

## Scope of this PR (stage 4)

- In scope: route files under `apps/web/app`, Worker route handlers and
  route utilities, and the container's request decoding.
- Out of scope: the three mappers, shared readers and service code under
  `apps/web/src`, provider webhook routes, and any status, body, header or
  retry change.

Left for stage 5, found while marking:

- Routes that hand the raw payload to a service that validates it inside;
  the entry points are listed in the PR.
- Five runner-callback routes (phone calls, physical notes) validate with a
  schema `.parse` whose error no mapper recognizes, so malformed input is a
  500 today.
- `runtime-control.ts` in the Worker throws the same error for a mismatched
  owner whether the admission came from the request or from stored state.
- `device-webhook-enqueue.ts` answers 400 for keyring and persistence
  failures as well as for bad input, and a test pins that.
- Catch-all parse adapters that already produce a domain rejection but also
  catch parser bugs.

## Success criteria (stage 4)

- Every existing response expectation passes untouched. The one changed
  expectation outside logs is a test-only Worker route that now lets an
  unrelated `RangeError` reach the outer mapper.
