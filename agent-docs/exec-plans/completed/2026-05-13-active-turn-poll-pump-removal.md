# Active-Turn Poll Pump Removal

## Goal

Delete the generic active-turn live poll pump so active-turn input admission is
fully driven by explicit events, provider boundaries, manual steering, and the
one-shot pre-provider input probe.

Success criteria:

- `livePollEnabled`, `startLiveInputPump`, and the 1s timer tick are removed.
- Live provider registration still enables already-accepted input to steer the
  active provider turn.
- Local and hosted explicit input-available notifications still admit and steer
  active-turn input.
- Pre-provider probing still catches input staged before the provider request.
- Focused tests prove no timer admission happens merely because a provider turn
  registered.

## Constraints

- Preserve unrelated dirty work in the checkout.
- Do not change hosted mailbox import, runtime wake, provider delivery,
  checkpoint, or outbox ownership.
- Do not add a replacement retry loop; accepted residual behavior is that
  failed best-effort notifications fall back to provider-boundary admission or a
  later wake.

## Plan

1. Remove the live poll pump and `livePollEnabled` option plumbing.
2. Remove local-service hosted queue-only special casing that only controlled
   the pump.
3. Update active-turn controller tests and add a regression that provider
   registration alone does not trigger admission.
4. Run focused assistant-engine verification plus required repo checks/audits.

## Verification

Completed:

- `pnpm --dir packages/assistant-engine exec vitest run --config vitest.config.ts test/assistant-local-service-runtime.test.ts --testNamePattern "active-turn controller" --no-coverage`
- `pnpm typecheck`
- `bash scripts/workspace-verify.sh test:diff packages/assistant-engine/src/assistant/active-turn-input-controller.ts packages/assistant-engine/src/assistant/local-service.ts packages/assistant-engine/test/assistant-local-service-runtime.test.ts agent-docs/exec-plans/active/2026-05-13-active-turn-poll-pump-removal.md`
- `git diff --check --` for the task files

Audits completed:

- Security/privacy review: no findings.
- Coverage-write: no file changes; existing proof judged sufficient. The
  worker's own broad rerun hit transient CLI artifact-lock/build-output noise,
  and the parent reran the exact required diff-aware command successfully.
- Final completion review: no findings.

Status: completed
Updated: 2026-05-13
Completed: 2026-05-13
Completed: 2026-05-13
