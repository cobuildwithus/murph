# PR ReviewGPT Loop

Last verified: 2026-07-14

Required post-completion ReviewGPT loop for ReviewGPT-eligible PR-lane work. It runs
the repo-local `pr-review` preset through `pnpm review:gpt`, using one of the
managed ReviewGPT browser lanes. The repo config chooses randomly among usable
Eragon, Phlebas, and Mountain lanes by default so PR-review load is spread
across signed-in browser profiles without selecting a profile that is already
locked without remote debugging. It does **not** run the local Codex
`deep-review` pass.

For PR-lane patch implementation, this loop is the sole cross-cutting audit
gate and replaces local `deep-review`. Never run both for the same completed
change, including when the change is complex, sensitive, or the user asks for a
final bug hunt. This loop does not replace the specialist `prompt-review`,
`frontend-review`, or write-capable `coverage-write` passes triggered by
`agent-docs/operations/completion-workflow.md`.

For ReviewGPT-eligible PR-lane work, do not call the PR good to merge until the
latest substantive round returns `ROUND_OUTCOME: PASS`, local triage has zero
accepted findings, and PR CI is green on the final head. A completed anomaly
retrospective may justify continuing the same PR, but it never substitutes for
a later `PASS` on the resulting patch.

## Outcome and Completion Bar

Certify the exact pushed PR patch against its stated user outcome and repository
invariants using the guarded repository snapshot. Round 1 is the only full-patch
audit. Later substantive rounds verify the remediation delta and its directly
affected paths; they do not reopen unchanged code for novelty. The gate
completes when the exact patch receives `ROUND_OUTCOME: PASS`, local triage has
zero accepted findings, and CI is green on the final head. Missing or stale
evidence, an invalid model/response, unresolved accepted findings, a required
retrospective, or a merge conflict is a stop condition rather than permission
to infer the answer.

## Managed Target Lifecycle

ReviewGPT creates one fresh background ChatGPT target for each run. A waited
run owns that target for response capture and must close that exact target when
capture completes, times out, fails, or yields to a retry. A successful
draft-only or send-without-wait run intentionally retains its target because
the prepared draft or conversation is the user-facing result. Never implement
this cleanup as a profile-wide tab sweep or close a target that the current run
did not create.

This ownership rule is required because the managed browser lanes keep
background response-polling timers reliable and ReviewGPT pins only the owned
capture page lifecycle active, then releases emulated focus before retaining or
closing that target. The Murph lanes use balanced background mode so Chromium
can still deprioritize unrelated renderers and occluded windows; use the fully
unthrottled fallback only for a browser version with a proven capture stall.
Leaving completed waited targets open still accumulates active renderers across
rounds even when ordinary browser history and site data have been cleared.

Changing the launch mode does not reconfigure a browser process that is already
running. Never restart a shared lane merely to apply this setting while it has
pending reviews; let the new flags take effect on the lane's next normal
restart.

## When It Runs

Run the loop when all of the following hold:

1. The task used the worktree/PR lane and a PR is open.
2. The routed work is ReviewGPT-eligible rather than docs/process-only,
   prompt-primary, or trivial copy-only.
3. The routed completion workflow has completed and the scoped commit is pushed.
4. The user has not explicitly opted out in the current task.

The review target is the pushed PR head. Run the loop from a clean checkout or
worktree of the PR branch at that pushed head so ReviewGPT artifacts, CI, and
merge target all refer to the same commit. Do not run it on unpushed local
changes, a dirty worktree, or a checkout that is not at the pushed head.

The PR body must carry the intent contract, applicable UX outline, and change-shape breakdown from
`agent-docs/operations/completion-workflow.md` § PR Description: why the PR
exists, the user-visible goal and flow it is meant to ship, invariants to
preserve, non-obvious affected surfaces, and added/deleted lines by source,
tests, docs, config/tooling, and generated/other.
Before firing a round, confirm that block is present and current.

