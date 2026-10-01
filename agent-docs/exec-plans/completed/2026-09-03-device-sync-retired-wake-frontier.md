# Retired device-sync wake frontier remediation

Status: completed
Created: 2026-09-03
Updated: 2026-09-03

## Goal

- Correct PR #2779 so only the exact first unhandled, runtime-imported scheduled
  device-sync wake can reuse its existing runtime retry after payload
  retention, then complete review, CI, and merge.

## Success criteria

- A retired scheduled wake is accepted only when its lane sequence equals the
  canonical handled frontier plus one and the existing import/high-water,
  structural, and privacy checks also pass.
- A skipped retired wake behind an earlier pending blocker remains a visible
  dedupe conflict even when a later live item advanced the imported watermark.
- Positive and negative PostgreSQL proofs, focused suites, lint, typecheck,
  ReviewGPT, and required GitHub checks pass before merge.
- The merged PR leaves no active task worktree.

## Scope

- In scope: the accepted ReviewGPT frontier finding, focused regression proof,
  protocol wording, PR evidence, exact-head review/CI, merge, and worktree
  retirement.
- Out of scope: new persisted state, per-item import receipts, retention timing,
  generic mailbox dedupe, runtime scheduling, and unrelated device-sync work.

## Constraints

- Technical constraints: reuse the existing contiguous handled frontier; add no
  schema, queue, state owner, background process, or compatibility layer.
- Product/process constraints: preserve content deletion, fail closed when
  per-item runtime ownership is not provable, keep foreground replies
  unaffected, and preserve the immutable first-reviewed head.

## Risks and mitigations

1. Risk: lane-wide import progress can be misattributed to a skipped retired
   item.
   Mitigation: require the target to be exactly `consumed_seq + 1` and cover
   the three-item blocker/target/successor shape.
2. Risk: a corrective predicate could reject a legitimate imported target when
   later items were also imported.
   Mitigation: cover target sequence two with consumed sequence one and
   imported sequence three as a positive case.

## Tasks

1. Completed: validate ReviewGPT's finding against projection fast-forward,
   runtime pending-state, and checkpoint behavior.
2. Completed: replace the broad pending-range inference with the contiguous
   frontier relation and add direct regression coverage and protocol wording.
3. Completed: rerun focused PostgreSQL/unit/recovery/changelog checks, ESLint,
   typecheck, complexity, diff, and privacy checks.
4. Completed: push the round-2 candidate and run ReviewGPT concurrently with
   required CI.
5. Completed: replace aggregate ownership inference with the runtime-owned
   exact first-pending sequence and add the composed legacy regression required
   by the recorded round-2 retrospective.
6. Completed: commit and push the verified redesigned candidate, then resolve
   ReviewGPT round 3 and exact-head CI.
7. Ready: merge the reviewed, green candidate and retire the task worktree.

## Decisions

- Accept the ReviewGPT finding: import and handled watermarks describe different
  facts, so only their exact contiguous frontier relation proves this target.
- Prefer one stricter SQL equality and focused tests over new per-item state or
  another recovery owner.
- Round-2 retrospective: the contiguous equality still inferred item ownership
  from aggregate watermarks when legacy unsequenced pending work held the
  handled frontier at zero. Keep that legacy state supported but fail closed
  while it is ambiguous. Project the exact first pending sequenced item from the
  existing runtime state owner through the existing checkpoint, with no new
  schema, state owner, receipt set, queue, or repair path.

## Verification

- Passed locally: 12-case scheduled-retention PostgreSQL proof; 278 surrounding
  Web device-sync, mailbox, and recovery tests; 69 runtime import, checkpoint,
  and pending-state tests; 59 changelog tests; focused ESLint; Web typecheck;
  `pnpm complexity:diff`; `git diff --check`; and the privacy scan.
- ReviewGPT round 2 returned `RETROSPECTIVE_REQUIRED`; its repeated aggregate
  inference finding was accepted and the requirement-level redesign decision
  was recorded on the PR.
- Redesigned proof passed: 15 PostgreSQL retention cases; 70 runtime mailbox
  state, import, and checkpoint tests; 279 surrounding Web wake, mailbox, and
  recovery tests; 59 changelog tests; Web and assistant-runtime typechecks;
  focused Web ESLint; `pnpm complexity:diff`; `git diff --check`; and the
  privacy scan.
- ReviewGPT round 3 returned `ROUND_OUTCOME: PASS` on the exact production
  candidate. Subsequent changes were limited to test expectations and base
  alignment; no production source changed after the reviewed head.
- All 33 applicable required GitHub checks passed on the merge candidate,
  including the exact public/private Temporal reader proof. The initial
  compatibility failure was caused by a temporary cross-repository CI wire
  mismatch and passed unchanged after the private contract repair merged.
- Expected outcomes: the safe contiguous case is accepted without another
  signal; the skipped-middle case stays a conflict; every completion gate is
  green on the merge candidate.

## Results

- Runtime checkpoints now expose the exact first pending sequenced system item
  from the existing system-mailbox state owner; legacy unsequenced work makes
  that ownership fact unknown and therefore fail-closed.
- Web accepts a retired scheduled wake only when that exact runtime-owned
  sequence also satisfies the existing contiguous frontier, imported
  watermark, high-water, structure, and privacy proofs.
- Focused PostgreSQL and runtime regressions prove the retained positive cases,
  the skipped-middle negative case, and the legacy fast-forward ambiguity
  without restoring private payload content or creating another retry owner.
Completed: 2026-09-03
