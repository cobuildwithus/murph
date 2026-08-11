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
  against the named timezone instead of being converted to a date by the model.
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
- Hosted CLI mutation restrictions cannot be bypassed by unsetting an ordinary
  hosted env var in a child shell.
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
4. Harden hosted CLI mutation detection against child shells that remove ordinary
   hosted env vars, including nested process trees, without disabling local Linux
   automation when an unrelated ancestor hides process metadata.
5. Add focused regression tests.
6. Run focused package checks and commit with the plan archived.

## Decisions

- Treat the downloaded artifact as unusable because it contains only a finalizer
  error and no patch body; implement from the retained assistant response.
- Return bounded model-facing recovery for daylight-saving gaps, folds, invalid
  timezones, and optimistic-concurrency conflicts without exposing raw errors.
- Preserve today/tonight/tomorrow as a bounded semantic field until the trusted
  resolver computes the named-zone calendar date; use an explicit date only
  when the request or established context already supplies one.
- Resolve hosted Linux ancestry exhaustively at the automation CLI mutation
  boundary and treat unreadable, malformed, or cyclic process metadata as unknown.
  Automation CLI mutations fail closed only when the current environment or a
  readable ancestor proves hosted lineage. Unknown lineage remains usable for
  local Linux callers because hardened runners commonly hide unrelated ancestor
  environments; the inherited current-process marker is still checked first.

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
Completed: 2026-08-11
