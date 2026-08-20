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

- Technical constraints: reuse the existing approval-only causal predicates and
  exact parked-effect binding; keep work bounded and preserve general
  oldest-first maintenance behavior when no approved continuation is ready.
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
- Final ReviewGPT round 1 found that the initial transient one-shot hint could
  be consumed by an unrelated Assistant Ask completion and would not persist
  across multiple approved continuations. The finding was accepted.
- The remediation deletes that hint and derives an approval-only preference
  from durable mailbox state on every ordinary maintenance selection. The
  unchanged oldest-first selector remains the fallback when no approval is due.
- Final ReviewGPT round 2 proved that the remediation remained selector-local:
  a projected due device alarm could still run before a second selected
  approval's delivery on the successor pass. The accepted repeated-mechanism
  finding triggered the required anomaly retrospective.
- Retrospective decision: preserve the explicit every-ready-approval guarantee
  and redesign persisted system-mailbox ordering as the single authority for
  both the next runnable item and its projected workspace wake. Delete the
  preferred-selector plumbing; reuse the existing approval-continuation
  classification to keep idle device maintenance out of that selected pass,
  without changing unrelated mailbox/device concurrency or adding another
  state owner or reconciliation mechanism. Require an outer-runtime checkpoint
  proof plus a production-phase successor proof with a configured device
  runtime and no fresh second-pass import.
- Final ReviewGPT round 3 found a due approval could still be hidden behind an
  earlier backed-off runtime-control item because the broad serialization key
  was checked before the exact due-approval predicate. The finding was
  accepted. The shared default selector now checks the exact approval first;
  explicit selectors and ordinary runtime-control serialization are unchanged.
- A tooling-invalid round 4 response exposed another production-reachable
  ownership split: `system_mailbox` processing applies its explicit model-free
  wake filter before the default selector can choose a ready approval, so an
  older device wake can still run first. The response was not accepted as gate
  evidence because trusted capture found duplicate DOM representations and no
  explicit model-confirmation line, but the underlying bug reproduced against
  the real entrypoint path and is accepted independently.
- Round 4 retrospective decision: the every-ready-approval guarantee applies
  in every assistant-capable processing mode. Use the existing unfiltered
  persisted mailbox selector as the single ownership decision before
  entering either the ordinary foreground path or the optimized
  `system_mailbox` path. An exact due approved-continuation selection upgrades
  the existing invocation into the ordinary foreground path; otherwise
  device-only work keeps the unchanged model-free path. This subordinates the
  explicit model-free allowlist without adding a flag, queue, scheduler,
  persisted priority, or a second ready-approval probe. The optional
  `systemMailboxFrontier` rollout seam remains unused and unchanged.

## Product UX Walkthrough

- Person and path: an existing member approves an already-prepared foreground
  file action while the active runtime has dirty work and an older device wake.
- Evidence: the production-shaped entrypoint test proves the mixed prefix stays
  behind the idle checkpoint. Assistant-phase tests prove two approvals drain
  in exact effect-ID order before the older device wake, an unrelated Assistant
  Ask completion remains pending, and device-only work retains oldest-first
  fallback behavior.
- Differences from plan: ReviewGPT round 1 replaced the initial transient hint
  with durable approval-only selection. Presentation, permission language,
  approval authority, and destination do not change, so screenshots add no
  material evidence.
- Result: `Ready`.

## Verification

- Completed local proof:
  - `pnpm exec vitest run test/hosted-runtime-mailbox-state.test.ts test/hosted-runtime-workspace-assistant-phase.test.ts test/hosted-runtime-workspace-entrypoint.test.ts`
    passed 656 tests across all three files after the round 4 remediation.
  - `pnpm typecheck` in `packages/assistant-runtime` passed.
  - Focused changelog fragment, registry, and route tests passed 49 tests.
  - Web typecheck passed after generating the changelog fragments.
- Preliminary ReviewGPT `completion-specialists` passed on the first reviewed
  head with Product UX and coverage marked applicable and complete.
- Final ReviewGPT round 1 produced one accepted original-PR finding. Round 2
  returned `RETROSPECTIVE_REQUIRED` for the repeated projected-device-alarm
  path; its finding is accepted and the requirement-level continuation decision
  is recorded above. Round 3 produced one accepted backed-off-runtime-control
  finding; its reordered shared-selector fix passes the full 655-test proof and
  typecheck. A tooling-invalid round 4 response found the system-mailbox
  ownership split described above; its finding is accepted independently and
  the required second retrospective is recorded. The corrected real-entrypoint
  proof now runs both exact approved deliveries before device maintenance and
  passes in the full 656-test proof. A valid round 4 retry and new exact-head CI
  remain pending.
- Expected outcome: synthetic approval delivery wins the first post-checkpoint
  selection; device work remains pending; all focused and exact-head checks are
  green; both ReviewGPT stages finish with no unresolved accepted findings.
