# CLI Bridge Off-Invocation Stale Process

## Goal

Stop hosted warm Codex reuse when an authenticated CLI bridge request reaches
the bridge outside an active invocation.

## Success Criteria

- The bridge records authenticated off-invocation requests with a small count
  and timestamp.
- Authenticated off-invocation requests return 503, record a violation, and
  prevent the next invocation from entering until the container lifecycle
  consumes the violation.
- The container entrypoint consumes that bridge violation after a workspace
  invocation and calls the assistant-engine warm Codex stop hook.
- Random unauthenticated callers still receive normal bridge rejection without
  poisoning warm Codex reuse.
- No new callback owner, scheduler, or broad lifecycle service is introduced.

## Constraints

- Keep ownership simple: bridge records the violation; Cloudflare container
  lifecycle owns the stop decision; assistant-engine owns the Codex process.
- Preserve the existing active-invocation gate, write-fence model, and process
  cleanup behavior.
- Keep diagnostics metadata-only.

## Working Set

- `packages/assistant-runtime/src/hosted-runtime/cli-runtime-bridge.ts`
- `packages/assistant-runtime/test/hosted-runtime-cli-runtime-bridge.test.ts`
- `apps/cloudflare/src/container-entrypoint.ts`
- `apps/cloudflare/test/container-entrypoint.test.ts`

## Completion Evidence

- `pnpm typecheck` passed.
- `git diff --check` passed.
- `pnpm test:diff` passed.
- Security/privacy re-audit: no findings.
- Task-finish re-audit: requested coverage gaps resolved.
Status: completed
Updated: 2026-06-03
Completed: 2026-06-03
