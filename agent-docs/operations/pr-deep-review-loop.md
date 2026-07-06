# PR Deep-Review Loop

Last verified: 2026-07-06

Required post-completion deep-review loop that runs after the repo-required completion workflow, on PR-lane work. It runs on the **local Codex CLI** (Codex `gpt-5.5`), the same engine as the routed completion audit passes — not ReviewGPT, `review:gpt`, `cobuild-review-gpt`, an external ChatGPT thread, or any managed-browser/autosend/`thread wake` flow. ReviewGPT is retired for this loop as of 2026-07-06; do not route a round through it even as a fallback.

For PR-lane patch implementation, this loop is the audit gate: the worktree/PR-lane skip in `agent-docs/operations/completion-workflow.md` lets the parent agent default-skip the individual local required audit subagent passes and rely on this consolidated Codex deep-review loop to cover that surface. For current-checkout (non-PR-lane) work it stays additive — it does not satisfy, replace, or reorder the local required completion audits in that document, and those passes still run there.
For non-trivial PR-lane work, do not call the PR good to merge until this loop has passed.

## When It Runs

Run the loop when all of the following hold:

1. The task used the worktree/PR lane and a PR is open.
2. All routed completion audits passed and the scoped commit is pushed.
3. The user has not explicitly opted out in the current task.

The review target must be the pushed PR head. Run the loop against a clean checkout/worktree of the PR branch at the pushed head: Codex reads the working tree and computes the diff (`git diff origin/<base>...HEAD`) directly, so the review, CI, and merge target all refer to the same commit. Do not run it on unpushed local changes, a dirty worktree, or a checkout that is not at the pushed head. If the current fixes are only local, commit and push them to the PR branch first, then run the loop against the pushed head.

