# Cloudflare Native Container Hard Cutover

Status: completed
Created: 2026-03-27
Updated: 2026-03-27

## Goal

Replace the hosted execution lane's external runner-service architecture with a native Cloudflare Durable Object + Container execution path and remove the standalone runner fallback from the repo-owned runtime, deploy, and doc surfaces.

## Success criteria

- `apps/cloudflare` runs hosted work through the per-user Durable Object's native container only.
- The worker no longer depends on `HOSTED_EXECUTION_RUNNER_BASE_URL`, GHCR image publication, or any repo-supported standalone runner process.
- The hosted execution bundle contract, encrypted per-user env overrides, assistant outbox durability, and next-wake scheduling still work.
- Deploy automation and docs describe one Worker deploy that builds the container image via Wrangler instead of a second runner service rollout.
- Focused `apps/cloudflare` verification is green, then repo-required checks and completion-workflow audits are run.

## Scope

- `apps/cloudflare/{src/**,test/**,README.md,DEPLOY.md,package.json,wrangler.jsonc,.dev.vars.example}`
- `packages/runtime-state/src/hosted-execution.ts`
- root Cloudflare deploy/docs touch points
- Cloudflare deploy automation/workflow files that still assume a separate runner host

## Constraints

- Preserve the encrypted `vault` + `agent-state` hosted bundle model.
- Preserve existing control routes for signed dispatch and operator env management.
- Keep the private commit/finalize/outbox callback flow until a future follow-up replaces it with a different durable handoff.
- Keep the container bridge process private to the image; do not keep a repo-supported external fallback service or local standalone command surface.
- Do not claim stronger side-effect guarantees than the current hosted outbox/journal path actually provides.

## Verification

- Focused: `pnpm --dir apps/cloudflare test`
- Required repo checks: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Completion workflow audits: `simplify`, `test-coverage-audit`, `task-finish-review`

## Outcome

- Native Durable Object + Container execution is now the only repo-supported hosted execution path in `apps/cloudflare`.
- The repo-supported standalone/local runner surface, separate runner-env rendering, and GHCR-based runner rollout assumptions were removed.
- Focused Cloudflare verification passed after tightening native-container and finalize-route coverage.
- Repo-wide checks remain blocked by unrelated active `apps/web` RevNet type errors (`viem` missing and `Invoice.payment_intent` typing mismatch).
