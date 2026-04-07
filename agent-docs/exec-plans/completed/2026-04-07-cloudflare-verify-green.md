# Make apps/cloudflare verify green and faster enough for deploy

Status: completed
Created: 2026-04-07
Updated: 2026-04-07

## Goal

- Make `pnpm --dir apps/cloudflare verify` pass reliably on a clean path, remove the current runtime/test failures blocking the hosted deploy workflow, and cut the slowest Cloudflare test hotspots enough that local and CI verification finish promptly.

## Success criteria

- `pnpm --dir apps/cloudflare verify` passes locally from the repo root.
- The Cloudflare node runner suites no longer hang on stale child-process or bootstrap assumptions.
- The production hosted deploy workflow can be dispatched from current `main` without re-hitting the previously observed Cloudflare verify failures.

## Scope

- In scope:
- Cloudflare hosted runner/runtime test fixes under `apps/cloudflare/**`
- Minimal hosted runner runtime fixes required to satisfy current tests and deploy safety
- Focused test-speed improvements that preserve coverage
- Out of scope:
- Unrelated hosted web or package changes already dirty in the worktree

## Constraints

- Technical constraints:
- Preserve current hosted execution coverage; do not weaken assertions just to shorten runtime.
- Keep workspace/package import boundaries intact.
- Product/process constraints:
- Preserve unrelated dirty-tree edits.
- Land scoped commits only for touched Cloudflare files and plan artifacts.

## Risks and mitigations

1. Risk: stale tests may hide a real hosted runner regression.
   Mitigation: patch runtime behavior when the failing expectation reflects real intended semantics, and rerun the full Cloudflare verify path.
2. Risk: deploy reruns may accidentally target an old broken SHA.
   Mitigation: push the new commit first, then dispatch the workflow with `--ref main`.

## Tasks

1. Reproduce the remaining failing Cloudflare node suites under `apps/cloudflare verify`.
2. Patch stale request shapes, crypto bootstrap/setup assumptions, and current result payload expectations.
3. Remove the slow isolated child-process concurrency test path in favor of a direct isolated-runner seam.
4. Rerun focused suites, then the full Cloudflare verify command, and measure end-to-end runtime.
5. Commit, push, and rerun the production deploy workflow from current `main`.

## Decisions

- Treat poisoned event IDs as permanently blocked even after the consumed-event exact tombstone ages out.
- Read hosted user root-key envelopes from any configured historical envelope-key path so per-user env survives envelope-key rotation.
- Keep one lower-level queue saturation path in `user-runner.test.ts`, but remove the much heavier isolated child-process path from `node-runner.test.ts`.

## Verification

- Commands to run:
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage --reporter=verbose apps/cloudflare/test/user-runner.test.ts`
- `pnpm --dir ../.. exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage --reporter=dot apps/cloudflare/test/node-runner.test.ts`
- `/usr/bin/time -p pnpm --dir apps/cloudflare verify`
- Expected outcomes:
- Focused node-runner and user-runner suites pass.
- Full `apps/cloudflare verify` passes in roughly low-teens seconds locally instead of hanging for minutes.
Completed: 2026-04-07
