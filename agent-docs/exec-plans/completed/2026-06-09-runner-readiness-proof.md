# Collapse duplicate hosted runner readiness check

Status: completed
Created: 2026-06-09
Updated: 2026-06-09

## Goal

- Avoid paying the hosted runner warm health check twice when runtime startup
  confirmation is followed immediately by the workspace invocation for the same
  warm shell generation.

## Success criteria

- `RunnerContainer.ensureContainerReady` can reuse a very recent successful
  readiness proof for the same container stop generation.
- The fallback health check path remains unchanged when the proof is stale,
  missing, or invalidated by a container stop/destroy.
- Focused runner-container tests cover reuse and invalidation.
- Cloudflare verification/typecheck passes or any unrelated blocker is
  recorded with evidence.

## Scope

- In scope:
- `apps/cloudflare/src/runner-container.ts`
- `apps/cloudflare/test/runner-container.test.ts`
- Out of scope:
- New scheduler, durable readiness state, container entrypoint changes, or
  invocation/control-plane ownership changes.

## Constraints

- Technical constraints:
- Keep readiness proof ephemeral and container-local.
- Do not weaken architecture version, poisoned-shell, stopped-shell, or
  warm-invalidation checks.
- Product/process constraints:
- Preserve foreground hosted runtime safety and metadata-only logs.
- Coordinate with the existing hosted-runner lifecycle ledger row touching the
  same file; no dirty source overlap exists at plan creation.

## Risks and mitigations

1. Risk: Reusing readiness after a shell stop could mask a stale container.
   Mitigation: Bind proof to `stopGeneration` and clear it on stop/failed
   cleanup paths.
2. Risk: Skipping health for too long could miss a poisoned shell.
   Mitigation: Keep the reuse window tiny and fall back to the existing full
   health check outside that window.

## Tasks

1. Add a short-lived same-generation readiness proof in `RunnerContainer`.
2. Reuse that proof only for immediate repeated readiness checks.
3. Add focused tests for duplicate-check collapse and stale/generation
   invalidation.
4. Run focused verification and required completion audits.
5. Close the plan and create a scoped commit if verification/audits pass.

## Decisions

- Use option A from the design discussion: recent readiness proof reuse inside
  the existing readiness helper. Do not add a new combined RPC or consumed
  reservation state.

## Verification

- Commands to run:
- `pnpm test:diff apps/cloudflare/src/runner-container.ts apps/cloudflare/test/runner-container.test.ts`
- `pnpm typecheck`
- Outcomes:
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/runner-container.test.ts`
  passed after implementation and audit-driven fixes: 108 tests passed.
- `git diff --check -- apps/cloudflare/src/runner-container.ts apps/cloudflare/test/runner-container.test.ts agent-docs/exec-plans/active/2026-06-09-runner-readiness-proof.md agent-docs/exec-plans/active/COORDINATION_LEDGER.md`
  passed.
- `pnpm test:diff apps/cloudflare/src/runner-container.ts apps/cloudflare/test/runner-container.test.ts`
  passed once before later unrelated same-app edits landed. After concurrent
  unrelated edits to `apps/cloudflare/src/user-runner/runtime-processing-controller.ts`,
  reruns failed in app typecheck with TS2345 at that file's line 390 before this
  task's final scoped checks could complete.
- `pnpm typecheck` failed due unrelated dirty
  `scripts/supplement-db-brand-site-labels.test.ts` type errors. Those files are
  outside this task and were dirty before this task's source edits.

## Audit outcomes

- Security/privacy review found no medium-or-higher findings.
- Coverage-write added focused proof-consumption and cross-user invalidation
  tests.
- Deep-review findings on proof age, transitional states, and lifecycle errors
  were fixed and rerun with no concrete findings.
- Final task review rerun found no concrete findings. Remaining risk is
  liveness-only if a platform status races lifecycle callbacks inside the short
  proof window; invocation failure still clears the proof and falls back to the
  existing retry/recheck path.
Completed: 2026-06-09
