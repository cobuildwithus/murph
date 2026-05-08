# Cloudflare Smoke Blacksmith Gate

Status: completed
Updated: 2026-05-09

## Goal

Move the expensive Cloudflare focused checks plus runner Docker smoke out of the production deploy job and into a no-production-secrets Blacksmith predeploy gate, while keeping the actual deploy and production secret handling on GitHub-hosted Ubuntu.

## Success criteria

- Blacksmith runs the focused Cloudflare verify lane and runner Docker smoke before deploy.
- The deploy job keeps production environment/secrets and still performs config render, worker-secret render, Wrangler dry run, deploy, and deployed smoke.
- Workflow-shape tests pin the trust-boundary split.
- Docs describe the current split without implying the deploy job itself runs on Blacksmith.

## Constraints

- Keep the architecture simple: one additional gate job, no generated workflow, no cross-job artifact handoff.
- Do not expose secrets, local paths, or personal identifiers in workflow output, docs, tests, or commit text.
- Preserve unrelated active worktree edits.

## Key decisions

- The Blacksmith gate rebuilds/validates from the same commit instead of sharing artifacts with the deploy job; the deploy job keeps manifest and Wrangler validation for the production-rendered artifacts.
- `skip_predeploy_e2e=true` skips this gate along with the other predeploy gates for the explicit break-glass deploy path.
- Blacksmith predeploy gates are protected-main-only. The deploy job still repeats trusted-ref validation before attaching production deploy behavior.
- Render-only runs skip the runner smoke gate and keep the lighter deploy-job focused-check path.

## State

- Implementation and focused verification complete.
- Broader verification is blocked by unrelated active dirty work outside this task.

## Done

- Read workflow, deploy docs, and current workflow-shape tests.
- Added `cloudflare-runner-smoke-gate` on Blacksmith for Worker deploy runs only.
- Kept production deploy job on GitHub-hosted Ubuntu with production environment/secrets.
- Added workflow-shape tests for the gate, deploy dependency condition, no `environment:`/`secrets:` inside the gate, and Blacksmith/Ubuntu runner counts.
- Updated deploy docs and CI map.
- Addressed security review finding by requiring protected `main` on Blacksmith predeploy jobs.
- Addressed final review finding by preserving render-only behavior.

## Now

- Ready to close plan if scoped commit is safe.

## Next

- Close plan and commit scoped changes if safe.

## Open questions

- None.

## Working set

- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/cloudflare/test/deploy-automation.test.ts`
- `apps/cloudflare/DEPLOY.md`
- `agent-docs/references/testing-ci-map.md`
- PASS: `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts --no-coverage test/deploy-automation.test.ts`
- PASS: `git diff --check -- .github/workflows/deploy-cloudflare-hosted.yml apps/cloudflare/test/deploy-automation.test.ts apps/cloudflare/DEPLOY.md agent-docs/references/testing-ci-map.md agent-docs/exec-plans/active/2026-05-09-cloudflare-smoke-blacksmith-gate.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
- PASS before unrelated dirty work shifted: `pnpm --dir apps/cloudflare typecheck`
- FAIL unrelated: `pnpm typecheck` fails in active dirty assistant-runtime hosted-runtime work.
- FAIL unrelated: `pnpm test:diff .github/workflows/deploy-cloudflare-hosted.yml apps/cloudflare/test/deploy-automation.test.ts apps/cloudflare/DEPLOY.md agent-docs/references/testing-ci-map.md` fails in active dirty Cloudflare runtime-bridge checkpoint tests.
Completed: 2026-05-09
