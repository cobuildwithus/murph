# Hosted runtime timeout and env hardening

Status: completed
Created: 2026-05-27
Updated: 2026-05-27

## Goal

- Harden hosted runtime startup timeout validation and Cloudflare Worker environment parsing so malformed or too-small numeric configuration fails before it can churn write fences or silently truncate values.

## Success criteria

- Ensure `HOSTED_RUNTIME_PROCESSING_TIMEOUT_MS` and the ensure-processing timeout header reject budgets that cannot leave the fixed command response margin.
- Ensure the Worker web-control timeout also rejects budgets that cannot leave the fixed command response margin because it participates in the effective command budget.
- Ensure Cloudflare Worker integer env parsing rejects non-digit suffixes such as `30000abc`.
- Ensure worker route logs redact user-bound internal route path segments.
- Preserve the intentional async boundary where post-acceptance runner failures clear the fence later.
- Clear the known full-verification typecheck blocker if it is still present, then rerun the required verification gate.

## Scope

- In scope: `apps/cloudflare` runtime env/request parsing, focused Cloudflare runner tests, any narrow fix needed for the known `supportsWebSockets` typecheck blocker.
- Out of scope: broad hosted runner scheduling redesign, new persisted state, deployment automation, product behavior changes.

## Constraints

- Technical constraints: keep Cloudflare as a thin execution adapter; do not weaken write-fence or fail-closed behavior; do not use partial numeric parsing for configuration.
- Product/process constraints: no raw identifiers, paths, payloads, prompts, provider bodies, or secrets in logs/tests/docs; preserve unrelated active ledger rows.

## Risks and mitigations

1. Risk: rejecting previously tolerated malformed env strings could surface bad deploy config at startup.
   Mitigation: fail early with explicit configuration errors instead of accepting ambiguous values.
2. Risk: raising the minimum timeout could accidentally reject the current default.
   Mitigation: use the existing command response margin as the lower bound and cover defaults in tests.

## Tasks

1. Inspect the current hosted runtime timeout and Cloudflare Worker env parsing code. Done.
2. Add a shared/internal minimum valid ensure-processing timeout and mirror it in request parsing. Done.
3. Replace Cloudflare `parseInt` env parsing with strict integer parsing for timeout/readiness/idle settings. Done.
4. Add focused tests for invalid header/env values and the intentional async failure boundary. Done.
5. Fix the known assistant-engine typecheck blocker if still present. Checked; package-local assistant-engine typecheck passes without a code change.
6. Address completion-audit findings. Done.
7. Isolate the Cloudflare hosted-local runner test from full-acceptance generated-artifact env flags. Done.
8. Run required verification and completion audits. Done.

## Decisions

- Use the existing `RUNTIME_PROCESSING_COMMAND_RESPONSE_MARGIN_MS` as the lower bound because command execution subtracts that fixed margin.
- Apply the same lower bound to `HOSTED_EXECUTION_WEB_CONTROL_TIMEOUT_MS` because the runner uses the minimum of web-control and caller command timeouts for the command budget.
- Redact user-bound worker route path segments in structured log details rather than relying on `userId` field sanitization alone.
- Keep the hosted-local E2E runner test independent from acceptance harness artifact-prepared env flags so the full gate can run it after prior preparation steps.

## Verification

- Commands to run: focused Cloudflare tests while iterating; `pnpm typecheck`; `pnpm verify:acceptance` unless blocked by a credibly unrelated failure; required completion audit passes.
- Focused checks passed:
  - `pnpm --dir packages/hosted-execution test -- temporal-env.test.ts`
  - `pnpm --dir apps/cloudflare test -- env.test.ts index.test.ts user-runner-alarm.test.ts`
  - `pnpm --dir packages/assistant-engine typecheck`
- Security/privacy review found two low findings: web-control timeout minimum and raw user route path logging. Both were fixed.
- Coverage-write follow-up found the current proof sufficient and made no file changes.
- Full `pnpm verify:acceptance` got past package/app typecheck, including the original assistant-engine blocker, then failed in `apps/cloudflare` hosted-local runner tests because acceptance-level generated-artifact env flags caused setup spawns to be skipped. The test now clears those env flags before each case.
- `MURPH_HOSTED_WEB_PRISMA_GENERATED_PREPARED=1 MURPH_HEALTH_COMMONS_GENERATED_PREPARED=1 pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/run-hosted-local-e2e-runner.test.ts` passed.
- `pnpm --dir packages/cli test:coverage` passed after the first full-gate attempt timed out in the CLI lane under concurrent load.
- `pnpm --dir apps/cloudflare verify` passed after the hosted-local runner test isolation fix.
- Final `pnpm verify:acceptance` rerun completed through the final package coverage suite without failures.
Completed: 2026-05-27
