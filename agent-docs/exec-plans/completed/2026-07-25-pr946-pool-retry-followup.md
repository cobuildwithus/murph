# PR 946 saturation-aware retry and telemetry follow-up

Status: completed
Created: 2026-07-25
Updated: 2026-07-25

## Goal

- Make the shared Prisma seam apply backpressure under visible local saturation,
  allow only one jittered retry for ambiguous no-work failures, and distinguish
  pool acquisition delay from connection-held transaction time.

## Success criteria

- The first prospective waiter emits bounded pool-pressure telemetry.
- A checkout timeout observed while the local pool is full or queued is not
  retried.
- An ambiguous replay-safe failure receives at most one jittered retry.
- Interactive transactions report acquisition/start delay separately from
  callback connection-held duration.
- Focused, real-PostgreSQL, full acceptance, specialist ReviewGPT, final parent
  review, final ReviewGPT, and CI are green on the pushed head.

## Scope

- In scope: the existing shared Prisma retry/telemetry seam, focused tests,
  real-PostgreSQL retry proof, and truthful runtime docs.
- Out of scope: changing the configured pool size, adding a query semaphore,
  adding a sampler process, or changing caller-specific retry policy.

## Constraints

- Technical constraints: retry only failures that prove no database work ran;
  do not add queries, timers, identifiers, or query text to telemetry.
- Product/process constraints: preserve ordinary request behavior and make
  overload fail promptly instead of multiplying checkout work.

## Risks and mitigations

1. Risk: suppressing a safe failover retry by misclassifying capacity.
   Mitigation: use an explicit pool snapshot at failure time and retain one
   jittered retry only when saturation is not visible.
2. Risk: timing instrumentation labels queue delay as lock/connection hold.
   Mitigation: start held-time measurement inside Prisma's interactive callback.

## Tasks

1. Trace the merged retry implementation and PR telemetry wrapper together.
2. Add saturation classification, one jittered retry, and split timing.
3. Add deterministic unit coverage and update real-PostgreSQL proof/docs.
4. Run the required exact-head verification and review gates.

## Decisions

- Reuse the shared seam and existing pool object; add no new runtime owner.

## Verification

- Commands to run: focused Vitest, the loopback PostgreSQL retry suite,
  `pnpm test:diff apps/web/src/lib/prisma.ts`, `pnpm verify:acceptance`, and the
  repository ReviewGPT/CI gates.
- Expected outcomes: all pass; overload tests prove zero retries under visible
  capacity and exactly one retry for an ambiguous no-work failure.
- Focused Prisma coverage passed 36 cases; the isolated real-PostgreSQL lane
  passed all 3 cases.
- Canonical `pnpm test:diff apps/web/src/lib/prisma.ts` passed on the pushed
  implementation (Testbox `tbx_01kydt4my0fv05dz222gphwxp4`, Actions run
  `30179683120`).
- Preliminary specialist ReviewGPT passed with no findings on rebased head
  `21c2731f47`; manual parent review found no remaining correctness or scope
  issue.
- The current head has 25 substantive successful GitHub checks and no failures;
  the remaining status entry is the provider's blank informational check.
- `pnpm verify:acceptance` passed on the current head: all package coverage,
  hosted-web tests/lint/dev smoke/production build, Cloudflare node and worker
  suites, typechecks, package-boundary checks, and repository guards completed
  successfully.
Completed: 2026-07-25
