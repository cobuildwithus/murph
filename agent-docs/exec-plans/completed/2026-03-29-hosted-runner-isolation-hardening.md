# Harden Hosted Runner Job Isolation

Status: completed
Created: 2026-03-29
Updated: 2026-03-29

## Goal

- Close the remaining low-friction hosted runner exfiltration and malformed-input footguns that can land safely without widening into the larger hosted automation architecture cutover.

## Success criteria

- Runner web-control base URLs fail closed unless their hosts match the shared hosted web base host or an explicit allowlist.
- Hosted onboarding public-base normalization uses the same strict hosted-execution URL rules as the hosted control plane.
- Public malformed-input responses use stable strings instead of echoing raw parser/type details.
- The runner container no longer receives `AGENTMAIL_API_KEY`.
- Focused regressions cover the new allowlist, normalization, env-filtering, and error-sanitization behavior.

## Scope

- In scope:
- `apps/cloudflare/src/{runner-outbound.ts,runner-env.ts,index.ts,container-entrypoint.ts,deploy-automation.ts,worker-contracts.ts}`
- `apps/web/src/lib/{http.ts,hosted-onboarding/env.ts}`
- Focused tests under `apps/cloudflare/test/**` and `apps/web/test/**`
- Minimal app-local runtime docs for the new allowlist knob
- Out of scope:
- The broader hosted assistant automation/provider split, direct-CLI removal, read-only hosted automation defaults, and delivery privilege redesign
- Per-job capability-based runner secret partitioning beyond removing the clearly unused AgentMail API key

## Constraints

- Technical constraints:
- Preserve overlapping hosted-runtime/web work already in flight.
- Follow the current `HOSTED_WEB_BASE_URL` shared-base naming already landing in the hosted control-plane cleanup lane, while tolerating the older hosted onboarding public-base env as an allowlist fallback inside the Cloudflare worker boundary.
- Product/process constraints:
- Preserve adjacent dirty work and commit only this lane's exact touched files.
- Repo policy requires spawned audit subagents, but that tooling is unavailable in this environment and must be called out explicitly.

## Risks and mitigations

1. Risk: Overlapping hosted-runtime and Cloudflare lanes are already editing the same area.
   Mitigation: Keep the patch narrow to allowlisting, normalization, public error strings, and one least-privilege env reduction.
2. Risk: Tightening host routing could break deployments that use a distinct hosted-web host.
   Mitigation: Add the explicit `HOSTED_EXECUTION_ALLOWED_WEB_CONTROL_HOSTS` override and document it in app-local runtime docs.
3. Risk: Stable public malformed-input messages could mask debugging details.
   Mitigation: Keep the real errors in server logs and preserve focused regression coverage around the public response shapes.

## Tasks

1. Register the lane in the coordination ledger and inspect overlapping hosted runtime files.
2. Add explicit runner web-control host allowlisting and deploy/runtime plumbing.
3. Switch hosted onboarding public-base normalization to the shared strict normalizer.
4. Sanitize public malformed-input responses in the hosted web and Cloudflare worker/container boundaries.
5. Remove `AGENTMAIL_API_KEY` from forwarded runner env, add regressions, run focused verification, then run the required repo wrappers and record unrelated blockers.

## Decisions

- Keep the high-severity architectural hosted automation cutover out of this pass because the necessary CLI/provider changes overlap active session/provider refactors and need a dedicated design lane.
- Treat runner env tightening as a least-privilege reduction, not a full per-job capability matrix, in this pass.
- Use `HOSTED_WEB_BASE_URL` as the canonical shared hosted-web base and accept `HOSTED_ONBOARDING_PUBLIC_BASE_URL` only as an allowlist fallback inside `apps/cloudflare/src/runner-outbound.ts`.

## Verification

- Focused commands that passed:
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1 apps/cloudflare/test/runner-outbound.test.ts apps/cloudflare/test/runner-env.test.ts apps/cloudflare/test/container-entrypoint.test.ts apps/cloudflare/test/deploy-automation.test.ts`
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.config.ts --no-coverage --maxWorkers 1 apps/cloudflare/test/index.test.ts -t "stable invalid"`
- `pnpm --dir ../.. exec vitest run --config apps/web/vitest.config.ts --no-coverage --maxWorkers 1 apps/web/test/device-sync-http.test.ts apps/web/test/hosted-onboarding-env.test.ts`
- Required repo-wide commands attempted:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Unrelated blockers observed in all three repo-wide wrappers:
- `packages/hosted-execution/src/web-control-plane.ts:129`
- `packages/hosted-execution/src/web-control-plane.ts:190`
- `packages/hosted-execution/src/web-control-plane.ts:251`
- `packages/hosted-execution/src/web-control-plane.ts:379`
- Shared failure shape: nullable `baseUrl` arguments no longer satisfy the helper signature and one callback parameter is implicitly `any`.
- Completion-workflow audit note:
- Mandatory spawned audit subagents could not be run because spawned-agent tooling is unavailable in this environment.
Completed: 2026-03-29
