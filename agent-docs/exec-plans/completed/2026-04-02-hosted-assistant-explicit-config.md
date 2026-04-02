# Hosted assistant explicit config landing

Status: completed
Created: 2026-04-02
Updated: 2026-04-02

## Goal

- Land the supplied hosted assistant explicit-config patch on the live tree so hosted member activation persists one explicit, durable hosted assistant profile in operator config, runtime behavior fails closed when that config is missing or invalid, and the Cloudflare deploy/env/test surfaces understand the new `HOSTED_ASSISTANT_*` seed path.

## Success criteria

- `packages/assistant-core` owns a durable `hostedAssistant` operator-config model and compiles it into the existing assistant defaults shape for runtime compatibility.
- Hosted bootstrap/runtime adopts or seeds explicit hosted assistant config during `member.activated`, clears stale compiled defaults when hosted config is present but unusable, and skips hosted assistant automation/channel auto-enable when config is missing or invalid.
- Cloudflare worker/container env plumbing, deploy rendering, and error propagation understand the explicit hosted assistant env inputs.
- Focused tests for bootstrap/runtime and Cloudflare container/node-runner behavior pass, plus required repo verification is run or any pre-existing blockers are called out precisely.

## Scope

- In scope:
- Port the supplied patch intent into `packages/assistant-core`, `packages/assistant-runtime`, `apps/cloudflare`, focused tests, and touched docs/examples.
- Merge on top of the current tree instead of reverting or overwriting adjacent in-flight edits.
- Out of scope:
- Broad assistant provider refactors unrelated to hosted explicit config.
- New hosted control-plane or database models beyond the operator-config seam already used by the patch.

## Constraints

- Technical constraints:
- Preserve existing hosted runtime and Cloudflare trust boundaries; raw API keys must remain in env/secrets, not durable config.
- Avoid clobbering unrelated dirty-tree work, especially active hosted-runtime cleanups and assistant-runtime refactors.
- Product/process constraints:
- Treat the supplied patch as behavioral intent, not overwrite authority.
- Run required verification and a required completion-review audit before handoff.

## Risks and mitigations

1. Risk: The patch overlaps active hosted-runtime/Cloudflare seams and may partially duplicate newer tree state.
   Mitigation: Read the live files first, port in bounded chunks, and prefer merging into existing implementations rather than forcing patch context.
2. Risk: Hosted bootstrap and automation behavior is a trust-boundary change that can silently widen fallback behavior if merged incorrectly.
   Mitigation: Keep the fail-closed path explicit, add focused tests, and capture direct scenario proof around bootstrap/config gating.

## Tasks

1. Compare the patch with the live assistant-core, assistant-runtime, and Cloudflare files and identify conflicts or already-landed pieces.
2. Port the operator-config and hosted assistant compilation model into `packages/assistant-core`.
3. Port hosted bootstrap/runtime fail-closed behavior and supporting tests into `packages/assistant-runtime`.
4. Port Cloudflare env/deploy/container error-handling changes and focused tests.
5. Update docs/examples, run verification, complete the required audit, and commit the scoped landing.

## Decisions

- Use a dedicated execution plan despite the supplied patch because the landing is high-risk and cross-cutting across hosted runtime and Cloudflare trust-boundary surfaces.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused package/app-local tests as needed while integrating
- Expected outcomes:
- Focused hosted assistant and Cloudflare tests pass; repo-wide commands pass unless blocked by a credibly unrelated pre-existing failure, which must be documented precisely.
- Completed evidence:
- Passed: `pnpm exec vitest run --coverage.enabled false packages/assistant-runtime/test/hosted-assistant-bootstrap.test.ts packages/assistant-runtime/test/hosted-runtime-context.test.ts packages/assistant-runtime/test/hosted-runtime-maintenance.test.ts`
- Passed: `pnpm --dir apps/cloudflare test:node -- --run apps/cloudflare/test/container-entrypoint.test.ts apps/cloudflare/test/deploy-automation.test.ts apps/cloudflare/test/node-runner.test.ts apps/cloudflare/test/node-runner-hosted-assistant.test.ts`
- Passed: `pnpm typecheck`
- Required completion audit passed after follow-up fixes for activation-only hosted-config mutation, referenced secret allowlisting, and invalid-config fail-closed behavior.
- Failed for credibly unrelated pre-existing reasons: `pnpm test`
  - `packages/inboxd/test/idempotency-rebuild.test.ts:958` still fails with `Error: no such column: mutation_cursor`
  - `apps/web/scripts/dev-smoke.ts` still reports an active smoke lock (`pid 73174`, `port 60898`)
- Failed for the same pre-existing reasons: `pnpm test:coverage`
- Direct scenario proof passed: a temp-home `ensureHostedAssistantOperatorDefaults` run via `pnpm exec tsx` produced a `platform-default` hosted assistant profile seeded from `HOSTED_ASSISTANT_PROVIDER=openai` and `HOSTED_ASSISTANT_MODEL=gpt-4.1-mini`, and compiled matching `openai-compatible` assistant defaults using `OPENAI_API_KEY`.
Completed: 2026-04-02
