# Hard-cut Linq webhook secret from hosted execution env

Status: in_progress
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Keep `LINQ_WEBHOOK_SECRET` on the hosted ingress/control-plane boundary only and prevent it from entering any user-executable hosted runtime env while preserving Linq reply, typing, and attachment behavior.

## Success criteria

- Shared hosted env categories and Cloudflare runner env policy no longer classify `LINQ_WEBHOOK_SECRET` as a forwarded runtime variable.
- Hosted runner child env creation strips `LINQ_WEBHOOK_SECRET` even if a caller supplies a stale forwarded env map directly.
- Hosted runtime logging/bootstrap no longer depends on `LINQ_WEBHOOK_SECRET` being present inside the runtime env.
- Focused tests fail closed on any attempt to forward `LINQ_WEBHOOK_SECRET` while preserving the remaining Linq runtime env.
- The fix stays scoped to the Linq secret boundary and does not redesign hosted Linq ingress, worker secret storage, or outbound Linq behavior.

## Scope

- In scope:
- `packages/assistant-runtime/src/{hosted-env-categories.ts,hosted-runtime/environment.ts,hosted-runtime/context.ts}`
- `apps/cloudflare/src/hosted-env-policy.ts`
- focused `apps/cloudflare/test/runner-env.test.ts`
- focused `packages/assistant-runtime/test/hosted-runtime-environment.test.ts` only if needed for the child-env hardening proof
- `agent-docs/exec-plans/active/{2026-04-23-linq-webhook-secret-boundary.md,COORDINATION_LEDGER.md}`
- Out of scope:
- hosted onboarding/control-plane webhook verification in `apps/web`, except for confirming the ingress owner remains unchanged
- broader hosted child-env/operator-secret work already tracked under `2026-04-23-hosted-child-env-boundary.md`
- worker secret deployment wiring beyond confirming `LINQ_WEBHOOK_SECRET` still remains a worker-owned secret

## Constraints

- Technical constraints:
- Preserve `LINQ_API_TOKEN`, `LINQ_API_BASE_URL`, and `LINQ_ATTACHMENT_CDN_BASE_URL` for the hosted runtime because outbound Linq behavior still uses them.
- Treat `LINQ_WEBHOOK_SECRET` as ingress-only secret material; do not move it into user env, resolved config, or a replacement runtime channel capability.
- Keep the runtime-side hardening additive on top of the existing dirty `hosted-runtime/environment.ts` edits.
- Product/process constraints:
- Preserve unrelated dirty-tree work in overlapping runner/runtime files.
- Treat this as a high-risk trust-boundary change: run the full acceptance baseline, add focused proof, and complete the required `coverage-write` plus `task-finish-review` audit passes before handoff.

## Risks and mitigations

1. Risk: removing `LINQ_WEBHOOK_SECRET` from the shared Linq env category could accidentally drop Linq runtime behavior that really needs the API token or base URLs.
   Mitigation: keep the Linq runtime category, remove only the webhook secret, and add regression tests around the forwarded env result.
2. Risk: a direct caller could still pass a stale `forwardedEnv` map containing `LINQ_WEBHOOK_SECRET`.
   Mitigation: add a runtime child-env denylist so the secret is stripped again at the child boundary.
3. Risk: runtime bootstrap logging could become misleading if it still expects the secret inside the runtime env.
   Mitigation: remove the runtime-only log field rather than reporting a meaningless false value.

## Tasks

1. Completed: inspect the Linq secret flow across the shared env categories, Cloudflare runner env policy, hosted child env creation, and hosted/web ingress owners.
2. Completed: register this task in the coordination ledger and create this active plan.
3. Completed: remove `LINQ_WEBHOOK_SECRET` from the forwarded runtime env policy and add runtime-side sanitization so ingress-only secrets are stripped from forwarded env and `userEnv`.
4. Completed: add focused regression coverage for the runner env and runtime env behavior, including the runner-secret allowlist path.
5. Completed: run focused verification, capture the direct env-boundary proof, and complete the required `coverage-write` and `task-finish-review` audit passes.
6. Completed: assess the scoped commit path; no exact scoped commit was possible because overlapping pre-existing edits in shared dirty files would have been absorbed.

