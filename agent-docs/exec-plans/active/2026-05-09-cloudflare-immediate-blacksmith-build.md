# Cloudflare Immediate Blacksmith Build Handoff

Status: active
Updated: 2026-05-09

## Goal

Reduce `pnpm cf:deploy:immediate` wall clock by moving the explicit break-glass deploy workflow back to protected-main Blacksmith runners.

Success criteria:

- Immediate Worker deploys run Blacksmith build-prep even when the normal predeploy E2E gates are skipped.
- The build-prep job does not attach the production environment or read production secrets.
- The immediate deploy job consumes build artifacts from the Blacksmith build-prep job, then renders/validates secrets/config and runs Wrangler deploy/smoke on Blacksmith only for the explicit protected-main break-glass input shape.
- Normal non-immediate deploys keep the deploy job on GitHub-hosted Ubuntu.
- Workflow-shape tests and deploy docs describe the Blacksmith production-secret trust boundary.

## Constraints

- Preserve unrelated active worktree edits and active ledger rows.
- Do not expose secrets, local account names, home paths, or direct personal identifiers in workflow output, docs, tests, or commits.
- Keep the Blacksmith build-prep handoff free of production secrets; the immediate deploy job may trust Blacksmith for production secrets only for the protected-main break-glass input shape.
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

- Implementation and focused verification complete.

## Done

- Read required routing, verification, completion, security, reliability, deploy, and CI docs.
- Inspected current immediate path and confirmed it currently runs only the GitHub-hosted `deploy` job.
- Added an immediate-only Blacksmith build-prep job with a runner-bundle/base-image artifact handoff.
- Moved immediate production env/secrets, Wrangler dry-run/deploy, and deployed smoke onto Blacksmith only for the explicit protected-main break-glass input shape.
- Added a runner-bundle manifest refresh script for downloaded immediate handoffs.
- Updated workflow-shape tests and deploy docs.
- Switched runner-bundle handoff to a tarball so artifact download preserves executable file modes.
- Added deploy-artifact coverage for refreshing a downloaded bundle manifest after env-specific config render.
- Addressed security review findings by documenting the intentional Blacksmith production artifact-integrity trust expansion and removing absolute path logging from the manifest refresh script.
- Kept normal non-immediate secret-bearing deploy/smoke jobs on GitHub-hosted Ubuntu.
- Hardened immediate runner-bundle restore to reject unsupported archive entry types and symlink targets that escape the restored bundle root.
- PASS: focused Cloudflare deploy/container/deploy-artifact Vitest.
- PASS: `pnpm --dir apps/cloudflare typecheck`.
- FAIL unrelated: scoped `bash scripts/workspace-verify.sh test:diff ...` reached `apps/cloudflare verify` and failed in active unrelated Cloudflare tests: `apps/cloudflare/test/container-entrypoint.test.ts` timed out in the health metadata test, and `apps/cloudflare/test/user-runner-alarm.test.ts` expected two cleanup calls but saw three.
- PASS: `git diff --check` on the working set.
- PASS: privacy identifier scan on the working set.
- 2026-05-09 security correction: immediate handoff manifest validation now runs before manifest refresh, so stale source or bundle fingerprints fail before the secret-bearing deploy job blesses downloaded Blacksmith artifacts.

## Now

- Rerun focused verification after the manifest provenance fix.

## Next

- Complete required audits and scoped closeout.

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
