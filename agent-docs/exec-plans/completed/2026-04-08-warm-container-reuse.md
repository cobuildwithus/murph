# Implement warm per-user hosted runner containers from ChatGPT patch

Status: completed
Created: 2026-04-08
Updated: 2026-04-08

## Goal

- Land the downloaded ChatGPT warm-container patch intent cleanly in the current tree so hosted Cloudflare runner containers can stay warm per user for a short idle TTL while each actual Murph run remains a fresh isolated child process.

## Success criteria

- `apps/cloudflare` runner lifecycle no longer destroys the outer container before and after every invoke.
- Warm reuse keeps the supervisor/container control boundary explicit, rotates per-run outbound proxy authority, and still force-cleans child processes after each run.
- Focused Cloudflare runner tests cover warm reuse, container busy rejection, and child-process cleanup.
- Required repo verification for this change class is run, plus at least one direct scenario proof is captured.

## Scope

- In scope:
- `apps/cloudflare/src/{runner-container.ts,container-entrypoint.ts,node-runner-isolated.ts,deploy-automation/environment.ts,user-runner/runner-dispatch-processor.ts}`
- `apps/cloudflare/test/**` additions/updates needed for the warm-container behavior
- Durable docs that describe the hosted runner trust boundary and env surface
- Out of scope:
- broader queue semantics, hosted outbox behavior, or cross-user container pooling
- unrelated hosted-web edits already present in the worktree

## Constraints

- Technical constraints:
- Preserve per-user serialization and avoid keeping decrypted workspace state warm between runs.
- Do not reintroduce shared secrets or per-run authority leakage across warm reuse.
- Product/process constraints:
- Keep the landing scoped to the downloaded patch intent and preserve unrelated local changes.
- Follow the repo high-risk workflow, including a required audit subagent before final handoff.

## Risks and mitigations

1. Risk: Warm reuse could accidentally preserve stale control or proxy authority.
   Mitigation: Keep a supervisor-only control token on the container shell, rotate outbound proxy bindings after every run, and destroy on ambiguous or failed cleanup state.
2. Risk: Current-tree drift could make the external patch unsafe to apply verbatim.
   Mitigation: Port the intended behavior into current files manually and verify against existing tests/stubs/docs.

## Tasks

1. Port the runner lifecycle, entrypoint, env-surface, and child-process cleanup changes into the current `apps/cloudflare` sources.
2. Add or adapt focused tests for warm reuse, busy rejection, and child cleanup using the existing Vitest stub setup.
3. Update durable docs to match the new warm-shell/one-shot-child trust boundary, run required verification, and complete audit/commit flow.

## Decisions

- Use a dedicated execution plan even though this started as a patch landing because the touched scope is high-risk and crosses runtime trust-boundary docs, code, and tests.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:coverage`
- direct focused scenario proof for warm container reuse using the added `apps/cloudflare` test surface
- Expected outcomes:
- Required commands pass, or any failure is clearly attributable to an unrelated pre-existing issue.
Completed: 2026-04-08
