# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Plan | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Codex | Default hosted deploys to full runner env profiles and patch live worker | `agent-docs/exec-plans/active/2026-04-13-cloudflare-runner-env-profiles.md` | `.github/workflows/deploy-cloudflare-hosted.yml`, `apps/cloudflare/{DEPLOY.md,README.md,scripts/deploy-automation/environment.ts,test/deploy-automation.test.ts}` | `readHostedDeployAutomationEnvironment`, deploy workflow env wiring | in_progress | Keep this to deploy/config/docs/test surfaces plus a live Wrangler-backed worker update; do not touch the active onboarding or launcher lanes. |
