# Fix Cloudflare rollout deploy artifact path resolution

Status: completed
Created: 2026-04-01
Updated: 2026-04-01

## Goal

- Restore Cloudflare hosted rollouts so `deploy:rollout` reads the rendered artifacts under `apps/cloudflare/.deploy/` even when the package script is launched from the repo root via `pnpm --dir apps/cloudflare ...`.

## Success criteria

- `deploy-worker-version.ts` resolves default config/result/secrets paths to the canonical `apps/cloudflare/.deploy/` location instead of repo-root `/.deploy/`.
- A focused proof covers the repo-root launch mode that failed in GitHub Actions.
- Required verification for the touched `apps/cloudflare` surface passes.

## Scope

- In scope:
- Narrow fix to rollout path resolution, plus matching proof/docs updates needed to keep operator instructions truthful.
- Out of scope:
- Broader deploy automation redesign, new Cloudflare config semantics, or unrelated hosted runtime changes.

## Constraints

- Technical constraints:
- Preserve existing rollout behavior apart from how artifact paths are resolved.
- Product/process constraints:
- Treat this as a deploy-surface change: keep the diff narrow, run required checks, and complete the required review pass before commit.

## Risks and mitigations

1. Risk: Fixing only the workflow would leave the package script and docs still wrong for local operator use.
   Mitigation: Patch the rollout script defaults and relative-argument resolution at the script layer, then retain the workflow command shape unless a callsite change is still needed.

## Tasks

1. Patch rollout path resolution so repo-root launches target `apps/cloudflare/.deploy`.
2. Add direct proof for the path-resolution behavior that failed in Actions.
3. Run required verification for the touched Cloudflare app surface.
4. Run the required final review and create a scoped commit.

## Decisions

- Fix the script layer rather than just the workflow callsite, because the same bug affects documented local invocations that pass `--config ./.deploy/wrangler.generated.jsonc`.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused proof covering `deploy:rollout` path resolution from the repo-root launch mode
- Expected outcomes:
- Repo-required verification passes.
- Focused proof shows rollout uses `apps/cloudflare/.deploy/*` instead of repo-root `/.deploy/*`.

## Outcome snapshot

- Added a rollout-path helper so `deploy-worker-version.ts` resolves default and explicit artifact paths from the Cloudflare app root instead of the repo root.
- Added focused regression coverage for the repo-root launch mode and the explicit `--config ./.deploy/...` / `--secrets-file ./.deploy/...` forms.
- Verification completed:
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/deploy-worker-version-paths.test.ts --no-coverage` passed.
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/deploy-worker-version-cli.test.ts apps/cloudflare/test/deploy-worker-version-paths.test.ts --no-coverage` passed.
  - `pnpm typecheck` passed.
  - `pnpm --dir apps/cloudflare verify` passed after the audit follow-up.
  - `pnpm test` passed before the audit follow-up, then failed on a later rerun because of unrelated active-worktree failures in `packages/cli/test/assistant-service.test.ts`, `packages/cli/test/setup-cli.test.ts`, `packages/core/test/profile.test.ts`, and `packages/inboxd/test/inboxd.test.ts`.
  - `pnpm test:coverage` passed before the audit follow-up.
  - Direct proof showed the rollout command shape now resolves config, secrets, and result paths under `apps/cloudflare/.deploy/`.
- Required final review pass completed; follow-up findings were addressed.
- Task closed and scoped commit created.
Completed: 2026-04-01
