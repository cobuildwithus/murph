# Preserve active delegated requests during background checkpointing

Status: completed
Created: 2026-09-20
Updated: 2026-09-20

## Outcome and owner

Resolve the accepted final review finding in PR 3613. Finished background work
still checkpoints promptly; a claimed delegated request keeps its existing
expiry bound through preparation and execution. The detached controller and
shared checkpoint wait remain the only lifetime owners. No wire or persisted
state changes are needed.

## Cause and correction

Claiming an Ask marks the runtime dirty before its child settles. The immediate
checkpoint deadline can then pause and requeue a joined-group request because
only operator diagnostics publish an active deadline. Generalize that existing
deadline and publish it before the claim's dirty notification. Preserve explicit
shutdown, expiry, handoff, requeue, and checkpoint-before-effect boundaries.

## Product UX and proof

Patch. Prove a group consultation with no conversation traffic survives slow
preparation and execution, completes exactly once, and checkpoints without an
additional idle delay. Prove expiry and shutdown still abort and persist a
retry. Retain foreground, diagnostic, and provider-handoff regressions.
The model's prompts, tools, selection, and reply policy do not change; direct
runtime/child boundary proof is the applicable deterministic verification lane.

## Tasks

1. Reproduce the finding through the composed runtime with synthetic ports.
2. Extend the existing active deadline from claim through settlement.
3. Run focused runtime/controller tests, typecheck, complexity, and doc checks.
4. Close the implementation plan and publish the verified candidate through
   Draft/Ready. Track final ReviewGPT round 2 and exact-head CI in the PR while
   keeping the first-reviewed head unchanged.

## Verification and review

- The new composed regression reproduced cancellation during preparation before
  the fix in all four boundary cases.
- Focused lifetime/controller/startup/hot-provider proof: 5 files, 76 tests passed.
- Final broader runtime regression run: 24 files, 533 tests passed.
  Command: `pnpm --dir packages/assistant-runtime test hosted-runtime-workspace-entrypoint test/hosted-runtime-background-ask-lifetime.test.ts test/hosted-runtime-background-checkpoint-timing.test.ts test/hosted-runtime-hot-provider-consistency.test.ts test/hosted-runtime-detached-assistant-ask.test.ts test/hosted-runtime-clinical-enrichment-controller.test.ts test/hosted-runtime-promoted-foreground-priority.test.ts test/hosted-runtime-metadata-checkpoint-timing.test.ts --reporter=dot`.
- Runtime typecheck passed after the final TypeScript edit.
- Complexity guard passed: runtime debt 482/max 223, detached controller debt
  18/max 38, and clinical helper debt 0/max 7 are unchanged. The correction
  reorders an existing callback and generalizes its existing deadline.
- Documentation drift and whitespace checks passed.
- Parent review confirmed the existing expiry remains authoritative, empty
  discovery does not extend a deadline, settled requests clear the deadline,
  and shutdown/owner handoff retain abort-and-requeue authority.
- CI on the first candidate also identified two hot-provider fixtures with no
  initial conversation. Supplying that synthetic conversation and advancing
  the later message sequence preserves the original provider-entry assertions.
- Changelog: not applicable; internal runtime lifetime and regression proof only.
- Product UX: Ready. No prompt or provider-input changes;
  composed runtime tests prove preparation, execution, exactly-once completion,
  and expiry/shutdown/handoff without invoking a live model.
- User resumed after the accepted round-1 finding. Final ReviewGPT round 2 and
  required CI remain external PR gates, recorded in the PR body. No deployment
  or merge is authorized; the requested endpoint is a green PR ready for merge.
Completed: 2026-09-20
