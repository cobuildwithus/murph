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

1. **Signals, no behavior change.** Add `ContractValidationError`,
   `RequestInputError`, `parseInput` and the shared classifier. The three
   mappers recognize `RequestInputError` first and keep native inference. Web's
   mapper logs one bounded field when native inference decided the answer.
   `assertContract` and the hosted-execution parser assertions throw
   `ContractValidationError`.
2. **Runner callbacks to Web, prepared.** Inventory the family. Its reachable
   validators throw `ContractValidationError`; its routes use `parseInput`; the
   body reader and JSON decoder throw explicit rejections. Native inference
   still on.
3. **Runner callbacks to Web, flipped.** Native inference off for the family.
   Gates: rejection parity for malformed JSON, shape, nested fields, path and
   query; injected `TypeError`, `RangeError` and `ReferenceError` inside and
   after the parser are 500; replay tests cover a failure after commit; both
   deploy orders.
4. **By owner:** Worker local catches (recap, game media), container request
   decoding, control-client response parsing, mailbox handoff retry rule,
   remaining Web families.
5. **Provider webhooks, one at a time** (payments, device data, phone,
   messaging), each with its own duplicate, partial-success and lost-response
   proof.
6. **Delete:** native inference in all three mappers, the `fetch failed`
   string match, the request-size message-prefix match, route-local ladders
   that only reconstruct input or size meaning, the `TypeError` base of
   `ContractValidationError`, and the shadow log field.

## Progress

- Stage 1: implemented in this PR.
- Independent of the stages, in their own PRs: the mailbox handoff retry rule
  and the Worker media catches (both listed under stage 4).

## Scope of this PR (stage 1)

- In scope: the two new modules and their package exports, the three mappers,
  `packages/contracts/src/validate.ts`,
  `packages/hosted-execution/src/parsers/assertions.ts`, tests, and
  `ARCHITECTURE.md` or `agent-docs/RELIABILITY.md` where the rule is stated.
- Out of scope: any status, body, header or retry change on any route.

## Success criteria (stage 1)

- A `RequestInputError` is answered 400 by all three mappers with today's
  body for that surface.
- `parseInput` converts a `ContractValidationError` and rethrows a plain
  `TypeError`, `RangeError` and `ReferenceError` unchanged.
- Every existing test passes unchanged; no route's response differs.
- The new modules import nothing from Node, Next, Cloudflare, schema barrels or
  logging, and are listed in their packages' exports.
- Both new subpaths are in every source alias list their neighbours are in
  (`tsconfig.base.json`, `apps/web/tsconfig.json`). A missing alias loads the
  class twice in one build and `instanceof` fails.
