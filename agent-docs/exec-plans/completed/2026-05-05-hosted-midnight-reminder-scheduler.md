# Hosted midnight reminder scheduler

Status: completed
Created: 2026-05-05
Updated: 2026-05-05

## Goal

- Reproduce and fix the hosted scheduled automation miss where an active `dailyLocal`
  reminder at `00:00` in `Asia/Kuala_Lumpur` did not enqueue a turn/delivery at
  `2026-05-04T16:00:00Z`.
- Add focused runtime diagnostics and local Cloudflare/hosted-local E2E coverage
  proving the scanner selects and delivers the due Linq reminder.

## Success criteria

- Scanner eligibility handles `dailyLocal` at local midnight across the UTC date
  boundary using the vault canonical timezone.
- An automation created on `2026-05-03T22:17:55Z` is due at the next KL midnight
  (`2026-05-04T16:00:00Z`) and is not treated as already missed.
- Hosted runtime returns/schedules the next automation wake after scans, and a
  local Cloudflare-hosted E2E test proves the due Linq reminder creates a
  delivery.
- Diagnostics expose per-scan/per-automation metadata without leaking user
  identifiers, prompts, message bodies, routes, or filesystem paths.
- Focused tests, typecheck, required audits, and a completion checklist cover the
  reported issue.

## Scope

- In scope:
  - `packages/assistant-engine` automation scanner/schedule/run-state behavior.
  - Hosted runtime wake propagation as needed for scheduled automations.
  - Hosted-local Cloudflare E2E scenario coverage for the Linq daily reminder path.
  - Focused diagnostics for scheduler discovery/eligibility/enqueue outcomes.
- Out of scope:
  - Live Linq provider calls.
  - Broad hosted checkpoint, browser-vault, onboarding, or biomarker changes
    already active in this checkout.

## Constraints

- Technical constraints:
  - Preserve the local assistant runtime storage boundary: automation config is
    canonical vault state; run history/diagnostics are assistant runtime state.
  - Keep logs metadata-only and redacted.
  - Do not overwrite unrelated dirty work in active hosted/web files.
- Product/process constraints:
  - Follow high-risk runtime workflow, security/privacy review, coverage review,
    and final task review before handoff.

## Risks and mitigations

1. Risk: timezone bug is masked by hosted alarm/nudge behavior.
   Mitigation: add both scanner-level unit coverage and hosted-local E2E proof.
2. Risk: diagnostics leak user content or routing identifiers.
   Mitigation: log counts, schedule metadata, reason codes, and route presence only.
3. Risk: dirty worktree overlap blocks scoped commit.
   Mitigation: keep the workset narrow and report any unrelated overlap explicitly.

## Tasks

1. Trace `dailyLocal` scan eligibility, timezone resolution, run-state init, and
   next-wake propagation.
2. Reproduce the May 5 KL midnight miss with a focused scanner test.
3. Patch scanner/runtime behavior and add safe diagnostic events.
4. Add a hosted-local Cloudflare E2E scenario that creates a KL midnight Linq
   reminder and proves delivery on the due wake.
5. Run focused verification, required audits, and completion checklist.

## Decisions

- Treat `2026-05-04T16:00:00Z` as the authoritative due instant for midnight
  KL on 2026-05-05 local time.
- Anchor missing canonical automation runtime state to the automation creation
  timestamp, not the scan timestamp, so the first due instant is not skipped.
- Persist cron scanner diagnostics as metadata-only hosted automation details:
  counts, schedule kind, due reason, route-presence boolean, and timezone.
- Keep hosted-local test-only Worker routes behind `NODE_ENV=test`, an explicit
  hosted-local test-route flag, Vercel OIDC, and a bound-user header match.
- Keep `linq-delivery` hosted-local E2E scoped to the existing first-contact
  delivery scenario; run the scheduled reminder scenario as its own named gate.
- Add a dedicated `linq-scheduled-reminder` predeploy gate in
  `.github/workflows/deploy-cloudflare-hosted.yml` so the manual Cloudflare
  hosted deploy path blocks on the midnight reminder regression independently
  from broader Linq first-contact coverage.

## Verification

- Passed:
  - `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts --no-coverage test/assistant-cron-runtime.test.ts`
  - `pnpm --dir packages/assistant-engine typecheck`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-maintenance.test.ts -t "logs automation events emitted during the hosted pass"`
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir apps/web typecheck`
  - `pnpm --dir packages/hosted-local-harness typecheck`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/helpers/hosted-local-wake.test.ts`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/index.test.ts`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/index.test.ts scripts/dev-hosted-local/environment.test.ts`
  - `pnpm hosted-local e2e --no-bundle linq-scheduled-reminder`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/deploy-automation.test.ts`
  - `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage apps/cloudflare/test/run-hosted-local-e2e.test.ts apps/cloudflare/test/deploy-automation.test.ts`
- Blocked/unrelated:
  - `pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-maintenance.test.ts`
    currently fails in device-sync/no-op result-shape expectations because
    unrelated dirty work adds `postCheckpointRecord` to maintenance metrics.
  - `pnpm hosted-local e2e --no-bundle linq-delivery` still fails in the
    pre-existing first-contact file because local Linq inbound webhook requests
    are rejected as `local-inbound-not-allowlisted` by unrelated active work.
- Audits:
  - Security/privacy review found the hosted-local test routes needed an
    additional explicit flag and bound-user enforcement; fixed and covered in
    `apps/cloudflare/test/index.test.ts`.
  - Coverage review found the hosted E2E needed persisted
    `failureRuntimeStatePresent: false` coverage and CI-facing scenario
    registration; fixed.
  - Task finish review found the hosted-local command contract needed the new
    scheduled-reminder scenario in its expected default file list; fixed and
    covered in `apps/cloudflare/test/run-hosted-local-e2e.test.ts`.
  - Final task review found the E2E next-wake assertion was date-sensitive;
    fixed by asserting a future `Asia/Kuala_Lumpur` midnight.
Completed: 2026-05-05
