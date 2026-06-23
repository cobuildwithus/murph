# Hosted Local Worktree Dev

Status: completed
Created: 2026-06-22
Updated: 2026-06-22

## Goal

- Specify the agent workflow and future helper shape for running `pnpm dev` from a secondary worktree without colliding with the main checkout's hosted-local stack, ports, database, runtime cache, local containers, or webhook tunnel state.

## Success criteria

- Durable docs explain the safe manual env profile agents can use today.
- Durable docs specify the smallest helper command that should be built next.
- `README.md` and `agent-docs/index.md` link to the new workflow.
- Verification follows the docs-only fast path.

## Scope

- In scope:
  - Agent/developer docs for hosted-local worktree dev isolation.
  - Pointers from existing dev workflow docs.
- Out of scope:
  - Implementing the helper command in this pass.
  - Changing hosted-local runtime behavior, auth boundaries, or webhook registration code.

## Constraints

- Technical constraints:
  - Keep generated files and docs free of local account, home-directory, and direct personal identifiers.
  - Preserve unrelated dirty checkout changes.
  - Do not expose secret values from `.env`, Vercel, Stripe, Linq, Cloudflare, or Codex auth files.
- Product/process constraints:
  - Prefer existing hosted-local primitives over a parallel dev runner.
  - Keep AGENTS.md route-sized; link durable details instead of expanding the root policy.

## Risks and mitigations

1. Risk: The spec implies unsafe shared secret copying between worktrees.
   Mitigation: Keep secret material in existing env-loading paths; document symlink/copy options only for non-secret project links and tunnel config, and require local ignored state for generated secrets.
2. Risk: Manual env examples become another brittle, copy-pasted launcher.
   Mitigation: Mark the manual profile as temporary and specify a single future helper command that derives the values.

## Tasks

1. Inspect hosted-local config and current docs.
2. Add a durable worktree dev workflow/spec doc.
3. Update `README.md` and `agent-docs/index.md` pointers.
4. Read back touched docs and run the docs-only verification.
5. Close the plan with a scoped commit.

## Decisions

- The current change will be docs/spec only; runtime helper implementation is deferred until the contract is reviewed.
- The helper should derive a stable per-worktree dev namespace instead of requiring agents to hand-pick every port/path.
- The spec calls out the current `dev` profile runner-container cleanup caveat instead of claiming full concurrent runner proof is safe today.
- The future helper should be a `packages/hosted-local-harness` profile/command, not a shell wrapper.

## Verification

- Commands to run:
  - `git diff --check`
  - direct readback of touched Markdown docs
- Expected outcomes:
  - No whitespace errors.
  - The new doc contains no local account, home-directory, or secret values.
Completed: 2026-06-22
