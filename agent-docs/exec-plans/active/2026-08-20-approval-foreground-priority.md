# Prioritize approved foreground continuations

Status: active
Created: 2026-08-20
Updated: 2026-08-20

## Goal

- Restore foreground precedence for an approved action's exact causal
  continuation after the mandatory dirty-work checkpoint, so unrelated device
  maintenance cannot delay the member's approved result.

## Success criteria

- A mixed system-mailbox prefix with an older device wake and a newer
  `runtime.pending-effects-reconcile-requested` wake remains checkpoint-gated
  while the runtime is dirty.
- On the first post-checkpoint pass, the causal approval continuation is
  prepared and delivered before the device wake.
- The device wake remains pending for a later bounded maintenance pass; no
  work is lost or reordered within its own owner lane.
- Fresh conversation precedence, approval effect binding, and the existing
  dirty-state fence remain unchanged.
- Focused hosted-runtime tests, package typecheck, exact-head CI, the
  preliminary ReviewGPT Product UX/coverage pass, and the final ReviewGPT gate
  pass with no unresolved accepted findings.

## Scope

- In scope: hosted runtime post-checkpoint foreground selection, focused
  regression coverage, protocol documentation if the existing contract needs
  clarification, and a member-visible reliability changelog item.
- Out of scope: weakening the dirty-state checkpoint fence, changing device
  synchronization semantics, adding a new queue or persisted state, or changing
  approval authorization and delivery owners.

## Constraints

- Technical constraints: reuse the existing foreground-causal selector and
  exact parked-effect binding; keep work bounded and preserve general
  oldest-first maintenance behavior when no causal continuation is ready.
- Product/process constraints: ReviewGPT authors the initial implementation
  patch from a privacy-safe synthetic scenario. The parent inspects every hunk,
  applies only the smallest correct patch, and owns verification, commits,
  review resolution, and shipping.

### Product UX Patch

- Outcome: an approval resumes the action the member just approved without
  waiting behind unrelated device maintenance.
- Reaches: the existing asynchronous approval-to-channel-delivery journey when
  the member's runtime already has dirty work and device wakes queued.
- Proof: a production-shaped mixed-prefix regression shows checkpoint first,
  then approval delivery, while device work remains safely pending.

## Risks and mitigations

1. Risk: broad foreground selection could drain unrelated automation or unsafe
   system work before checkpoint or conversation work.
   Mitigation: keep the dirty fence and exact causal allowlist unchanged; apply
   precedence only after the safe checkpoint boundary.
2. Risk: device maintenance could starve or be dropped.
   Mitigation: assert that its mailbox item remains pending and is available to
   a subsequent ordinary system-maintenance pass.
3. Risk: a scheduler-only unit test could miss the real runtime admission path.
   Mitigation: add the regression at the hosted workspace entrypoint boundary
   and retain lower-level selection coverage where useful.
4. Risk: gradual runner rollout leaves warm containers on the old ordering.
   Mitigation: document Worker/container skew and use the repository's supported
   immediate runner rollout when the merged fix is deployed.

## Tasks

1. Package the exact base and synthetic incident contract for a fresh ReviewGPT
   implementation request.
2. Inspect and deliberately apply the returned patch, reducing it if it exceeds
   the existing ownership boundary.
3. Run focused regression proof, package typecheck, diff/privacy checks, and the
   Product UX walkthrough.
4. Commit and push the review candidate, open the PR, and launch exact-head CI,
   preliminary specialists, and final ReviewGPT round 1 concurrently.
5. Triage and resolve findings, rerun affected proof and later review rounds as
   required, complete parent final review, close this plan, and ship the PR.

## Decisions

- Effort level is `Patch`: the product promise and authority do not change; the
  fix removes an unintended delay in the existing approval journey.
- The dirty-work checkpoint remains mandatory. Foreground precedence applies at
  post-checkpoint selection, not by prefetching a mixed unsafe prefix.
- No new durable owner, queue, state machine, or device-specific exception is
  justified.
- ReviewGPT verified the root cause and authored the initial four-file patch.
  Parent inspection confirmed the patch adds one transient post-checkpoint
  selection hint and otherwise reuses the existing causal and maintenance
  selectors.

## Product UX Walkthrough

- Person and path: an existing member approves an already-prepared foreground
  file action while the active runtime has dirty work and an older device wake.
- Evidence: the production-shaped entrypoint test proves the mixed prefix stays
  behind the idle checkpoint; the assistant-phase test proves the approval
  continuation then binds and delivers only its parked effect before the older
  device wake, which remains pending for its next maintenance pass.
- Differences from plan: none. Presentation, permission language, approval
  authority, and destination do not change, so screenshots add no material
  evidence.
- Result: `Ready`.

## Verification

- Completed local proof:
  - `pnpm exec vitest run --config vitest.config.ts --isolate=true --no-coverage test/hosted-runtime-workspace-entrypoint.test.ts test/hosted-runtime-workspace-assistant-phase.test.ts`
    passed 640 tests across both files.
  - `pnpm typecheck` in `packages/assistant-runtime` passed.
- Pending exact-head proof: GitHub required checks, preliminary
  `completion-specialists`, and final `pr-review` ReviewGPT rounds.
- Expected outcome: synthetic approval delivery wins the first post-checkpoint
  selection; device work remains pending; all focused and exact-head checks are
  green; both ReviewGPT stages finish with no unresolved accepted findings.
