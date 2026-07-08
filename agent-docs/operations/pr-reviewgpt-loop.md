# PR ReviewGPT Loop

Last verified: 2026-07-07

Required post-completion ReviewGPT loop for non-trivial PR-lane work. It runs
the repo-local `pr-review` preset through `pnpm review:gpt`, using the Eragon
managed browser profile by default. It does **not** run the local Codex
`deep-review` pass.

For PR-lane patch implementation, this loop is the audit gate: the worktree /
PR-lane skip in `agent-docs/operations/completion-workflow.md` lets the parent
agent default-skip the individual local required audit subagent passes and rely
on this consolidated ReviewGPT loop. For current-checkout work it stays
additive and does not satisfy, replace, or reorder the local required
completion audits in that document.

For non-trivial PR-lane work, do not call the PR good to merge until this loop
has reached zero accepted findings and PR CI is green on the final head.

## When It Runs

Run the loop when all of the following hold:

1. The task used the worktree/PR lane and a PR is open.
2. The routed completion workflow has completed and the scoped commit is pushed.
3. The user has not explicitly opted out in the current task.

The review target is the pushed PR head. Run the loop from a clean checkout or
worktree of the PR branch at that pushed head so ReviewGPT artifacts, CI, and
merge target all refer to the same commit. Do not run it on unpushed local
changes, a dirty worktree, or a checkout that is not at the pushed head.

The PR body must carry the intent contract from
`agent-docs/operations/completion-workflow.md` § PR Description: why the PR
exists, the user-visible goal it is meant to ship, and invariants to preserve.
Before firing a round, confirm that block is present and current.

Fire each round as soon as the head it reviews is pushed. Do not wait for PR CI
to go green first. CI and the review round run in parallel; green CI on the
final head remains a separate merge-readiness gate.

Skip it only for docs/process-only PRs, trivial copy-only changes, or explicit
current-task user opt-out.

## One Round

1. Verify the local checkout is the pushed PR head:

   ```bash
   scripts/review-gpt-pr-head-preflight.sh <pr-url-or-number>
   ```

2. Run ReviewGPT with the PR preset and Eragon browser profile. Pass the PR ref
   through `REVIEW_GPT_PR_URL` so `scripts/package-audit-context-full.sh` adds
   `review-gpt-pr-context/pr.diff` and `changed-files.txt` to the guarded
   source snapshot. Capture the response in an uncommitted `audit-packages/`
   artifact and require the preset's `REVIEW_COMPLETE` marker before treating
   the round as complete:

   ```bash
   REVIEW_GPT_PR_URL=<pr-url-or-number> \
     pnpm review:gpt pr-review \
       --wait \
       --wait-timeout 120m \
       --response-marker REVIEW_COMPLETE \
       --response-file audit-packages/pr-<number>-round-<k>.md \
       --prompt "Review target: <pr-url-or-number>. Checked commit: $(git rev-parse --short HEAD). Use the PR body as the intent contract."
   ```

   The repo wrapper defaults this command to the Eragon managed browser profile
   (`Eragon.app`, CDP port `9448`, profile `Default`) and `app_connector=current`
   so review context comes from the guarded ZIP and repomix attachments, not a
   ChatGPT connector.

3. Confirm the captured output is an actual completed review before triaging
   it. If the run dies, times out, leaves an empty/preliminary file, lacks
   `REVIEW_COMPLETE`, or reports missing/unreadable ZIP or repomix artifacts,
   the round does not count. Rerun it against the same pushed head after fixing
   the concrete tooling/profile problem.

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
   count; fix CI, and only changes that alter code beyond the reviewed diff
   require a fresh round.

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
- Hard cap: 10 rounds per PR. If the cap is hit with accepted findings still
  landing each round, stop and report that the PR likely needs structural
  rework rather than more review rounds.
- Report a per-round summary at handoff: findings received, accepted, rejected
  with reasons, and what landed.

## Boundaries

- For current-checkout work, never use this loop to satisfy local required
  completion audits; see `agent-docs/operations/completion-workflow.md`.
- Do not use local Codex `deep-review`, Codex subagents, pasted text, connector
  context, dirty-worktree context, ad hoc archives, or a non-Eragon browser
  profile for this PR gate unless the current user task explicitly changes the
  route.
- Response files under `audit-packages/` are local working artifacts and stay
  uncommitted.
- The `pr-review` prompt lives at
  `scripts/chatgpt-review-presets/pr-deep-review.md`; despite the historical
  filename, it is the ReviewGPT PR-review prompt used by this loop.
