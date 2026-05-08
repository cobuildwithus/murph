# Cloudflare Immediate Blacksmith Build Handoff

Status: completed
Updated: 2026-05-09

## Goal

Reduce `pnpm cf:deploy:immediate` wall clock by moving explicit break-glass no-secret build prep back to protected-main Blacksmith runners.

Success criteria:

- Immediate Worker deploys run Blacksmith build-prep even when the normal predeploy E2E gates are skipped.
- The build-prep job does not attach the production environment or read production secrets.
- The immediate deploy job consumes build artifacts from the Blacksmith build-prep job, validates them before secret-bearing deploy preflight, then renders/validates secrets/config and runs Wrangler deploy/smoke on GitHub-hosted Ubuntu.
- Normal non-immediate deploys keep the deploy job on GitHub-hosted Ubuntu.
- Workflow-shape tests and deploy docs describe the Blacksmith no-secret artifact-integrity trust boundary.

## Constraints

- Preserve unrelated active worktree edits and active ledger rows.
- Do not expose secrets, local account names, home paths, or direct personal identifiers in workflow output, docs, tests, or commits.
- Keep Blacksmith jobs free of production secrets; the immediate handoff may trust Blacksmith only for protected-main no-secret artifact integrity.
- Keep the normal non-immediate `cf:deploy` gate shape intact.

## Scope

- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/cloudflare/test/deploy-automation.test.ts`
- `apps/cloudflare/DEPLOY.md`
- `agent-docs/SECURITY.md`
- `agent-docs/references/testing-ci-map.md`
- `agent-docs/operations/verification-and-runtime.md`

## Verification Plan

- Focused deploy automation Vitest.
- Cloudflare app typecheck if practical.
- `git diff --check` on touched files.
- Required security/privacy and final review audits for deploy-surface workflow changes.

## State

- Implementation and focused verification complete; scoped workspace verification is blocked by unrelated dirty assistant-engine TypeScript errors.

## Done

- Read required routing, verification, completion, security, reliability, deploy, and CI docs.
- Inspected current immediate path and confirmed it currently runs only the GitHub-hosted `deploy` job.
- Added an immediate-only Blacksmith build-prep job with a runner-bundle/base-image artifact handoff.
- Kept immediate production env/secrets, Wrangler dry-run/deploy, and deployed smoke on the GitHub-hosted deploy job.
- Added a runner-bundle manifest refresh script for downloaded immediate handoffs.
- Updated workflow-shape tests and deploy docs.
- Switched runner-bundle handoff to a tarball so artifact download preserves executable file modes.
- Added deploy-artifact coverage for refreshing a downloaded bundle manifest after env-specific config render.
- Addressed security review findings by documenting the intentional Blacksmith production artifact-integrity trust expansion and removing absolute path logging from the manifest refresh script.
- Kept all secret-bearing deploy/smoke jobs on GitHub-hosted Ubuntu.
- Hardened immediate runner-bundle restore to reject unsupported archive entry types and symlink targets that escape the restored bundle root.
- PASS: focused Cloudflare deploy/container/deploy-artifact Vitest.
- PASS: `pnpm --dir apps/cloudflare typecheck`.
- BLOCKED: scoped `bash scripts/workspace-verify.sh test:diff ...` on the current task working set now fails in unrelated dirty `packages/assistant-engine/src/assistant/automation/reply.ts` TypeScript errors.
- PASS: `git diff --check` on the working set.
- PASS: privacy identifier scan on the working set.
- 2026-05-09 security correction: immediate handoff manifest validation now runs directly after artifact restore and before secret-bearing deploy preflight.

## Now

- Plan archived; scoped commit is blocked by unrelated overlapping dirty work in this checkout.

## Next

- Close plan and hand off final status.

## Open questions

- None.

## Working set

- `.github/workflows/deploy-cloudflare-hosted.yml`
- `apps/cloudflare/test/deploy-automation.test.ts`
- `apps/cloudflare/test/container-image-contract.test.ts`
- `apps/cloudflare/test/deploy-artifacts.test.ts`
- `apps/cloudflare/package.json`
- `apps/cloudflare/scripts/refresh-runner-bundle-manifest.ts`
- `apps/cloudflare/scripts/validate-runner-bundle-manifest.ts`
- `apps/cloudflare/DEPLOY.md`
- `agent-docs/references/testing-ci-map.md`
- `agent-docs/operations/verification-and-runtime.md`
Completed: 2026-05-09
