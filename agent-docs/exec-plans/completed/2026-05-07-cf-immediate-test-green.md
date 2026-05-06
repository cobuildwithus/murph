Goal (incl. success criteria):
- Ensure the checked-in `pnpm cf:deploy:immediate` test path is locally green where it can be exercised without production credentials.
- Success means classifying any failures, fixing only stale assertions or mechanical harness issues, discussing behavior/deploy failures before changes, and recording exact verification evidence.

Constraints/Assumptions:
- Preserve unrelated dirty worktree edits and active plan rows.
- Do not expose user identifiers, secrets, raw credentials, home paths, or local usernames in logs, docs, commits, or handoff.
- `cf:deploy:immediate` skips predeploy hosted-local E2E gates but still runs the deploy job's Cloudflare verify and runner smoke checks.
- Production Cloudflare deploy, secret sync, and public smoke cannot be fully proven locally without operator credentials and GitHub environment wiring.

Key decisions:
- Treat stale assertion failures as fixable in-turn.
- Pause for discussion before changing behavior, deploy semantics, auth/secrets, runtime state, or architectural boundaries.

State:
- Local deploy-job verification is green where it can be exercised without production GitHub/Cloudflare credentials.
- `pnpm cf:deploy:immediate` dispatches `.github/workflows/deploy-cloudflare-hosted.yml` against `main` with `container_rollout=immediate` and `skip_predeploy_e2e=true`; it was not run locally because it starts the production workflow.
- Production-only Cloudflare deploy, secret sync, and public smoke remain unproven locally.

Done:
- Read repo workflow, verification, Cloudflare deploy docs, and deploy workflow.
- Identified the immediate deploy workflow's in-job test surface.
- Disabled file-level parallelism only for the Cloudflare Node platform bucket after the container-entrypoint tests proved file-order/resource sensitive under the app verify lane.
- Kept the hosted Codex shell env smoke focused on environment resolution by recording the `murph` path byte count instead of launching nested `murph --help`; direct container smoke still runs `murph --help`.
- Fixed a log-guard false positive in hosted Codex snapshot failure logging by destructuring the metadata field before logging.
- Ran Cloudflare verify, runner Docker smoke, hosted Codex auth guard with pinned `@openai/codex@0.125.0`, and diff-targeted repo verification successfully.

Now:
- Ready to hand off with local verification evidence.

Next:
- Production workflow dispatch still needs GitHub/Cloudflare credentials and environment wiring.

Open questions (UNCONFIRMED if needed):
- Whether production-only `wrangler deploy`/smoke checks are currently green in GitHub Actions after local checks pass.

Working set (files/ids/commands):
- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/cloudflare/**`
- `pnpm --dir apps/cloudflare verify:parallel`
- `pnpm --dir apps/cloudflare runner:docker:smoke`
- `MURPH_RUN_HOSTED_CODEX_AUTH_E2E=1 pnpm --dir packages/assistant-runtime exec vitest run --config vitest.config.ts --no-coverage test/hosted-runtime-codex-config.test.ts`
- `bash scripts/workspace-verify.sh test:diff ...`
Status: completed
Updated: 2026-05-07
Completed: 2026-05-07