At round 1, also record the exact first-reviewed head and its five-category
change shape in the PR body. Include the exact machine-readable line
`ReviewGPT first-reviewed head: <full-sha>`. Keep that line and baseline
immutable. The packager fails if its supplied first head differs from this
persisted PR-body value. On later substantive rounds, update a separate
current-head table and state the authored-source growth caused by review
remediation. Base movement, generated churn, and file moves may explain counts,
but they do not erase or reset the first-reviewed baseline.

Fire each round as soon as the head it reviews is pushed. Do not wait for PR CI
to go green first. CI and the review round run in parallel; green CI on the
final head remains a separate merge-readiness gate.

Skip it for docs/process-only PRs, prompt-primary PRs, trivial copy-only
changes, other low-risk changes that satisfy
`agent-docs/operations/completion-workflow.md` § ReviewGPT Eligibility, or
explicit current-task user opt-out. If ReviewGPT is opted out and the
cross-cutting trigger still applies, route to local `deep-review` instead;
never run both. Prompt-primary PRs use the local `prompt-review` pass instead;
run ReviewGPT only when non-prompt scope independently requires it or the
current user explicitly asks for the loop.

## One Round

1. Verify the local checkout is the pushed PR head:

   ```bash
   scripts/review-gpt-pr-head-preflight.sh <pr-url-or-number>
   ```

2. Run ReviewGPT with the PR preset and the default randomized usable managed
   browser lane. Pass the PR ref and substantive round through
   `REVIEW_GPT_PR_URL` and `REVIEW_GPT_ROUND_NUMBER`. The packager adds the full
   PR body, current patch, exact round metadata, and the delta from the previous
   reviewed head to the guarded `codebase.zip` source snapshot:

   - `review-gpt-pr-context/pr-body.md`
   - `review-gpt-pr-context/pr.diff`
   - `review-gpt-pr-context/changed-files.txt`
   - `review-gpt-pr-context/review-round.json`
   - `review-gpt-pr-context/since-first-reviewed-head.diff`
   - `review-gpt-pr-context/since-previous-reviewed-head.diff`

   Round 1 defaults `REVIEW_GPT_FIRST_REVIEWED_HEAD` to the current PR head and
   leaves the remediation delta empty. For round 2 or later, preserve the
   original first-reviewed head and provide both it and the immediately previous
   reviewed head:

   ```bash
   REVIEW_GPT_PR_URL=<pr-url-or-number> \
   REVIEW_GPT_ROUND_NUMBER=1 \
     pnpm review:gpt pr-review \
       --wait \
       --wait-timeout 120m \
       --response-marker REVIEW_COMPLETE \
       --response-file audit-packages/pr-<number>-round-<k>.md \
       --prompt "Review target: <pr-url-or-number>. Checked commit: $(git rev-parse --short HEAD). First-reviewed head: $(git rev-parse HEAD). Round 1 full-patch audit. Use the PR body as the intent contract and immutable first-review change-shape baseline."
   ```

   ```bash
   REVIEW_GPT_PR_URL=<pr-url-or-number> \
   REVIEW_GPT_ROUND_NUMBER=<k> \
   REVIEW_GPT_FIRST_REVIEWED_HEAD=<round-1-full-sha> \
   REVIEW_GPT_PREVIOUS_REVIEWED_HEAD=<round-k-minus-1-full-sha> \
     pnpm review:gpt pr-review \
       --wait \
       --wait-timeout 120m \
       --response-marker REVIEW_COMPLETE \
       --response-file audit-packages/pr-<number>-round-<k>.md \
       --prompt "Review target: <pr-url-or-number>. Checked commit: $(git rev-parse --short HEAD). First-reviewed head: <round-1-full-sha>. Correction-verification round <k>. Prior findings, dispositions, landed fixes, and mechanisms: <compact-summary>. Retrospective status: <not-required-or-current-decision>."
   ```

   The later-round summary is required process metadata. Include each prior
   finding's accepted/rejected/out-of-scope disposition, the landed correction,
   and its underlying mechanism. Keep it compact and secret-safe; do not paste
   repository contents. If a completed retrospective permits continuation, name
   its decision and why the current delta stays inside it.

   The repo wrapper chooses one usable ReviewGPT browser lane per run:
   `Eragon.app` on CDP port `9448`, `Phlebas.app` on `9442`, or
   `Mountain.app` on `9450`, always with profile `Default` and
   `app_connector=current` so review context comes from the guarded ZIP and
   not a ChatGPT connector. ReviewGPT attaches that snapshot as
   `codebase.zip`; Repomix is disabled by default and is not part of this flow.

   A lane is considered usable when its managed profile is unlocked, or when its
   configured CDP endpoint is already alive. The default random path skips a
   profile that has a stale or GUI-held `SingletonLock` and no live CDP endpoint;
   an explicit `REVIEW_GPT_BROWSER_LANE` pin still targets that lane directly
   and fails loudly if the profile needs operator cleanup.

   The wrapper requests the configured Pro review model on the selected lane.
   If ChatGPT reports that the selected lane has reached its model limit, rerun
   the same round on a different lane with `REVIEW_GPT_BROWSER_LANE` instead of
   downgrading the model.

   To pin a specific lane while recovering or debugging one profile, set
   `REVIEW_GPT_BROWSER_LANE=eragon|phlebas|mountain` on that command.
   `aragon` is accepted as an alias for `eragon`. Leave it unset for normal
   PR-review rounds.

