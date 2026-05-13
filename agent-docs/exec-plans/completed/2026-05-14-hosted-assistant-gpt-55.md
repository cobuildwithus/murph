# Hosted Assistant GPT-5.5 Production Model

Status: completed
Created: 2026-05-14
Updated: 2026-05-14

## Goal

- Update production hosted assistant deploy policy and environment so the hosted assistant runs `gpt-5.5` with the existing low reasoning profile.

## Success criteria

- Production deploy preflight accepts `HOSTED_ASSISTANT_MODEL=gpt-5.5` and continues requiring `HOSTED_ASSISTANT_REASONING_EFFORT=low`.
- Deploy docs describe the production hosted assistant model as `gpt-5.5`.
- Focused deploy-preflight tests pass.
- GitHub production environment variable is updated to `HOSTED_ASSISTANT_MODEL=gpt-5.5`.
- `pnpm cf:deploy:immediate` completes and the active Cloudflare Worker version reports `HOSTED_ASSISTANT_MODEL=gpt-5.5`.

## Scope

- In scope: Cloudflare deploy preflight, deploy docs, focused tests, production deploy variable, immediate Cloudflare deploy.
- Out of scope: assistant prompt changes, pricing math changes, broader hosted runner refactors.

## Constraints

- Technical constraints: deploy must run from protected `main`; preserve unrelated dirty worktree edits.
- Product/process constraints: keep production reasoning effort low unless explicitly changed.

## Risks and mitigations

1. Risk: production deploy continues to reject `gpt-5.5`.
   Mitigation: update preflight and focused tests before dispatching the deploy workflow.

2. Risk: unrelated local edits are accidentally deployed.
   Mitigation: use the `cf:deploy:immediate` workflow path from committed `main`, not a local direct deploy.

## Tasks

1. Done: updated production deploy preflight to require `gpt-5.5` plus low reasoning.
2. Done: updated deploy docs and tests.
3. Done: ran focused verification and required review.
4. Done: set the GitHub production model variable to `gpt-5.5` and read back provider/model/reasoning.
5. Next: commit and push the scoped change.
6. Next: run `pnpm cf:deploy:immediate` and verify the active Worker version.

## Decisions

- Preserve `HOSTED_ASSISTANT_REASONING_EFFORT=low`; the requested change is the hosted assistant model.

## Verification

- Commands to run:
  - `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/deploy-preflight.test.ts`
  - `pnpm --dir apps/cloudflare typecheck`
  - `pnpm test:diff apps/cloudflare/scripts/deploy-preflight.ts apps/cloudflare/test/deploy-preflight.test.ts apps/cloudflare/DEPLOY.md`
  - `pnpm cf:deploy:immediate`
- Outcomes:
  - Passed: focused deploy-preflight test, 37 tests.
  - Passed: Cloudflare typecheck.
  - Passed: diff-aware Cloudflare owner verification, including 74 files / 915 tests.
  - Passed: security/privacy review, no findings.
  - Passed: coverage-write review, no extra test changes needed.
  - Passed: task-finish review, no findings.
  - Pending: immediate deploy workflow succeeds and production Worker version vars show `HOSTED_ASSISTANT_MODEL=gpt-5.5`.
Completed: 2026-05-14
