# PR 613 lifecycle rollback floor

Status: completed
Created: 2026-07-14
Updated: 2026-07-14

## Goal

- Prevent a Worker code rollback from lowering the automatic meal-photo R2 retention policy below the 31-day mailbox recovery window.

## Success criteria

- Ordinary Worker deploys and Cloudflare version rollbacks do not mutate R2 lifecycle policy.
- The explicit forward lifecycle command remains available for applying the checked-in policy before producer activation.
- Deployment documentation states the storage-policy rollback floor and the resource-preserving Wrangler rollback path.
- Focused deploy-orchestration tests, Cloudflare typecheck, PR CI, and ReviewGPT pass.

## Scope

- In scope: Cloudflare deploy orchestration, its focused tests, and deployment/runtime documentation.
- Out of scope: new storage-policy services, runtime state, queues, or changes to meal-photo ingestion behavior.

## Constraints

- Technical constraints: preserve the explicit `r2:lifecycle:apply` command; use Cloudflare version rollback so connected R2 resources remain unchanged.
- Product/process constraints: keep the 31-day lifecycle as a monotonic rollback floor while retained meal-photo mailbox work can exist.

## Risks and mitigations

1. Risk: a forward release forgets to apply the required lifecycle policy.
   Mitigation: document and test the explicit pre-producer storage-policy step separately from code deploy and rollback.

## Tasks

1. Remove lifecycle mutation from the rollback-capable direct Worker deploy path.
2. Update focused deploy tests to prove direct deploy does not invoke lifecycle mutation.
3. Update durable deployment/runtime docs with the explicit forward step and resource-preserving rollback command.
4. Run scoped verification, commit, push, and rerun ReviewGPT plus CI.

## Decisions

- Use Cloudflare's native Worker version rollback, which leaves connected resources unchanged, rather than building a lifecycle-policy manager.

## Verification

- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/deploy-worker-version-cli.test.ts`
- `pnpm exec vitest run --config apps/cloudflare/vitest.config.ts apps/cloudflare/test/r2-lifecycle.test.ts`
- `pnpm --dir apps/cloudflare typecheck`
- Repo documentation and diff-hygiene checks required by the completion workflow.
Completed: 2026-07-14
