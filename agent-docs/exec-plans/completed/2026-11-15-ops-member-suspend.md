# Suspend and restore members from Ops usage

Status: completed
Created: 2026-11-15
Updated: 2026-11-15

## Goal

Ops can suspend or restore a person from usage search. Suspension retains identity
and silently denies new assistant work and member messaging through existing access gates.

## Success criteria

- Person rows expose a confirmed, idempotent Suspend/Restore action; containers do not.
- Linq, Telegram, email, signup and queued-work regression proof keeps suspended members silent.
- Focused tests, Web typecheck/lint and rendered proof pass before the local scoped commit.

## Scope

- In scope: Ops controls and authenticated mutation of existing `suspendedAt`,
  silent access recovery, and channel/runtime regression proof.
- Out of scope: production access, deployments, pushes and PR creation.

## Constraints

- Reuse existing identity, access and runtime owners; no new persisted state or migration.
- Use synthetic evidence only. Preserve unrelated edits. Parent session owns PR/CI and final ReviewGPT.

## Risks and mitigations

1. Identity lookup accidentally treats suspension as a new contact: exercise real
   identity/routing queries and first-contact suppression.
2. Existing visible recovery sends an account notice: return silence at its shared owner.
3. Warm or queued work uses stale permission: trace and prove live admission; reuse
   the existing recheck signal only if needed.

## Tasks

1. Hydrate workspace; trace routing, signup, delivery and warm runtime access.
2. Add the smallest person-only mutation and row confirmation controls.
3. Prove silence, restore, authorization, idempotency and error recovery.
4. Review complete diff, record evidence, close plan and commit locally.

## Decisions

- Linq routing in this checkout does not filter suspended identities; the reported
  active-person filter only counts line capacity. Direct planner already ignores suspension.
- Telegram planner ignores suspension, but its visible-access adapter currently sends
  an account-unavailable notice. Queued Linq/Telegram recovery uses the same helper.
- Email route access and bootstrap both recheck canonical access and deny suspension.

## Product UX

- Outcome: owner searches, confirms Suspend, sees Suspended and Restore; restore clears it.
- Entry: existing usage row actions, including contact search; confirmation says
  "Murph stops replying to them. They are not told."
- Journeys: person active/suspended, container, cancel, pending, failure/retry,
  phone/desktop; no member notification on either operation.
- Proof: real component interaction tests plus rendered synthetic catalog evidence.
- Verdict: Ready. Replayed cancel, suspend, saved-change recheck retry, restore,
  contact search and container exclusion. Inspected the real production controls
  at 390px and 1440px; fixed inherited desktop no-wrap clipping. Synthetic catalog
  interaction responses were intercepted; this was not a live Ops-auth browser test.

## Verification

- `pnpm install --prefer-offline` — 0.
- `pnpm build:workspace:incremental` — 0.
- `pnpm --dir packages/health-commons generate` — 0.
- `pnpm --dir apps/web prisma:generate` — 0.
- `createdb -h 127.0.0.1 -p 5432 -U postgres murph_test_ops_suspend` — 0.
- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_ops_suspend pnpm --dir apps/web prisma:migrate:deploy` — 0; isolated local test database only.
- `pnpm --dir apps/web test:prepared test/hosted-ops-member-suspension-route.test.ts test/hosted-recognized-inbound-access.test.ts test/hosted-visible-access-webhooks.test.ts test/hosted-visible-runtime-reconciliation.test.ts test/hosted-orchestration-signal-runtime.test.ts test/ops-member-usage-client.test.tsx` — first 1, then 0 (106 tests). Corrected three test expectations/setup issues: fake DOM lacks native confirm, non-Ops auth conceals with 404, inactive recheck now succeeds.
- `DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/murph_test_ops_suspend MURPH_TEST_POSTGRES_CONCURRENCY=1 pnpm --dir apps/web test:prepared test/hosted-ops-member-suspension-postgres.test.ts --maxWorkers=1` — first 1, then 0 (one composed scenario). Corrected the invite test to authenticate its member and expect the existing blocked stage; also exercises stale-session enrollment denial.
- `pnpm --dir apps/web test:prepared test/hosted-onboarding-linq-dispatch.test.ts test/hosted-onboarding-telegram-dispatch.test.ts test/hosted-execution-email-callback-routes.test.ts test/hosted-email-public-bootstrap.test.ts test/hosted-visible-secondary-webhooks.test.ts` — 0 (371 tests).
- `pnpm --dir apps/web test:prepared test/hosted-ops-usage-reset-route.test.ts test/hosted-onboarding-member-access-runtime-handoff.test.ts test/hosted-onboarding-starter-usage-enrollment-service.test.ts test/hosted-onboarding-lifecycle.test.ts` — 0 (67 tests).
- `pnpm --dir apps/web typecheck:prepared` — 0, both initial and final runs.
- `pnpm --dir apps/web lint` — 0; existing repository warnings, none on new suspension files.
- `pnpm complexity:diff` — 0; existing usage component hotspots unchanged; no new complexity debt.
- `pnpm test:frontend-design-proof` — 0 (11 tests).
- `VIEWPORT_OVERFLOW_PORT=3274 NEXT_DIST_DIR_SUFFIX=member-suspend-proof MURPH_PLAYWRIGHT_GENERATED_INPUTS_PREPARED=1 DESIGN_PROOF_OUTPUT_DIR=../../.artifacts/review-gpt/member-suspend pnpm --dir apps/web exec playwright test e2e/pr-member-suspension-design-proof.spec.ts --config playwright.config.ts --project chromium --workers=1` — first 1 (overbroad container-button locator included Reset), then 0; final run after wrapping fix 0 (two viewports). One-off capture spec and screenshots retained in ignored `.artifacts/review-gpt/member-suspend/`. Catalog hydration warnings came from test-only inert/caret mutations, not production Ops state.
- `git diff --check` — 0.

## Proof and handoff

- PostgreSQL proof composes the actual Ops writer, identity queries, both inbound
  planners, authenticated invite status, enrollment rejection, email bootstrap,
  runtime AI gates in all three modes, mailbox access and reconciliation facts.
  No provider fetch, email send, mailbox append, new invite or runtime owner occurs.
- Linq was already silent at direct admission, including new chat IDs. Its
  queued/recognized recovery could emit an unavailable-account notice; it is now silent.
- Telegram already rejected model admission, but the visible wrapper converted
  suspension into a notice. It now returns the ignored response immediately.
- Email already rejected suspended alias/public routes and bootstrap; regression
  evidence preserves that behavior and its retained identity.
- Warm runtime passes can retain staged inputs, so Ops sends the existing
  `runtime_recheck_requested` after commit, including when access is inactive.
  Signal delivery and canonical denial are tested; no live Temporal/Cloudflare
  runtime was used. Already-started provider work cannot be recalled by this hint.
- No prompt, tools, schema or model policy changed. Silence is deterministic
  before provider admission, so the proof asserts zero provider calls instead of
  running a real-model journey that would violate the scenario's required boundary.
- Changelog: not applicable; internal operator moderation controls and intentional
  silent suppression, with no member-facing feature announcement.
- Parent owns the push, PR, required CI and risk-routed final ReviewGPT. Local
  draft PR body is in ignored `.artifacts/review-gpt/member-suspend/pr-body.md`;
  replace its local design link with the current preview after the parent pushes.
Completed: 2026-11-15
