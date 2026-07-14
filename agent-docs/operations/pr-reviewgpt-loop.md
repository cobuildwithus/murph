# PR ReviewGPT Loop

Last verified: 2026-07-14

Required post-completion ReviewGPT loop for ReviewGPT-eligible PR-lane work. It runs
the repo-local `pr-review` preset through `pnpm review:gpt`, using one of the
managed ReviewGPT browser lanes. The repo config chooses randomly among usable
Eragon, Phlebas, and Mountain lanes by default so PR-review load is spread
across signed-in browser profiles without selecting a profile that is already
locked without remote debugging. It does **not** run the local Codex
`deep-review` pass.

For PR-lane patch implementation, this loop is the final cross-cutting audit
gate and replaces the default local `deep-review` pass. It does not replace the
specialist `prompt-review`, `security-privacy-review`, `frontend-review`, or
write-capable `coverage-write` passes triggered by
`agent-docs/operations/completion-workflow.md`. For current-checkout work it is
additive and does not satisfy, replace, or reorder any required local pass.

For ReviewGPT-eligible PR-lane work, do not call the PR good to merge until this loop
has reached zero accepted findings and PR CI is green on the final head.

## Outcome and Completion Bar

Certify the exact pushed PR patch against its stated user outcome and repository
invariants using the guarded repository snapshot. The gate completes when the
current PR-specific patch has zero accepted findings after local triage and CI is
green on the final head. Missing or stale evidence, an invalid model/response,
unresolved accepted findings, or a merge conflict is a stop condition rather
than permission to infer the answer.

## Managed Target Lifecycle

ReviewGPT creates one fresh background ChatGPT target for each run. A waited
run owns that target for response capture and must close that exact target when
capture completes, times out, fails, or yields to a retry. A successful
draft-only or send-without-wait run intentionally retains its target because
the prepared draft or conversation is the user-facing result. Never implement
this cleanup as a profile-wide tab sweep or close a target that the current run
did not create.

This ownership rule is required because the managed browser lanes disable
background throttling and ReviewGPT pins the capture page lifecycle active.
Leaving completed waited targets open accumulates active renderers across
rounds even when ordinary browser history and site data have been cleared.

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

Fire each round as soon as the head it reviews is pushed. Do not wait for PR CI
to go green first. CI and the review round run in parallel; green CI on the
final head remains a separate merge-readiness gate.

Skip it for docs/process-only PRs, prompt-primary PRs, trivial copy-only
changes, other low-risk changes that satisfy
`agent-docs/operations/completion-workflow.md` § ReviewGPT Eligibility, or
explicit current-task user opt-out. Prompt-primary PRs use the local
`prompt-review` pass instead; run ReviewGPT only when non-prompt scope
independently requires it or the current user explicitly asks for the loop.

## One Round

1. Verify the local checkout is the pushed PR head:

   ```bash
   scripts/review-gpt-pr-head-preflight.sh <pr-url-or-number>
   ```

2. Run ReviewGPT with the PR preset and the default randomized usable managed
   browser lane. Pass the PR ref through `REVIEW_GPT_PR_URL` so
   `scripts/package-audit-context-full.sh` adds
   `review-gpt-pr-context/pr.diff` and `changed-files.txt` to the guarded
   `codebase.zip` source snapshot. Capture the response in an uncommitted
   `audit-packages/` artifact and require the preset's `REVIEW_COMPLETE` marker
   before treating the round as complete:

   ```bash
   REVIEW_GPT_PR_URL=<pr-url-or-number> \
     pnpm review:gpt pr-review \
       --wait \
       --wait-timeout 120m \
       --response-marker REVIEW_COMPLETE \
       --response-file audit-packages/pr-<number>-round-<k>.md \
       --prompt "Review target: <pr-url-or-number>. Checked commit: $(git rev-parse --short HEAD). Use the PR body as the intent contract."
   ```

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

   Treat a suspiciously fast turnaround as a warning that requires checking the
   exact-turn, completion-marker, attachment, and model evidence. Elapsed time
   alone does not invalidate a round. If those checks show a different or
   downgraded model, incomplete response, or missing snapshot, discard the round,
   correct the profile or invocation, and rerun against the same pushed head. If
   only one lane is healthy, pin it with `REVIEW_GPT_BROWSER_LANE` and note the
   temporary override in handoff.

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
   clients already contain the legacy shape. If the answer is no, reject the
   finding as speculative or handle it with a deployment note; do not add repair
   paths, migrations, shims, queues, or reconciliation code for rows or deployed
   versions that do not exist.

5. Fix only accepted findings after the reproduction/proof above is in place,
   run the verification required by
   `agent-docs/operations/verification-and-runtime.md` for the touched owners,
   and push to the PR branch.

6. Fire the next round immediately after that push, in parallel with the new CI
   run. If CI later fails on a head a round reviewed, the round's findings still
   count. Fix CI and run a fresh round whenever the PR-specific patch changes,
   including code, tests, config, durable docs, or manual conflict resolution.

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

- Stop when a round produces zero accepted findings after local triage.
- Hard cap: 15 rounds per PR. If the cap is hit with accepted findings still
  landing each round, stop and report that the PR likely needs structural
  rework rather than more review rounds.
- Report a per-round summary at handoff: findings received, accepted, rejected
  with reasons, and what landed.

## Boundaries

- For current-checkout work, never use this loop to satisfy local required
  completion audits; see `agent-docs/operations/completion-workflow.md`.
- Do not use local Codex `deep-review`, Codex subagents, pasted text, connector
  context, dirty-worktree context, ad hoc archives, or an unmanaged/non-ReviewGPT
  browser profile for this PR gate unless the current user task explicitly
  changes the route.
- Do not commit each ReviewGPT round as a Markdown document. Response files
  under `audit-packages/` are local working artifacts and stay uncommitted.
  Agents may instead post a concise PR comment as each round is resolved,
  stating what they fixed and why; these comments are optional.
- The `pr-review` prompt lives at
  `scripts/chatgpt-review-presets/pr-deep-review.md`; despite the historical
  filename, it is the ReviewGPT PR-review prompt used by this loop.