3. Confirm the captured output is an actual completed review before triaging
   it. If the run leaves an empty/preliminary response, lacks
   `REVIEW_COMPLETE`, or reports a missing/unreadable `codebase.zip`, the round
   does not count. A response that passed exact-turn and completion checks does
   count even when optional model-evidence persistence or bounded owned-target
   cleanup later emits a warning; those post-completion diagnostics must never
   relaunch the model audit. Fix a concrete pre-completion tooling/profile
   failure before considering another run against the same pushed head.

   Verify `review-round.json` names the intended round, first-reviewed head,
   previous reviewed head, and current pushed head. Round 1 must have `full`
   scope and empty cumulative and immediate remediation deltas; later rounds
   must have `correction` scope, a previous head different from the current
   head, and `true` first/previous ancestry. The packaged first head must match
   the immutable PR-body line and the invocation. Missing, mismatched,
   unavailable, or non-ancestral baseline evidence invalidates the run; restore
   or reconstruct the lineage before retrying the same substantive round.

   A response with `ROUND_OUTCOME: INVALID` does not count as a substantive
   round. Correct its evidence or invocation gap and retry the same round number
   against the same pushed head.

   Treat a suspiciously fast turnaround as a warning that requires checking the
   exact-turn, completion-marker, attachment, and model evidence. Elapsed time
   alone does not invalidate a round. If those checks show a different or
   downgraded model, incomplete response, or missing snapshot, discard the round,
   correct the profile or invocation, and retry the same substantive round
   number against the same pushed head. Browser, model, capture, and attachment
   retries never advance the round counter. If only one lane is healthy, pin it
   with `REVIEW_GPT_BROWSER_LANE` and note the temporary override in handoff.

