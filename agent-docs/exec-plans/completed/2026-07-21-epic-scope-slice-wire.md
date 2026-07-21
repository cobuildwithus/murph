# Epic query-scope and slice wire identity

Status: completed
Created: 2026-07-21
Updated: 2026-07-21

## Goal

- Land the original Epic migration guide's PR 3 by carrying the opaque
  `queryScopeId` and deterministic `sliceId` through every credential-free
  clinical-records run, page, cursor, fingerprint, and terminal outcome across
  Web, hosted execution, and Cloudflare.

## Success criteria

- Current beta retrieval remains behaviorally unchanged and no disabled Epic
  query scope becomes executable in this PR.
- New wire messages bind page authority, cursors, claims, fingerprints, and
  outcomes to both query-scope and slice identity.
- Additive readers accept the legacy beta shape only by synthesizing the three
  owned beta scope IDs and the `whole` slice; ambiguous or mismatched partial
  identity fails closed.
- Scope/type, fingerprint, cursor-swap, slice-swap, stale-generation, replay,
  host/path escape, redirect escape, and compatibility behavior have focused
  regression coverage.
- Required owner verification, coverage audit, exact-head CI, and ReviewGPT
  complete before handoff.

## Scope

- In scope: shared credential-free clinical-record wire contracts, Web-owned
  retrieval/cursor/request-claim boundaries and internal routes, Cloudflare
  transport parsing, focused tests, and current durable Epic intake/runtime
  documentation.
- Out of scope: activating any of the 21 disabled longitudinal query scopes,
  checkpoint v2 and per-slice import (PR 4), dependency traversal, token refresh,
  canonical mapper expansion, and the later operational per-query projection.

## Constraints

- Technical constraints: Web remains the sole Epic policy, credential, patient
  context, provider-URL, and egress owner. Lower packages treat query IDs as
  opaque and validate resource type separately. Preserve the current generation
  fence, claim CAS, host/path and redirect checks, and page/byte bounds.
- Product/process constraints: use the additive rollout order from the original
  guide; register broader Epic APIs separately from activating them; keep the
  current beta policy active; preserve unrelated work and avoid new state owners.

## Risks and mitigations

1. Risk: an identity field is accepted but omitted from a downstream authority
   check, allowing a cursor or page claim to be replayed across query variants.
   Mitigation: derive one owned retrieval identity and assert it at every Web,
   hosted, and Cloudflare boundary with swap/replay tests.
2. Risk: additive compatibility silently accepts malformed mixed old/new
   messages.
   Mitigation: synthesize only the exact legacy beta shape; reject partial new
   identity or scope/type disagreement.
3. Risk: expanding the wire surface accidentally activates disabled Epic APIs.
   Mitigation: leave the active acquisition policy and emitted beta plan
   unchanged, and add an explicit disabled-scope guard test.

## Tasks

1. Trace the exact post-PR-2 run/page/cursor/fingerprint/outcome path and classify
   legacy/new compatibility at each boundary.
2. Extend shared hosted-execution contracts and Web-owned identity/fingerprint/
   cursor logic with strict validation.
3. Propagate the identity through Cloudflare transport and every internal Web
   clinical-record route without exposing Epic query semantics below Web.
4. Add focused adversarial and legacy compatibility tests and update durable
   registration/deployment guidance.
5. Run required verification and audits, close the plan with a scoped commit,
   push, open the PR, and run CI with ReviewGPT against the exact pushed head.

## Decisions

- Treat PR 3 as transport authorization work, not query activation. Broader Epic
  API registration may happen ahead of activation, but execution remains gated
  by the active Web policy until later migration PRs land.
- Pin the wire protocol on each retrieval run with nullable
  `retrievalProtocol`: pre-existing null rows complete on the legacy aggregate
  contract, while newly created rows use `query-slices-v2`. This avoids changing
  identity semantics midway through a run.
- Derive page fingerprints and cursor bindings from the frozen run, query scope,
  query fingerprint, resource type, slice, generation, and page URL rather than
  trusting echoed fields from the runner. Persist only opaque query/slice ids on
  request claims.
- Keep one narrow PR-1 runner compatibility reader: a query-aware page request
  may omit `queryFingerprint`, and a query-aware run may receive the old
  aggregate terminal outcome. Remove both readers after old runner bundles and
  their serviceable in-flight runs drain and the rollback floor advances.
- Raise only the signed terminal-outcome request cap from 8 KiB to 32 KiB; the
  bounded maximum 80-slice shape is above 8 KiB and below 32 KiB. No page-body
  or provider-response limit changes.
- Correct Epic registration metadata to the exact current 38-name R4 catalog,
  including `Provenance.Read (R4)`, without activating any of the 21 disabled
  query scopes or requesting refresh/offline access.

## Verification

- Focused production-boundary proof passed: 7 Web/Cloudflare/assistant-runtime/
  hosted-execution files, 138 tests. The Web harness called the real run-read,
  page-fetch, cursor, claim, provider-response, and terminal-outcome functions
  with controlled database, crypto, and egress boundaries.
- Affected Web, Cloudflare, assistant-runtime, and hosted-execution typechecks
  passed; Prisma validation and touched Web ESLint passed without warnings.
- `pnpm docs:drift` and `git diff --check` passed.
- `coverage-write` added focused old-runner missing-fingerprint, query-aware
  request replay, ordered outcome identity, and parser compatibility tests. Its
  final focused runs passed 44 Web tests and 9 hosted-execution tests with zero
  remaining actionable coverage findings.
- `NODE_OPTIONS=--max-old-space-size=6144 pnpm verify:acceptance` passed every
  architecture/dependency/doc/typecheck gate and every package test suite. Its
  concurrent package wrapper reported Inboxd coverage as failed even though
  that job printed 208 passing tests; an immediate isolated
  `pnpm --filter @murphai/inboxd test:coverage` rerun passed all 208 tests and
  thresholds, proving transient local contention outside this diff.
- Earlier `pnpm test:diff` attempts established all affected typechecks and the
  assistant-engine/runtime owner suites as green; the first hit the default-heap
  assistant-engine OOM and the second later hit unrelated CLI subprocess
  timeouts under machine load. The acceptance lane above supersedes those local
  owner results.
- Remaining: reconcile with current `main`, close this plan with the scoped
  commit, push/open the PR, then require exact-head CI and ReviewGPT `PASS` with
  zero accepted findings.
Completed: 2026-07-21
