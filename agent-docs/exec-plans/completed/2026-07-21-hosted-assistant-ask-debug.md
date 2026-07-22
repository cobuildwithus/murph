# Hosted Assistant Ask debug

## Goal

Find and fix the private-chat to joined-group `murph.group(action="ask")`
failure that currently returns only a generic tool error.

Success criteria:

- Prove whether failure occurs during group-label resolution, request creation,
  runtime signaling, or downstream completion handling.
- Preserve Web ownership of group authority and the existing encrypted mailbox
  as the only durable request/result state.
- Return a safe, actionable error code and correlation identifier without
  exposing private content or internal identifiers.
- Verify exact-casing and case-insensitive visible-label behavior, request
  creation, group runtime handoff, and personal-runtime completion queueing.
- State the required Web and Cloudflare deployment order from code and rollout
  evidence.

## Constraints

- Do not expose member ids, mailbox payloads, questions, answers, credentials,
  local paths, or provider bodies in logs, diagnostics, tests, or durable docs.
- Do not add a second queue, scheduler, retry owner, projection, or status row.
- Keep model-supplied labels as selectors only; Web must derive and recheck all
  authority and runtime identities.
- Preserve foreground group replies while the read-only Ask child runs.

## Approach

1. Trace the tool schema and runtime adapter into the signed Web control route.
2. Inspect the current producer-gate removal and Cloudflare consumer rollout
   history to determine deployment skew requirements.
3. Reproduce the failing boundary with focused tests or production-safe
   metadata-only evidence.
4. Apply the smallest owner-boundary fix and safe error projection.
5. Run focused tests, canonical diff verification, direct scenario proof, and
   the required completion audits.
6. Commit the scoped change, open a PR, and run ReviewGPT with CI.

## State

Implementation, coverage review, and canonical verification are complete;
commit, PR, CI, and ReviewGPT gates remain.

## Root-cause evidence

- The signed group-tool endpoint returned HTTP 500 for both reproduced asks.
  Provider logs identified Prisma `P2010`: the raw query could not deserialize
  PostgreSQL's `void` result.
- The failing query was the Assistant Ask transaction's
  `pg_advisory_xact_lock` call through `$queryRaw`. The request failed before
  membership selection, mailbox append, or runtime signaling.
- Production-safe metadata checks showed a current owner membership, linked
  group runtime, and no request or completion mailbox item for the failed
  origin. That rules out label casing, membership permission, downstream
  dispatch, and completion queueing as the observed failure boundary.

## Implemented correction

- Execute the void-returning advisory lock through `$executeRaw`, matching the
  repository's existing PostgreSQL lock pattern.
- Attach the deterministic opaque Ask request id to signed Web responses and
  preserve only a validated request id, allowlisted Prisma `P####` diagnostic
  code, and HTTP status through Cloudflare to the personal model.
- Keep raw exception messages, response bodies, content, membership ids,
  runtime ids, and return routes out of tool diagnostics.

## Verification evidence

- Focused Web Ask admission and route tests: 20 passed.
- Focused assistant group-tool tests: 48 passed.
- Focused Cloudflare runtime-platform tests: 136 passed.
- Focused hosted-execution contract tests: 55 passed.
- Web, Cloudflare, assistant-engine, and hosted-execution typechecks passed.
- Final-head `pnpm verify:acceptance` passed after rebasing onto current
  `main`, including the full Web production build, Cloudflare Node and Workers
  tests, package coverage, hosted runtime checks, and built-package boundaries.
- `pnpm test:diff` completed the affected owner suites but encountered a
  dispatcher prerequisite gap when the hosted-local package-boundary test ran
  without the assistant-runtime build output. Building that declared runtime
  dependency and rerunning the exact hosted-local boundary passed (2 tests);
  the full hosted-local harness then passed 406 tests with 1 skipped.
- The required coverage-write pass added malformed-diagnostic regressions and
  identified that generic Web error mapping still hid the observed Prisma
  code. The final contract now projects only the fixed `P####` form; positive
  and rejection cases pass across Web, Cloudflare, and assistant-engine tests.
- Final-head `pnpm test:diff` passed after rebasing onto current `main`,
  including all affected package suites, hosted-local boundary proof, 6,037
  Web tests plus lint/dev smoke/production build, and 1,850 Cloudflare Node
  tests plus the Workers lane.
Status: completed
Updated: 2026-07-21
Completed: 2026-07-21
