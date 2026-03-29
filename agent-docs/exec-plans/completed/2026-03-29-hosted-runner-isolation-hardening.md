# Harden Hosted Runner Job Isolation

Status: completed
Created: 2026-03-29
Updated: 2026-03-29

## Goal

- Tighten hosted runner job isolation so one run cannot reuse supervisor-only secrets, ambient writable homes or caches, or lingering child processes from another run.

## Success criteria

- The isolated hosted child process receives only a scrubbed env instead of inheriting the full container supervisor env.
- Hosted jobs run with per-run writable cache and temp roots, and the isolated child launch no longer reuses the container supervisor `HOME`.
- Container request timeout or client disconnect aborts the hosted child and kills its process group instead of leaving it running in a warm container.
- Focused Cloudflare and assistant-runtime regressions cover the new env and abort behavior.
- Repo-required verification for touched areas is run, or any unrelated blocker is recorded precisely.

## Scope

- In scope:
- `packages/assistant-runtime` isolated child-launch environment and abort handling.
- `apps/cloudflare` container entrypoint/request lifecycle wiring and hosted runner tests.
- Minimal architecture and verification docs needed to keep the trust-boundary description truthful.
- Out of scope:
- Forcing container destruction after every job.
- Broader hosted control-plane auth and routing cleanup already covered by overlapping lanes.

## Constraints

- Technical constraints:
- Preserve the existing hosted dispatch, commit, and finalize behavior.
- Keep the child launch path compatible with both the TypeScript test harness and the built runtime child entry.
- Product/process constraints:
- Preserve adjacent dirty work in the overlapping hosted-runtime and Cloudflare files.
- Run the mandatory completion-workflow audit subagents before handoff because this touches production runtime code.

## Risks and mitigations

1. Risk: Overlapping hosted-runtime and Cloudflare lanes are already editing some of these files.
   Mitigation: Keep the patch narrow to env isolation and abort handling, read live file state first, and avoid unrelated refactors.
2. Risk: Over-scrubbing the child env could break downstream tools that depend on path or cert settings.
   Mitigation: Preserve a small explicit ambient allowlist for process execution and network trust while excluding supervisor-only secrets, including proxy credentials.
3. Risk: Abort handling could race with normal completion and produce noisy failures.
   Mitigation: Treat abort as a first-class terminal state, remove listeners on settle, and cover the edge cases with focused tests.

## Tasks

1. Register the lane in the coordination ledger and inspect the overlapping hosted runtime and container files.
2. Add a scrubbed isolated-child env builder with per-run writable directories.
3. Thread abort signals from the container HTTP request into the hosted runner and kill the full child process group on abort.
4. Add focused assistant-runtime and Cloudflare regression tests for env scrubbing and request-abort handling.
5. Update any architecture and verification docs needed for the new trust-boundary behavior, then run verification and the required audit passes.

## Decisions

- Keep warm-container reuse for now; reduce persistence risk by isolating writable cache/temp dirs per run, avoiding the supervisor `HOME` at child launch, and forcibly reaping the child process group on abort.
- Preserve only a minimal ambient child-env allowlist (`PATH`, locale/timezone, and cert settings) instead of inheriting all of `process.env`.

## Verification

- Commands to run:
- Focused Vitest for touched Cloudflare and assistant-runtime files while iterating.
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- New hosted-runner isolation regressions pass.
- Final repo commands pass, or any failure is shown to be unrelated to this lane before commit or handoff.
Completed: 2026-03-29
