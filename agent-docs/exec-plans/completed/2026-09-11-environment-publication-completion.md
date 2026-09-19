# Finish Environment browser publication after foreground recovery

Status: completed
Created: 2026-09-11
Updated: 2026-09-11

## Goal

Finish publishing a saved Environment update after foreground recovery while
preserving immediate priority for a fresh conversation.

## Success criteria

- Reproduce the missing publication through the existing composed runtime test.
- Preserve canonical recording, browser publication, real foreground preemption,
  and the existing projection-failure retry without introducing another owner.
- Pass focused regressions, runtime typecheck, parent review, ReviewGPT and CI.
- Require unchanged managed release admission before deployment.

## Scope

- In scope: Runtime completion and wake handling at the existing publication
  boundary, synthetic regressions, and the affected owner documentation.
- Out of scope: Temporal retry policy, provider setup, authentication migration,
  timeout increases, and unrelated foreground wake changes.

## Constraints

- Prove the failing transition before changing production code. Preserve existing
  snapshot, mailbox, and replica owners; add no persisted state or scheduler.
- Use synthetic evidence. Keep production diagnostics and personal identifiers
  out of artifacts. Preserve other active checkouts and changes.

## Risks and mitigations

1. A scheduler notification is mistaken for fresh conversation input.
   Mitigation: Exercise empty notifications and real foreground arrivals through
   the actual runtime and mailbox boundaries.
2. Recording succeeds while browser publication is deferred without recovery.
   Mitigation: Assert the canonical saved content in the actual published replica.
3. A local fix fails to address managed admission.
   Mitigation: Distinguish the reproduced defect from the deployment outcome;
   retain the unchanged managed admission requirement.

## Tasks

1. Trace recording, checkpoint, publication, and owner-release contracts.
2. Add a focused composed regression and establish the baseline failure.
3. Correct only the proven transition; verify adjacent success and failure paths.
4. Review, document, commit and open a scoped PR with ReviewGPT and required CI.
5. Merge when ready; verify managed admission and production release separately.

## Decisions

- The five-minute accepted-owner horizon is intentional and covered by existing
  orchestration tests. Investigate runtime publication before changing that owner.
- Product UX effort: Patch. Replay successful recording, an empty scheduler
  notification, actual foreground preemption, and a real projection failure.
- No model interpretation, prompt, tool, or reply-construction change is planned;
  composed synthetic delivery proves the ordering boundary.

## Verification

- Focused command: `pnpm --dir packages/assistant-runtime test
  test/hosted-runtime-environment-interrupted-recording.integration.test.ts`.
- Typecheck: `pnpm --dir packages/assistant-runtime typecheck` after prerequisite
  workspace build preparation.
- Run relevant adjacent runtime regressions, `pnpm complexity:diff`, and
  `pnpm docs:drift` after the final implementation.
- Baseline: An empty hint during real replica storage reproduced a completed
  system item and delivered reply without browser publication.
- Correction: The existing refresh waiter asks the runtime to classify hints;
  an empty caught-up prefix with no competing local work preserves the same
  operation and deadline. No timer, snapshot, callback wire, or persisted state
  changed.
- Local proof: All seven composed Environment cases passed across focused runs.
  The repeated-hint fixture waits for three actual mailbox reads during one
  write and requires one publication. Six neighboring cases passed together;
  the repeated-hint case passed after its ordering barrier was made explicit.
  The 24 replica primitive tests and 24 adjacent publication, mailbox, and
  convergence tests passed. Runtime typecheck, prepared workspace build,
  complexity, and documentation drift checks passed.
- Product UX: Ready at the composed local boundary. Real foreground work and
  failed or incomplete reads still interrupt; saved content survives harmless
  notifications. Model/transport ports are synthetic.
- Parent candidate review: Source and test boundaries inspected; existing
  runtime completion and publication owners remain authoritative. Complexity
  debt and maxima are unchanged in both source files.
- Changelog: PR #3284 is associated with the existing Environment recovery item.
  All 10 focused archive rendering tests and Web typecheck passed. The production
  presentation reference responds successfully and contains the archive anchor;
  the existing content-only provenance exception applies.
- Implementation and local review are complete. Final ReviewGPT, required CI,
  and unchanged managed admission remain external completion gates owned by the
  original session. No deployment success is claimed.
Completed: 2026-09-11
