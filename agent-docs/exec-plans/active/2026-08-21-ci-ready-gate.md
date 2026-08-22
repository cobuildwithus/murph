# Gate expensive CI on final ready PR heads

Status: active
Created: 2026-08-21
Updated: 2026-08-21

## Goal

- Stop expensive PR CI from running on iterative draft heads. Admit the
  expensive native and required-check lanes once when a PR becomes a final
  ready candidate, while preserving exact-head proof and deliberate recovery.
- Reduce private native-iOS macOS spend by narrowing admission to actual native
  contract risk and preventing known repeat failure classes from being retried
  blindly.

## Success criteria

- New PRs created by repository-owned automation default to draft.
- Expensive PR workflows run for a non-draft `opened` candidate or a
  `ready_for_review` transition, not for ordinary `synchronize` iteration.
- A later head change cannot reuse the prior exact-head proof; the documented
  workflow returns the PR to the draft/ready cycle before another expensive run.
- Native iOS admission no longer selects every `apps/web/**` change and retains
  the trusted default-branch controller and protected-environment boundary.
- Infrastructure-only retry remains explicit and exact-head validated.
- The observed native-iOS failure population is grouped by privacy-safe failure
  code and the patch prevents automatic retries of a deterministic failing class.
- Focused workflow-contract tests, required exact-head CI, the preliminary
  specialist pass, and the final ReviewGPT gate pass with no unresolved finding.

## Scope

- In scope:
  - PR creation defaults owned by this repository.
  - Required and expensive public-repo PR workflow admission.
  - Native iOS/Android controller admission through the existing trusted owner.
  - Native iOS path selection, retry classification, focused tests, and durable
    verification/security/reliability documentation.
- Out of scope:
  - Changing provider credentials, protected GitHub Environments, or private
    native application behavior.
  - Moving public-repo standard-runner jobs solely to reduce billed spend; those
    jobs are currently discounted to zero.
  - New queues, databases, daemons, capacity services, or runner providers.
  - Mass-mutating existing open pull requests without a separate explicit
    operator decision.

## Constraints

- Technical constraints:
  - Required checks must prove the exact current PR head; a result from an older
    head is never reusable.
  - Candidate code must never receive native E2E, Stripe, Vercel, Privy,
    Junction, or cross-repository dispatch credentials.
  - Do not convert secret-bearing workflows to `pull_request_target`.
  - Keep the existing protected-main controller and single destructive native
    live slot unless evidence proves a simpler safe replacement.
- Product/process constraints:
  - ReviewGPT authors the initial implementation patch; the parent independently
    inspects, applies, verifies, and owns all final changes.
  - Preserve unrelated primary-checkout edits and all other active worktrees.
  - Prefer trigger deletion and narrower selection over new state machinery.

## Risks and mitigations

1. Risk: ready-only workflows leave a changed ready PR with stale green proof.
   Mitigation: exact-SHA required checks cannot carry to the new head; document
   and test the draft/ready reset path and never publish a pass for an old SHA.
2. Risk: automatic draft mutation widens GitHub write authority.
   Mitigation: prefer existing operator/agent draft controls and missing exact-head
   required checks; add mutation authority only if ReviewGPT proves it is both
   necessary and safely default-branch-owned.
3. Risk: narrower iOS paths miss a real hosted/native contract change.
   Mitigation: derive the allowlist from current controller inputs and durable
   owner boundaries, and lock it with focused positive and negative tests.
4. Risk: treating product failures as infrastructure failures creates paid loops.
   Mitigation: derive retry eligibility from the private workflow's existing
   closed failure-code contract and reject unknown or deterministic failures.

## Tasks

1. Inspect current workflows, PR creation owners, native controller tests, and
   privacy-safe August failure evidence on exact `origin/main`.
2. Ask ReviewGPT Pro to implement a scoped attachment-based patch with tests and
   durable documentation.
3. Inspect the complete artifact, apply only accepted paths, and make the
   smallest necessary parent-owned corrections.
4. Run focused workflow/script verification and review the complete diff.
5. Commit and push a draft PR, then run the preliminary specialist pass and
   final ReviewGPT round concurrently with required CI.
6. Resolve every accepted finding, close this plan with `scripts/finish-task`,
   prove current-base mergeability, and hand off the active PR/worktree.

## Decisions

- Use a task worktree from the exact fetched `origin/main`; the primary checkout
  is behind and contains an unrelated user edit.
- Treat this as a high-risk workflow/trust-boundary change with a final
  ReviewGPT gate.
- Do not mutate the current open-PR population as part of the patch.
- Accept the final round-one ordering finding: a successful observer receipt
  must attest that the synchronize payload itself was ready so delayed draft
  events cannot overwrite a newer Ready action on the same SHA.
- Accept the shared-retry finding: keep one Repo Hygiene retry owner and add the
  explicit `android_workflow_rerun` infrastructure reason used by the current
  Android status instead of making Android operators claim an iOS failure.
- Round-two anomaly retrospective: the revised Android recovery command moved
  the same delivery failure from the shared parser to GitHub's bounded commit
  status field. Shrink both status descriptions to the exact accepted commands,
  retain commit status as the one delivery surface and Repo Hygiene as the one
  retry owner, and enforce the provider bound in the existing shell tests. Add
  no new owner, queue, state, or recovery surface.

## Verification

- Commands to run:
  - Focused Node/Vitest workflow-contract tests selected after the patch paths
    are known.
  - Workflow YAML composition/parser proof used by the existing CI guards.
  - `pnpm test:diff <changed-paths...>` only when it is the smallest truthful
    local lane for the final workflow/tooling slice.
  - Exact-head required GitHub Actions, preliminary `completion-specialists`,
    final ReviewGPT, and `git merge-tree --write-tree` against current main.
- Expected outcomes:
  - Draft iteration creates no paid native dispatch.
  - One final-ready head creates at most one admitted native journey per PR,
    with explicit exact-head retry only for an allowlisted infrastructure class.
  - Non-native Web edits do not select native iOS E2E.