4. Triage every finding locally before fixing:
   - **Accepted bug/edge case**: confirm the issue through a
     production-faithful path before fixing. Use the closest actual runtime
     boundary for the touched surface: hosted-local scenario, app route flow,
     built CLI path, package integration path, or another owner lane that
     exercises production code rather than a bespoke mock. Keep the
     reproduction as committed regression coverage when the owner has a
     suitable lane.
   - **Accepted simplification**: accept only when the change removes more
     complexity than it adds and has direct proof that required behavior and
     invariants are preserved.
   - **Accepted purpose drift**: first prove whether the non-obvious surface is
     necessary for the PR outcome. Delete it or split it into a separate PR when
     it is unnecessary. When it is necessary but undisclosed, update the PR
     intent contract with the reason and regression proof before the next
     review round. Disclosure alone does not cure unnecessary scope.
   - **Rejected**: wrong, already handled, speculative, not worth the added
     complexity, or missing the required reproduction/proof. Note the reason.

   In round 2 or later, accept a reported bug only when the remediation delta
   introduced it or made it materially worse. A serious issue in unchanged
   original PR work triggers the retrospective path; a pre-existing or adjacent
   issue belongs outside this PR unless the stated outcome cannot ship without
   resolving it. A claimed correction that fails to resolve its prior accepted
   finding counts as review-induced and must be corrected before `PASS`.

   ReviewGPT findings are adversarial signals, not implementation instructions.
   Before accepting a finding, identify the invariant it protects and any
   product-critical flow it could break. Follow
   `docs/contracts/00-invariants.md` § Product-Critical Flow Preservation.

   Before accepting any fix that broadens architecture, run the architecture
   pressure check explicitly: can the invariant be preserved by deleting code,
   reordering existing durable writes, tightening an existing owner boundary,
   deriving from one existing source of truth, or adding focused coverage around
   the existing primitive? Reject, defer, or redesign findings whose cure adds a
   new durable state owner, index, lifecycle enum, queue, transaction layer,
   reconciliation loop, policy manager, or abstraction without production-path
   proof that the simpler owner-boundary fix is insufficient.

   For deploy-skew or legacy-compatibility findings, first prove that the
   incompatible state can actually exist outside the current PR branch before
   adding compatibility machinery. Check whether the feature or producer has
   already shipped, whether old consumers/producers can still run during the
   proposed rollout or rollback window, and whether production data or external
   clients already contain the legacy shape. Quantify the actual rollout window,
   current member/event volume, maximum exposed operations, reversibility, and
   available monitoring or manual repair; do not assume future scale. If the
   answer is no, or the only demonstrated risk is a rare reversible miss for one
   or a few members during a short rollout, reject the finding as speculative or
   handle it with a deployment note. First try deleting the rollout seam or
   changing deployment order; do not add replay, backfill, repair paths,
   migrations, shims, dual writes, queues, capability negotiation, or
   reconciliation for a low-incidence temporary window.

5. Before another tactical fix, run the anomaly retrospective when any of these
   is true:

   - authored-source churn reaches 2,000 lines; 3,000 lines is a strong red flag
     that requires an explicit indivisible-large-feature rationale;
   - review remediation has added at least 500 authored-source lines and grown
     source additions by at least 25 percent from the first-reviewed head;
   - the next run would be substantive round 3 or later;
   - the same underlying mechanism produced an accepted finding in the previous
     round; or
   - the proposed cure adds a new owner, state machine, queue, lease, fence,
     lifecycle, compatibility path, migration, repair pass, or reconciliation
     mechanism.

   Source churn means authored-source additions plus deletions; tests, fixtures,
   docs, config/tooling, and generated files stay separate. The retrospective is
   not an automatic merge rejection and does not presume structural rework.
   Restate the original requirement, compare the first reviewed and current
   shapes, attribute review-driven growth and repeated mechanisms, and choose
   deletion, reverting review machinery, shrinking, splitting, redesigning, or
   explicitly justified continuation. Record the decision in the PR body or a
   concise PR comment and carry it in later-round metadata. Never reset the
   first-reviewed baseline.

6. Fix only accepted findings after the reproduction/proof or required
   retrospective is in place. A Complexity Collapse correction must yield net
   deletion or remove concrete concepts/owners without replacement machinery.
   Run the verification required by
   `agent-docs/operations/verification-and-runtime.md` for the touched owners,
   update the current change-shape table, and push to the PR branch.

