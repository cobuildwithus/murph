# Install app-local and Codex-profile skills for web and cloudflare

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Install the requested first-party stack skills for the two checked-in app surfaces and make the same skills available globally in each local Codex profile home used by `codex-0` through `codex-5`.

## Success criteria

- `apps/web/skills-lock.json` contains the requested web-stack skills alongside the existing `copywriting` entry.
- `apps/cloudflare/skills-lock.json` is created and contains the requested Cloudflare skills.
- Each local Codex profile home from `codex-0` through `codex-5` has the requested skills installed for Codex.
- Repo verification and a direct listing proof show the expected app-local and global installs without exposing secrets.

## Scope

- In scope:
- App-local skills for `apps/web` and `apps/cloudflare`.
- Global Codex installs for the local profile homes `codex-0` through `codex-5`.
- Repo workflow artifacts required for this task.
- Out of scope:
- Upgrade-only optional skills.
- Root-level repo skill directories or root `skills-lock.json`, which are gitignored here.
- Non-Codex agent installs unless the install mechanism necessarily shares a broader global store.

## Constraints

- Technical constraints:
- Preserve unrelated dirty-worktree edits.
- Keep repo-tracked changes limited to the app lockfiles plus required workflow artifacts.
- Avoid printing or committing secrets or personal identifiers.
- Product/process constraints:
- Follow the repo verification and completion workflow for repo config changes.
- Use `scripts/finish-task` for the final scoped commit because this task has an active plan.

## Risks and mitigations

1. Risk: `skills` CLI behavior may differ between project-local and user-level scope.
   Mitigation: inspect CLI help and verify the resulting lockfiles and profile listings directly.
2. Risk: Existing global installs may already provide some skills or use mixed install roots.
   Mitigation: use explicit profile-scoped listings before and after install, then keep the repo diff limited to lockfiles.
3. Risk: Network fetches for third-party skill sources may fail or partially install.
   Mitigation: run installs in bounded groups, inspect outputs, and retry only the failed sources if needed.

## Tasks

1. Register the coordination ledger row and open this execution plan. Done.
2. Update the app-local lockfiles under `apps/web` and `apps/cloudflare` with the requested skill set. Done.
3. Install the same skills globally for Codex in each local profile home from `codex-0` through `codex-5`. Done.
4. Verify the repo-side lockfiles and global profile listings. Done.
5. Run required checks, required audit review, and finish with a scoped commit. In progress; audit complete, commit pending.

## Decisions

- Use app-local `skills-lock.json` files instead of root-level skill state because the repo ignores root `.agents/`, `/skills/`, and root `skills-lock.json`.
- Keep upgrade-only skills out of the default install set.
- Use explicit `CODEX_HOME`-scoped global install commands for `codex-0` through `codex-5` and verify visibility through each profile's `skills ls -g -a codex` output.
- Accept the `skills` CLI's shared user-level global store resolution as long as each targeted Codex profile can list the requested skills afterward.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Direct `npx skills ls --json` checks in each app and each Codex profile
- Expected outcomes:
- Repo checks pass, or any unrelated pre-existing failure is documented.
- App-local listings match the requested stack-aligned skills.
- Each Codex profile lists the requested global skills for Codex.
- Outcomes:
- `apps/web` and `apps/cloudflare` both list the requested project-local skills after install.
- `codex-0` through `codex-5` each list the requested global skills through `npx skills ls -g -a codex --json`.
- Project-local proof summary:
- `apps/web`: `copywriting`, `next-best-practices`, `prisma-cli`, `prisma-client-api`, `prisma-database-setup`, `privy`, `stripe-best-practices`, `vercel-cli`, `vercel-react-best-practices`
- `apps/cloudflare`: `cloudflare`, `durable-objects`, `wrangler`
- Global proof summary for each of `codex-0` through `codex-5`: `next-best-practices`, `vercel-react-best-practices`, `vercel-cli`, `prisma-cli`, `prisma-client-api`, `prisma-database-setup`, `privy`, `stripe-best-practices`, `cloudflare`, `wrangler`, `durable-objects`
- `pnpm typecheck` failed in `packages/cli/test/assistant-harness.test.ts` on missing `zod` and `ai` module declarations, outside this diff.
- `pnpm test` failed in `apps/web verify`; the surfaced failures are in `apps/web/test/hosted-share-service.test.ts` plus the hosted web `dev:smoke` lane, outside this diff.
- `pnpm test:coverage` failed in existing app/package lanes, including `packages/contracts` script typecheck issues and the same hosted-web verify failures, outside this diff.
- Required `task-finish-review` audit returned no findings on the scoped diff; residual risk is limited to the unrelated pre-existing red verification lanes and the external stability of the referenced skill sources.
Completed: 2026-04-01
