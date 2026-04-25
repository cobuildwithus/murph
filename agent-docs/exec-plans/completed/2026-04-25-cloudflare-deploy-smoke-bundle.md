Goal (incl. success criteria):
- Shorten `pnpm cf:deploy` by removing duplicated production runner-bundle assembly while preserving production deploy validation and Docker runner smoke coverage.
- Success means the workflow deploys from one production `deploy:artifacts` render, Docker smoke uses an isolated smoke bundle, and deploy validation still rejects smoke-mutated production bundles.

Constraints/Assumptions:
- Preserve unrelated dirty work in the shared checkout.
- Do not weaken production deploy validation, runner-bundle fingerprint checks, or post-deploy endpoint/container smoke.
- Treat `.deploy/runner-bundle` as the production artifact; smoke-only files must not be written there.

Key decisions:
- Keep focused checks, Docker smoke, and post-deploy smoke for now; remove only the duplicate artifact build caused by smoke mutating the production bundle.
- Pin the smoke app image build to `linux/amd64` to match the prepared base image platform.

State:
- Implementation and reviews complete; ready to close with scoped commit.

Done:
- Measured the previous run: duplicate `deploy:artifacts` cost was about 4m16s and Docker smoke cost was about 3m40s.
- Identified `runner:docker:smoke:prepare` as the source of the production bundle mutation.
- Focused Cloudflare Node suite and app typecheck passed after the smoke-bundle refactor.
- Local Docker smoke image imports proved the isolated smoke bundle keeps runtime package symlinks importable.
- Scoped `test:diff` passed for the touched Cloudflare files.
- Required security/privacy, coverage-write, and final-review passes completed with no requested changes.

Now:
- Close the plan and create the scoped commit.

Next:
- Optionally run live `pnpm cf:deploy` after the commit if full production workflow timing proof is needed.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: exact wall-clock saving after CI cache behavior; expected saving is at least the removed second artifact build.
- UNCONFIRMED: full local Docker smoke remains red on Apple Silicon QEMU because `whisper.cpp` does not produce a transcript; CI amd64 previously passed the same native parser smoke.

Working set (files/ids/commands):
- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/cloudflare/package.json`
- `apps/cloudflare/.dockerignore`
- `apps/cloudflare/scripts/sync-smoke-runner-bundle.ts`
- `apps/cloudflare/scripts/runner-docker-smoke.ts`
- `Dockerfile.cloudflare-hosted-runner-smoke`
- `apps/cloudflare/test/**`
- `apps/cloudflare/DEPLOY.md`
Status: completed
Updated: 2026-04-25
Completed: 2026-04-25
