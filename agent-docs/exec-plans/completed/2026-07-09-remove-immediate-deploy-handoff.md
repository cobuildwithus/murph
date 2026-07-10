# Remove Immediate Deploy Artifact Handoff

Status: completed
Updated: 2026-07-09

## Goal

Remove the obsolete cross-job runner bundle and Docker image artifact handoff
from `pnpm cf:deploy:immediate` while preserving the command's break-glass
behavior, deploy validation, immediate container rollout, and production smoke
checks.

## Why

The handoff was introduced when build prep ran on Blacksmith but the production
deploy ran elsewhere. The production deploy now also runs on protected-main
Blacksmith, so serializing and downloading the full native runner image adds a
large, failure-prone transfer without preserving a distinct trust boundary.
Recent normal deploys did not exercise the handoff, and the first recent
break-glass run stalled while downloading its roughly 548 MB artifact.

## Scope

- Delete the immediate-only build-prep job and archive upload/download steps.
- Route skip-E2E deploys through the existing in-job runner build path.
- Keep the hosted Codex auth guard, Wrangler dry run, deployment, and deployed
  smoke checks.
- Delete manifest wrapper scripts used only to refresh or validate the handoff.
- Update focused workflow contracts and durable deploy documentation.

## Invariants

- Deploys still require a protected-main hosted Codex auth guard.
- Normal deploys still require all predeploy E2E and runner smoke gates.
- `cf:deploy:immediate` skips only the slow predeploy E2E gates and still builds
  from the checked-out protected-main commit in the production deploy job.
- Production secrets remain scoped to validation, render, deploy, and smoke
  steps; build steps do not receive secret values.
- Immediate deploys still force immediate container rollout and run direct R2
  plus live-model smoke checks.

## Verification

- Focused Cloudflare deploy automation and container image contract tests.
- Cloudflare typecheck and repository-required verification.
- Direct workflow inspection proving no saved Docker image or artifact handoff
  remains and the immediate command still selects the skip-E2E immediate lane.
- Required security/privacy and coverage-write audits, parent final review,
  ReviewGPT, and GitHub CI.

## State

- Done: Root cause, history, recent usage, and current trust boundary traced.
- Done: Obsolete handoff and handoff-only wrappers deleted; workflow contracts
  and durable deployment docs updated.
- Done: Focused workflow tests, Cloudflare typecheck, isolated Cloudflare verify,
  YAML parsing, and diff checks passed. Repo-wide acceptance was attempted but
  encountered unrelated concurrent-worktree timeout and generated-artifact
  races; the affected Cloudflare owner lane passed in isolation.
- Done: Security/privacy and coverage-write audits found no unresolved findings;
  parent final review confirmed the deployment and trust-boundary invariants.
- Now: Commit the verified cleanup and rebase it onto current `main`.
- Next: Open a PR and complete ReviewGPT plus GitHub CI.
Completed: 2026-07-09
