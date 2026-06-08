# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Hosted runner destroy timeout triage | `agent-docs/exec-plans/active/2026-06-07-hosted-runner-destroy-timeout.md` | `apps/cloudflare/src/runner-container.ts`, `apps/cloudflare/test/runner-container.test.ts` | `RunnerContainer.destroyIfRunning`, `stopWarmContainer`, `ensureContainerReady` | Active | Narrow hosted-runtime lifecycle fix; avoid exercise-library files. |
| Codex | Hosted runner bundle dependency prune | `agent-docs/exec-plans/active/2026-06-07-runner-bundle-dependency-prune.md` | `apps/cloudflare/scripts/runner-bundle*`, `apps/cloudflare/test/runner-bundle-*`, `apps/cloudflare/DEPLOY.md` | `hostedRunnerWorkspacePackageNames`, `installPackedRunnerDependencies`, `stageHostedRunnerRuntimeArtifact` | Active | Avoid `apps/cloudflare/src/runner-container.ts` and its tests; no exclusive lock. |
| Codex | Hosted Codex image/media E2E | `agent-docs/exec-plans/active/2026-06-07-hosted-codex-image-media-e2e.md` | `packages/hosted-local-harness/src/e2e.ts`, `apps/cloudflare/test/hosted-local-codex-image-media-delivery-e2e.test.ts`, `.github/workflows/cloudflare-hosted-e2e.yml`, `agent-docs/references/testing-ci-map.md`, `agent-docs/operations/verification-and-runtime.md` | `codex-image-media-delivery`, dynamic image/media tool, hosted-local E2E CI | Blocked | Implementation added; focused typechecks/registry test passed. Full hosted E2E/commit blocked by unrelated exercise seed CSV conflict. |
