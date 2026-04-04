# Wire current hosted Cloudflare env names through GitHub deploy

Status: completed
Created: 2026-04-05
Updated: 2026-04-05

## Goal

- Bring the checked-in Cloudflare deploy workflow and render helpers up to the current hosted runtime env contract.
- Ensure the next GitHub-driven Cloudflare deploy can render the required Worker secrets and vars that current HEAD expects.

## Success criteria

- The GitHub deploy workflow passes the required automation recipient JWK secrets into the Cloudflare deploy scripts.
- The generated Worker config and secrets payload can emit the canonical current env names needed by the worker runtime, especially `HOSTED_EXECUTION_INTERNAL_TOKENS`.
- Focused tests cover the updated env wiring so drift between workflow inputs and deploy rendering is less likely to recur.
- Final handoff clearly separates Cloudflare/GitHub requirements from the still-separate Vercel/web env requirements.

## Scope

- In scope:
- Update `.github/workflows/deploy-cloudflare-hosted.yml` env pass-through for current worker-required vars/secrets.
- Update `apps/cloudflare/src/deploy-automation.ts` env allowlists for current worker config rendering.
- Add or update focused tests under `apps/cloudflare/test/deploy-automation.test.ts`.
- Out of scope:
- Directly mutating GitHub, Cloudflare, or Vercel project env values.
- Changing unrelated hosted web/Vercel env handling beyond clarifying the final required list.
- Reworking hosted assistant provider selection behavior unless a narrow deploy-wiring fix requires it.

## Constraints

- Technical constraints:
- Preserve unrelated dirty-tree work, especially other active Cloudflare and assistant lanes.
- Keep the change narrow to deploy wiring; do not silently fold in broader runtime policy changes.
- Product/process constraints:
- Follow the repo high-risk workflow: coordination ledger, focused verification plus repo-required checks, mandatory final audit subagent, then scoped commit via `scripts/finish-task`.

## Risks and mitigations

1. Risk: Passing the wrong env names through the workflow can make the next deploy fail only at render or smoke time.
   Mitigation: Update focused deploy-automation tests alongside the workflow and render helper changes.
2. Risk: Mixing worker-only envs with web/Vercel-only envs will create false confidence about what GitHub deploy actually provisions.
   Mitigation: Keep code changes limited to worker-consumed envs and call out the remaining web/Vercel set explicitly in handoff.
3. Risk: The repo already has unrelated red verification in flight.
   Mitigation: Run the highest-signal focused app checks plus repo-required commands, then document any pre-existing blockers separately from this diff.

## Tasks

1. Register the lane and confirm the current deploy/render code paths that still reference stale env names.
2. Patch the Cloudflare deploy workflow and render helper for the current worker env contract.
3. Extend focused deploy-automation tests to cover the new env names.
4. Run verification, complete the mandatory audit pass, close the plan, and commit only the touched paths.

## Decisions

- Treat `HOSTED_EXECUTION_INTERNAL_TOKENS` as the canonical worker-side internal web control env name for deploy rendering.
- Keep Vercel/web-only env migrations out of the code change; those remain part of the final env checklist discussion rather than the GitHub deploy patch.

## Verification

- Commands to run:
- `pnpm --dir apps/cloudflare test -- --run test/deploy-automation.test.ts`
- `pnpm --dir apps/cloudflare verify`
- `pnpm typecheck`
- `pnpm test`
- Expected outcomes:
- Focused deploy-automation coverage proves the new env wiring, `apps/cloudflare verify` passes if the app-local lane is healthy, and any repo-wide failures are clearly identified as pre-existing if they persist outside this narrow deploy diff.
Completed: 2026-04-05
