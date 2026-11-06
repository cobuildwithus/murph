# Resume accepted Assistant Ask work in continued warm runtimes

Status: completed
Created: 2026-09-30
Updated: 2026-09-30

## Goal

Resume accepted detached Assistant Ask work when an ordinary invocation continues after a checkpoint, before the existing request deadline expires.

## Success criteria

- A composed synthetic runtime regression fails on the base and passes on the corrected owner.
- Checkpoint quiescence, foreground priority, exact-Ask ownership, shutdown, abort, and provider handoff remain intact.
- Focused tests, relevant typechecks, parent review, final ReviewGPT, and required candidate CI pass.
- Leave the functional correction ready for human merge; production writes are outside this task's authority.

## Scope

- In scope: the existing runtime continuation boundary, focused regression proof, necessary owner documentation, and a truthful release note.
- Out of scope: new state, queues, timers, retries, deadline changes, provider/auth contracts, clinical import work, and device sync.

## Constraints

- ReviewGPT authors the substantive patch. Keep production evidence out of packets and committed artifacts.
- Preserve existing exact-target admission and all checkpoint/release fences.
- Other open clinical-import and Web telemetry PRs have no overlapping runtime-owner or detached-controller edits; inspected actual diffs before choosing this scope.

## Product UX

- Outcome: accepted Ask work remains eligible to run while the same runtime continues after saving its workspace.
- Reaches: detached Ask requests and operator diagnostics; existing recipients, consent, results, and deadlines remain authoritative.
- Proof: synthetic ordinary warm-runtime continuation plus cancellation/handoff boundaries. This is deterministic lifecycle scheduling; no prompt, model input, tool schema, or reply wording changes.

## Risks and mitigations

1. Resuming during a snapshot or after cancellation could violate workspace ownership.
   Use the established guarded continuation boundary and preserve pause/close behavior.
2. A controller-only test could miss the composition defect.
   Exercise the real runtime owner across checkpoint and later request import.

## Tasks

1. Obtain a ReviewGPT patch with a composed regression and the smallest owner correction.
2. Demonstrate base failure and candidate success; inspect complete source/test behavior.
3. Update necessary owner documentation and release note; perform focused verification.
4. Commit, push, open the PR, and run final ReviewGPT concurrently with CI.
5. Report the candidate and production verification boundary; preserve follow-up evidence.

## Decisions

- Existing import/admission tests prove the request can pass the checkpoint gate, but do not prove that the paused detached controller resumes.
- Use the existing controller and runtime owner; introduce no additional lifecycle mechanism.

## Verification

- 108 focused tests passed across causal entrypoint, detached controller, current-sender Ask, shutdown, and clinical checkpoint suites. Assistant-runtime and Web typechecks passed.
- The new composed regression fails on unchanged production source with the retained Ask still paused after import and continued foreground work, then passes with the one-call correction. Parent corrected the synthetic mailbox identity to satisfy the existing decode guard before recording red/green proof. Preparation is observed exactly once before expiry; no model or provider is invoked by this synthetic test.
- Complexity and documentation guards passed; existing hotspot debt is unchanged (468, maximum 223). Changelog archive: 10 tests passed. Final ReviewGPT and exact-head required CI remain the pushed-candidate gates.

## Parent review

- Product UX: Ready for the deterministic continuation boundary. The real runtime owner, mailbox bridge/state, and controller preserve import, checkpoint, preparation, and retirement ordering. Existing lifecycle tests retain abort, shutdown, provider handoff, exact request ownership, and current-sender authority.
- Model prompts, input composition, tool schema, recipients, consent, deadlines, and reply text are unchanged. A live model turn cannot exercise the checkpoint/controller scheduling defect; focused composed lifecycle proof is the relevant boundary.
- The only production correction is resuming the existing paused controller within the already guarded continuation block. No new awaited foreground work, retry policy, persistence, or owner is introduced.

## Implementation result

- One guarded resume call restores detached Ask continuation. Composed base-failure/candidate-pass proof, 108 lifecycle tests, 10 archive tests, both typechecks, and parent review passed.
- PR #3928 carries the functional candidate. Final ReviewGPT and exact-head required CI remain the completion gates after the stable push. Human merge and canonical production release remain separate; this sweep does not authorize either for this functional fix.
Completed: 2026-09-30