7. Fire a correction-verification round immediately after a pushed accepted fix
   changes production source, runtime config, schema, behavior, or manual
   conflict resolution. Run it in parallel with the new CI run. If CI later
   fails on a reviewed head, the round's findings still count.

   Isolated regression-test additions, PR-body updates, finding-disposition
   comments, and explanatory durable-doc edits do not create a new substantive
   ReviewGPT round when they do not change production behavior, runtime config,
   schema, or the implemented contract. Run their focused verification and CI
   instead. If such a change does alter the implemented contract or executable
   behavior, use the ordinary next-round rule.

   One narrow exception closes a disclosure-only finding: when every other
   accepted finding is resolved and ReviewGPT accepted necessary-but-undisclosed
   Purpose Drift as the only remaining issue, update `Non-obvious affected
   surfaces` and retry the same substantive round number against the same pushed
   head. Keep the original round metadata and state in the invocation that this
   is a disclosure-only verification retry, naming the prior finding and the
   corrected reason and regression proof. The retry verifies only that corrected
   intent contract against the already-reviewed patch; it does not reopen the
   patch, advance the substantive-round counter, or reset the first-reviewed
   baseline. The retry must still return `ROUND_OUTCOME: PASS` before the gate is
   complete.

## Base-Update-Only Exception

If a round has already reached zero accepted findings and the PR later needs to
be updated only because the base branch moved, do not start another ReviewGPT
round just for that base update.

This exception applies only when the post-review change is a normal merge or
rebase of the PR base branch with no manual conflict resolution, new feature
work, review finding fix, or behavior/test/config/doc edit beyond the base
update itself. After the update, the merge path only needs PR CI green on the
new head.

If the base update requires manual conflict resolution or any non-base-update
change, treat that as a normal PR-head change: run required verification for
the touched surface, push it, and use the ordinary review-loop rules.

## Stop Condition

- Stop when the exact current patch returns `ROUND_OUTCOME: PASS` and local
  triage produces zero accepted findings.
- `ROUND_OUTCOME: INVALID` is an evidence/invocation failure. It does not advance
  the round counter; correct the gap and retry the same substantive round.
- `ROUND_OUTCOME: RETROSPECTIVE_REQUIRED` pauses tactical remediation until the
  requirement-level retrospective is recorded. It is not a structural verdict.
- Hard cap: 5 rounds per PR. There is no automatic sixth substantive round. An
  accepted round-five finding may still be reproduced and fixed; do not leave a
  known bug in place merely because the review counter reached five. After that
  fix, pause the ReviewGPT loop and make every other required specialist audit,
  parent final review, verification check, and PR CI job green. Record the cap
  retrospective and obtain an explicit continuation decision before starting
  round six; the answer may be delete, revert, shrink, split, redesign,
  continue, or abandon. A green non-ReviewGPT gate does not make the PR
  merge-ready without the required later `PASS`.
- Report a per-round summary at handoff: findings received, accepted, rejected
  with reasons, origin/mechanism, what landed, source-shape movement, and any
  retrospective decision. Report tooling retries separately.

## Boundaries

- For current-checkout work, never use this loop to satisfy local required
  completion audits; see `agent-docs/operations/completion-workflow.md`.
- Do not run local Codex `deep-review` for a completed change that uses this PR
  gate. An explicit request for deep review or a final bug hunt is fulfilled by
  this cross-cutting ReviewGPT review and does not create a second pass.
- Do not use other Codex subagents, pasted text, connector context,
  dirty-worktree context, ad hoc archives, or an unmanaged/non-ReviewGPT browser
  profile for this PR gate.
- Do not commit each ReviewGPT round as a Markdown document. Response files
  under `audit-packages/` are local working artifacts and stay uncommitted.
  Agents may instead post a concise PR comment as each round is resolved,
  stating what they fixed and why; these comments are optional.
- The `pr-review` prompt lives at
  `scripts/chatgpt-review-presets/pr-deep-review.md`; despite the historical
  filename, it is the ReviewGPT PR-review prompt used by this loop.