## Decisions

- Keep `LINQ_WEBHOOK_SECRET` worker/web-owned only; hosted execution retains the outbound Linq env it actually uses but not the ingress HMAC secret.
- Treat ingress-only secrets and platform-only Telegram vars as denylisted runtime/user env inputs so stale or misrouted env maps fail closed.
- Do not create a scoped commit in this turn because the touched files overlap unrelated in-flight edits in the shared worktree.

## Verification

- Commands to run:
- `pnpm verify:acceptance`
- focused test commands for the touched Cloudflare and assistant-runtime env helper files during iteration as needed
- direct scenario proof showing the effective child/runtime env excludes `LINQ_WEBHOOK_SECRET` while preserving the remaining Linq runtime env keys
- `git diff --check`
- required `coverage-write` and `task-finish-review` audit passes
- Expected outcomes:
- `LINQ_WEBHOOK_SECRET` never crosses into hosted execution env.
- Hosted Linq ingress in `apps/web` still owns webhook verification.
- Hosted runtime still receives the non-ingress Linq env it actually uses.
- Actual results:
- Passed: `pnpm exec vitest run apps/cloudflare/test/runner-env.test.ts --config apps/cloudflare/vitest.config.ts --no-coverage`
- Passed: `pnpm --dir packages/assistant-runtime exec vitest run test/hosted-runtime-environment.test.ts --config vitest.config.ts --no-coverage`
- Passed direct scenario proof: runner env, filtered runner secrets, child env, normalized forwarded env, and normalized `userEnv` all omitted `LINQ_WEBHOOK_SECRET` while preserving the expected non-secret Linq/runtime keys.
- Passed: `git diff --check -- packages/assistant-runtime/src/hosted-env-categories.ts packages/assistant-runtime/src/hosted-assistant-env-constants.ts packages/assistant-runtime/src/hosted-runtime/environment.ts packages/assistant-runtime/src/hosted-runtime/context.ts apps/cloudflare/src/hosted-env-policy.ts apps/cloudflare/test/runner-env.test.ts packages/assistant-runtime/test/hosted-runtime-environment.test.ts agent-docs/exec-plans/active/2026-04-23-linq-webhook-secret-boundary.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- Failed for unrelated pre-existing reasons: `pnpm verify:acceptance`
  - workspace boundary checks: undeclared `@murphai/assistant-engine/*` public-entrypoint imports under `packages/cli/src/commands/inbox.ts` and several `packages/cli/test/*` files
  - workspace typecheck: pre-existing `packages/inbox-services/*` errors around `linqWebhookSecret` and `SupportedDoctorSource`
- Failed for unrelated pre-existing reasons: owner-local typecheck commands
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm --dir packages/assistant-runtime typecheck`
  - both currently fail on broader in-flight `platformEnv` / `forwardedEnv` shape churn in assistant-runtime callers/tests plus the same pre-existing `packages/inbox-services` type errors, not on the Linq webhook secret hard cut itself

## Outcome

- Implemented in the shared worktree with focused proof and both required audit passes complete. The ingress HMAC secret no longer enters hosted execution through forwarded env, child env, or runner-secret `userEnv` paths.

## Audits

- `coverage-write` (`gpt-5.4-mini`): no additional tests required; existing focused coverage already proved the boundary.
- `task-finish-review`: found one remaining medium-severity runner-secret `userEnv` path; fixed by denying ingress-only secrets in the Cloudflare runner-secret filter and extending focused tests/proof.

## Commit note

- No scoped commit was created because `packages/assistant-runtime/src/hosted-runtime/environment.ts`, `apps/cloudflare/test/runner-env.test.ts`, and `agent-docs/exec-plans/active/COORDINATION_LEDGER.md` already contain overlapping unrelated dirty-tree edits, so an exact task-only non-interactive commit would have absorbed work outside this slice.