The PR body must carry the intent contract from `agent-docs/operations/completion-workflow.md` § PR Description (why the PR exists, the user-visible goal it is meant to ship, and invariants to preserve). Before firing a round, confirm that block is present and current — if it is missing or stale (for example the PR's intended behavior has shifted since the last round), update the PR body first so the reviewer judges the diff against intent rather than the current runtime state.

Fire each round as soon as the head it reviews is pushed — do NOT wait for PR CI to go green first. CI and the review round run in parallel; serializing them roughly doubles loop latency for nothing (the reviewer reads the pushed diff, not CI output). Green CI on the final head remains a hard MERGE-READINESS gate: a PR is merge-ready only when the final head has both green CI and a zero-accepted-findings round.

Skip it only for docs/process-only PRs, trivial copy-only changes, or explicit current-task user opt-out.

## One Round

1. Run the `deep-review` pass on the local Codex CLI against the PR-branch worktree at the pushed head. Route it exactly like the routed completion audits (see `agent-docs/operations/completion-workflow.md` § Audit Worker Rules): Codex `gpt-5.5` through the `c1` operator alias (`CODEX_HOME=$HOME/.codex-1 codex --profile full_access exec -C <worktree> -o audit-packages/pr-<number>-round-<k>.md - < <deep-review-prompt-file>`) or a direct non-interactive `codex exec`. Bind stdin exactly once: with the `-` prompt form, redirect stdin from the prompt file only — do not also append `</dev/null`, which wins as the last stdin redirect and feeds Codex an empty prompt (observed 2026-07-06). Close stdin with `</dev/null` only when the prompt is passed as a command-line argument instead of stdin (an open non-TTY stdin otherwise makes `codex exec` wait for piped input and hang). Honor the `MURPH_AUDIT_CODEX_HOME` override when set. Use **xhigh** reasoning for the PR gate — it is a whole-PR final bug hunt.

   Hand the run: the PR intent contract from the PR body, the exact commit range under review, an explicit `review only` instruction (no file edits, no commit helpers, no commits), and the standard deep-review instruction — use `murph-deep-review`, load `feynman-auditor`, follow the modified files plus directly affected call paths, and answer the exact question "What final bugs or edge cases could still break this change in production?" Because this is the consolidated PR-lane gate, keep the sweep whole-diff: surface cross-cutting bug, security/exposure, frontend, coverage, and prompt concerns as they come up, the same breadth the retired ReviewGPT loop covered. Write findings to `audit-packages/pr-<number>-round-<k>.md` (uncommitted working artifact). Run it as a background task and resume when the process exits.

   Because Codex reads the worktree directly, there is no guarded ZIP, repomix attachment, managed browser, connector, composer, or thread export to manage; the earlier ReviewGPT packaging/preflight steps no longer apply. If the Codex CLI or its auth is unavailable in the current environment, report that limitation and run the pass on the parent agent's current model instead — do not silently route the round through ReviewGPT, a connector, pasted text, or ad hoc archives.

2. Confirm the captured output is the actual review before triaging it. The round completes when the Codex process exits and the response file holds concrete findings or an explicit no-findings summary. If the run died, timed out, or left an empty or preliminary file, the round does not count; rerun it against the same pushed head rather than triaging a partial result.

3. When the response lands, the local agent triages every finding before any fix:
   first decide whether it is worth fixing at all. Reject it when it is wrong,
   already handled, speculative, lower-impact than the review claims, or when
   fixing it would snowball complexity beyond the confirmed risk. Accepted
   findings must clear one of these gates:
   - **Accepted bug/edge case** — confirmed real with a production-faithful E2E
     reproduction of the issue before the fix. Use the closest actual runtime
     boundary for the touched surface: hosted-local scenario, app route flow,
     built CLI path, package integration path, or another end-to-end owner lane
     that exercises the production code path rather than a bespoke mock. Keep
     the reproduction as committed regression coverage when the owner has a
     suitable lane. If the issue cannot be reproduced through a production-faithful
     path, do not fix it yet; reject or defer it with the exact missing evidence.
   - **Accepted simplification** — the change removes more complexity than it
     adds and has direct proof that required behavior and invariants are
     preserved.
   - **Rejected** — wrong, already handled, speculative, not worth the added
     complexity, or missing the required reproduction/proof. Note rejections
     briefly with the reason.

   Review findings are adversarial signals, not implementation instructions.
   Before accepting a finding, identify both the invariant it protects and any
   product-critical flow it could break. Follow
   `docs/contracts/00-invariants.md` § Product-Critical Flow Preservation:
   reject or redesign fixes that remove a required onboarding, welcome,
   current-reply, billing/access, auth, sync, privacy, or safety success path
   without an explicitly designed and tested replacement.

   Before accepting any fix that broadens architecture, run the architecture
   pressure check explicitly: can the invariant be preserved by deleting code,
   reordering existing durable writes, tightening an existing owner boundary,
   deriving from one existing source of truth, or adding focused coverage around
   the existing primitive? Reject, defer, or redesign the finding when the
   proposed cure adds a new durable state owner, index, lifecycle enum, queue,
   transaction layer, reconciliation loop, policy manager, or abstraction
   without production-path proof that the simpler owner-boundary fix is
   insufficient. When repeated findings cluster on one mechanism, pause
   tactical patching and either collapse that mechanism to a simpler ownership
   shape, split/abandon the PR, or explicitly reject the collapse finding.
   Codex deep-review is strongest as an adversarial reviewer, not as the final
   architecture owner.
4. Fix only accepted findings after the reproduction/proof above is in place,
   run the verification required by
   `agent-docs/operations/verification-and-runtime.md` for the touched owners,
   and push to the PR branch.
5. Fire the next round immediately after that push, in parallel with the new CI run. If CI later fails on a head a round reviewed, the round's findings still count; fix CI (rerunning flaky infra jobs is fine), and only changes that alter code beyond the reviewed diff require a fresh round.

## Base-Update-Only Exception

If a round has already reached zero accepted findings and the PR later needs to
be updated only because the base branch moved, do not start another deep-review
round just for that base update.

This exception applies only when the post-review change is a normal merge or
rebase of the PR base branch with no manual conflict resolution, new feature
work, review finding fix, or behavior/test/config/doc edit beyond the base
update itself. After the update, the merge path only needs PR CI green on the new
head; no review round is owed.

If the base update requires manual conflict resolution or any non-base-update
change, treat that as a normal PR-head change: run required verification for the
touched surface, push it, and use the ordinary review-loop rules (next round
fires immediately, in parallel with CI).

## Stop Condition

- Stop when a round produces **zero accepted findings**. Codex saying "looks clean" is not the terminator; the verification filter is.
- Hard cap: 10 rounds per PR. If the cap is hit with accepted findings still landing each round, stop and report that the PR likely needs structural rework rather than more review rounds.
- Report a per-round summary at handoff: findings received, accepted, rejected (with reasons), and what landed.

## Boundaries

- For current-checkout (non-PR-lane) work, never use this loop to satisfy the local required completion audits; see `agent-docs/operations/completion-workflow.md`. For PR-lane patch implementation, the worktree/PR-lane skip in that document explicitly lets this loop serve as the audit gate, so the individual local subagent passes default-skip and this loop must run to zero accepted findings before merge.
- Do not use ReviewGPT, `review:gpt`, `cobuild-review-gpt`, external ChatGPT threads, pasted text, connector context, local dirty-worktree context, or ad hoc archives for this loop. Run it on the local Codex CLI against a clean worktree at the pushed PR head so the review, CI, and merge target all refer to the same code.
- Response files under `audit-packages/` are local working artifacts and stay uncommitted.
- The Codex routing (operator alias, model, reasoning, `CODEX_HOME`/`MURPH_AUDIT_CODEX_HOME` resolution) lives in `agent-docs/operations/completion-workflow.md` § Audit Worker Rules and `agent-docs/operations/agent-workflow-routing.md`; the deep-review scope and question live in the `deep-review` pass definition there. Change them there, not inline.
