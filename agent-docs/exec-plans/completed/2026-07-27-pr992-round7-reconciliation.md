# PR 992 latest-base reconciliation and ReviewGPT round 7

Status: completed
Created: 2026-07-27
Updated: 2026-07-27

## Goal

- Reconcile PR #992 with the latest `origin/main`, preserve the reviewed usage
  referral and bounded dirty-runtime completion behavior, verify the exact
  merged head, and prepare it for the explicitly authorized ReviewGPT round 7.

## Success criteria

- Latest `origin/main` is incorporated through an ordinary merge with no
  unresolved conflicts or lost base/PR behavior.
- Conflict-specific proof and the canonical verification lane pass on the exact
  merged head.
- The reconciled head is ready to push for concurrent exact-head CI and
  ReviewGPT round 7 under the repository's post-plan final-gate loop.

## Scope

- In scope: merge the latest base; resolve and verify manual conflicts; inspect
  auto-merged overlaps in directly affected paths; push the reconciled head;
  run and resolve the authorized round-7 correction-verification gate.
- Out of scope: unrelated feature work, a new referral/runtime state owner,
  deployment, or cleanup of unrelated branches, plans, and worktrees.

## Constraints

- Preserve the existing mailbox, referral row, usage ledger, outbox, and idle
  checkpoint owners.
- Keep generic notifications and unrelated outbox work checkpoint-gated.
- Keep the immutable ReviewGPT first-reviewed baseline unchanged.
- Preserve unrelated working-tree and coordination-ledger work.

## Risks and mitigations

1. A textual choice could silently discard a newer base invariant or the PR's
   bounded pre-checkpoint exception.
   Mitigation: inspect merge base, both conflict stages, adjacent callers, and
   focused regressions before resolving each hunk.
2. A clean-looking merge could widen completion dispatch beyond the exact safe
   families.
   Mitigation: rerun the exact-family selector, causal-intent, replay, and
   runtime-entrypoint proof.
3. A seventh review round could reset prior lineage or reopen unchanged work for
   novelty.
   Mitigation: retain the immutable first head, use round 6 as the previous
   reviewed head, and package only the correction delta plus directly affected
   paths under the repository review loop.

## Tasks

1. Merge latest `origin/main` and resolve conflicts from code-path evidence.
2. Run focused and canonical verification; close this plan and push the exact
   reconciled head.
3. Close the reconciliation plan so ReviewGPT round 7 can run concurrently with
   exact-head CI under the repository's post-plan final-gate loop.

## Verification

- `git diff --name-only --diff-filter=U` — passed; no unresolved merge paths.
- `git diff --cached --check` before the merge commit — passed.
- Repository conflict-marker scan — passed.
- Focused Assistant Engine Vitest proof — passed, 74 tests.
- Focused Web Linq/Telegram ingress and referral proof — passed, 87 tests.
- Focused Assistant Runtime proof reached 236 passing tests, then 9
  real-time-deadline failures while the shared host had a load average above
  100. Two isolated retries stopped inside first-phase fixture setup before the
  wake decision, confirming the local result is not usable behavior evidence.
- Canonical Crabbox dispatch was attempted after staging all intentional source,
  but the installed direct Blacksmith provider rejected the repository
  dispatcher's `--stop-after` argument before provisioning or executing tests.
  Exact-head GitHub CI is therefore the next-best isolated verification and
  must be green alongside round 7.

## Decisions

- The user explicitly authorized substantive ReviewGPT round 7 after the
  existing cap retrospective. The immutable first-reviewed head remains
  `d55abffba0885a513aecf0c886b9fab34bbdd6d2`.
- Round 6 reviewed `4c18c9921f`; its later `b4c3280ffd` remediation head was
  not itself reviewed, so round 7 uses the full `4c18c9921f` commit as the
  previous-reviewed-head lineage value.
- The sole textual conflict was additive security policy. The resolution keeps
  both latest-main's authenticated aggregate-activity member attribution rule
  and this PR's current-sender-bound referral authority rule.
- Latest-main's async image completion controller and provider-authenticated
  sender attribution remain intact beside the PR's exact phone-result and
  referral-reward pre-checkpoint admission. No new owner, queue, or compatibility
  path was added during reconciliation.
Completed: 2026-07-27
