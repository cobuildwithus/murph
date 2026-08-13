# One-shot reminder timezone boundary fix

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Fix user-authored one-shot reminder scheduling so local wall-clock requests at
  timezone/date boundaries resolve to the intended future instant, and make
  hosted correction/cancellation mutations verify the authoritative stored
  automation before changing it.

## Success criteria

- The dynamic automation mutation path accepts a structured local one-shot
  schedule with an explicit calendar date or preserved relative day, wall-clock
  time, and IANA timezone.
- Relative words such as today, tonight, and tomorrow are resolved by the host
  against the named timezone and the accepted input timestamp instead of being
  converted to a date by the model or resolved when a delayed tool call arrives.
- Exact ISO `at` schedules keep their existing behavior for programmatic callers.
- Generic model-authored one-shots cannot bypass local-time resolution with raw
  exact-ISO input, while code-owned programmatic callers retain exact instants.
- Local wall-clock resolution rejects nonexistent DST gap times and requires an
  explicit earlier/later choice for ambiguous DST fold times instead of guessing.
- Automation mutation results include a stored readback and verified next
  occurrence after save/update/cancel.
- Correction and cancellation mutations require inspection evidence from the
  current stored automation, including the existing optimistic concurrency guard.
- Generic hosted saves are atomic create-only operations; existing records can
  change only through versioned patch or their existing scoped reconciliation owner.
- Hosted CLI mutation restrictions are tied to the immutable hosted-runner image
  role, not inherited environment or mutable process ancestry.
- The hosted automation tool has a read-only inspect action that returns the
  stored version and scheduler-owned timing projection without changing bytes.
- Focused tests cover the timezone boundary incident, DST gap/fold handling,
  readback/guard behavior, and hosted mutation boundary.

## Scope

- In scope: assistant automation dynamic tool schema and resolver, directly
  coupled hosted instructions, hosted CLI/assistant runtime mutation boundary,
  focused tests, and durable docs only where behavior contracts change.
- Out of scope: a new scheduler engine, new dependencies, unrelated reminder
  availability behavior, broad prompt rewrites, and production data inspection.

## Constraints

- Technical constraints: keep `at` as exact ISO input; store canonical one-shot
  schedules as existing automation records; use standard platform timezone
  primitives rather than adding a date library.
- Product/process constraints: preserve product-critical reminder creation,
  correction, and cancellation flows; do not expose private incident rows or
  direct identifiers in artifacts.

## Risks and mitigations

1. Risk: over-tightening mutation requirements blocks legitimate reminder fixes.
   Mitigation: require readback/concurrency only for update/cancel paths and
   preserve exact create behavior.
2. Risk: local-time resolution guesses during DST transitions.
   Mitigation: compare candidate instants against formatted local parts and fail
   closed on zero or multiple matches.

## Tasks

1. Locate the current automation dynamic tool schema, schedule normalization,
   hosted scheduling instructions, and vault-cli hosted guard.
2. Add structured local one-shot input and timezone resolver while preserving
   exact ISO `at`.
3. Add authoritative mutation readback and require inspection/concurrency for
   correction and cancellation paths.
4. Remove automation CLI mutations from the hosted-runner image role while
   preserving the ordinary local CLI on Linux and other platforms.
5. Add a typed read-only hosted inspect operation backed by the same scheduler
   projection used after writes.
6. Add focused regression tests.
7. Run focused package checks and commit with the plan archived.

## Decisions

- Treat the downloaded artifact as unusable because it contains only a finalizer
  error and no patch body; implement from the retained assistant response.
- Return bounded model-facing recovery for daylight-saving gaps, folds, invalid
  timezones, and optimistic-concurrency conflicts without exposing raw errors.
- Preserve today/tonight/tomorrow as a bounded semantic field until the trusted
  resolver computes the named-zone calendar date from one accepted-input
  reference instant; use an explicit date only when the request or established
  context already supplies one. Validation and canonicalization share that one
  resolution rather than reading the clock twice.
- Make the typed root hosted automation port the exclusive hosted mutation owner.
  The hosted-runner image contains a root-owned, read-only role sentinel, and the
  automation CLI rejects every mutation when that immutable image role is present.
  Local CLI installs have no sentinel and retain normal save, edit, status,
  reconcile, and import behavior.
- Keep the existing scheduler projection as the sole owner of next-occurrence
  calculations. The new typed inspect action reads the stored record and returns
  its current version plus that projection without calling a write use case.

## Retrospective

The first hardening pass treated inherited hosted environment and Linux process
ancestry as authority. That repeated the original design mistake: it inferred a
durable product role from mutable execution context. It could deny legitimate
local Linux callers when process metadata was opaque, yet a sufficiently detached
hosted child could be reparented outside the marked ancestry and regain the CLI
mutation surface.

The replacement boundary is deliberately smaller. Hosted automation writes are
owned only by the typed root tool. The container image itself declares that role
with a fixed root-owned sentinel under the already root-owned read-only application
tree, so environment deletion, nested children, detachment, and reparenting do not
change the decision. No lease, receipt directory, process registry, or additional
state machine is introduced. The same change also closes a separate contract gap:
prompts required inspecting existing timing, but the model-facing port exposed no
read action. A typed inspect request now reuses the authoritative scheduler
projection and is covered by a byte-for-byte no-mutation test.

## Verification

- `pnpm --dir packages/assistant-engine test test/assistant-hosted-domain-tools.test.ts test/model-behavior.test.ts test/onboarding-first-personal-read.test.ts`
  passed.
- `pnpm --dir packages/assistant-runtime test test/hosted-runtime-workspace-assistant-phase.test.ts -t "automation|first personal read|scheduler's exact future occurrence|route unless"`
  passed.
- `pnpm --dir packages/core test test/write-operation-pruning.test.ts` passed.
- `pnpm --dir packages/assistant-engine typecheck` passed.
- `pnpm --dir packages/assistant-runtime typecheck` passed.
- `pnpm --dir packages/core typecheck` passed.
- Authenticated-group scripted coverage passed for local one-shot resolution and
  verified stored timing readback.
- `pnpm --dir packages/assistant-engine test test/assistant-codex-scripted-runtime.test.ts -t "stored timezone|stale one-shot|unverified stale recurrence|native deferred|first personal|device-activity|native search"`
  passed.
- `pnpm --dir packages/assistant-engine test test/assistant-codex-runtime.test.ts -t "requires exact active-turn identity"`
  passed.
- `pnpm --dir packages/assistant-engine test test/assistant-hosted-domain-tools.test.ts test/model-behavior.test.ts test/onboarding-first-personal-read.test.ts test/assistant-codex-scripted-runtime.test.ts`
  passed with 136 tests.
- Focused accepted-input reference coverage passed: the host resolves a request
  accepted immediately before named-zone midnight even when tool parsing occurs
  after midnight; initial provider input and live-steered delivery contexts both
  carry their own immutable reference instant.
- `pnpm --dir packages/assistant-runtime test test/hosted-runtime-workspace-assistant-phase.test.ts`
  passed with 282 tests, including byte-for-byte read-only inspect coverage.
- `pnpm --dir packages/cli test test/automation.test.ts test/automation-hosted-image.test.ts`
  passed with 22 tests.
- `pnpm --dir apps/web test:prepared test/changelog.test.ts` passed with 35
  tests. An earlier command using the nonexistent `changelog-schema.test.ts`
  filter exited with no tests; the repository's actual changelog suite passed.
Completed: 2026-08-11
