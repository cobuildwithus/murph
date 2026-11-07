# Natural onboarding canary and separate persistence proof

## Outcome and invariant

Use a natural planning request and acceptance in the fixed-account production
canary. Observe no Goal before acceptance and exactly one active canonical Goal
afterward. Preserve strict reply latency, delivery, authority, freshness,
provenance, duplicate, and checkpoint checks. Exact-title save/readback remains
an isolated CLI integration test. No assistant policy or model changes.

## Owner and evidence

The current canary script commands an exact title and immediate save, then asks
for that title. Its observer filters on the forced title. These couple a
storage contract to production conversation behavior. Reuse the script,
read-only replica observer, canonical CLI tests, and existing live fixture.

## Design

Five turns remain: welcome, identity question, identity answer, a grounded
walking-plan request, then acceptance. Shared synthetic JSON is consumed by
the canary and the focused live proof. Existing counts describe active Goals;
model-selected titles are unrestricted. No new state, service, or credentials.
The observer retains its wire shape and authority/readiness checks. Existing
controllers still send valid active-goal requests. New controllers require the
updated observer; deployment and current-revision admission precede live runs.

## Proof and completion

- [x] Runner regressions: natural prompts, zero before acceptance, exactly one
  afterward, wrong provenance, duplicates, deadlines, and private-free failures.
- [x] Encrypted replica observer: arbitrary titles, active status, provenance,
  retained authority and checkpoint revalidation.
- [x] CLI integration: exact title/status survive fresh service readback; reads
  leave canonical records unchanged.
- [x] Focused real-model planning and acceptance; inspect replies and records.
- [x] Relevant typechecks, complexity, docs, candidate review; ready for scoped commit.

## Verification evidence

- Web Vitest: runner, encrypted outcome observer, and internal outcome route:
  123 tests passed. `node --test scripts/linq-production-canary-ci.test.mjs`:
  four tests passed.
- `pnpm --dir packages/cli test test/health-goal-save.test.ts`: nine passed,
  including exact-title save and fresh-service readback without writes.
- `pnpm --dir apps/web typecheck`,
  `pnpm --dir packages/assistant-engine typecheck`, and
  `pnpm --dir packages/cli typecheck`: passed.
- `pnpm test:assistant:live -- --test 'natural canary proposes a walking plan
  and persists it only after acceptance' --model gpt-6-luna`: passed with
  local subscription auth and an explicit authenticated local home. Luna is
  the fixed production canary target. Reply review: Ready. Proposal offered
  the grounded walking plan and waited; acceptance saved exactly one active
  Goal and one linked habit regimen, with no automations. The first three
  onboarding/delivery turns are unchanged and were not replayed locally.
- An initial generic advice request did not offer goal creation or persist on
  agreement. The final synthetic request explicitly asks to set a walking
  goal and plan, preserving normal intent without storage commands.
- `pnpm complexity:diff`, `pnpm docs:drift`, `pnpm docs:gardening`, and
  `git diff --check`: passed. No new complexity hotspots or documentation issues.
- Parent reviewed the complete diff, scope, privacy, state assertions, and
  deployment order. Production conversation latency and delivery are not
  established by the local model test. The strict 20-second canary budget is
  unchanged. No production assistant instructions, model, or scheduling changed.

## Status

Implementation and local verification complete. Internal verification change;
no member changelog. Production rollout and live hosted canary have not run.
Status: completed
Updated: 2026-09-24
Completed: 2026-09-24
