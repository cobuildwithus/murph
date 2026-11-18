# PR ReviewGPT Completion Loops

Last verified: 2026-11-14

Use this runbook only when `completion-workflow.md` § Final ReviewGPT
Eligibility selects final ReviewGPT or the user asks for it. That section owns
whether a review is required. This document owns running one: packaging,
browser lanes, validating the response, finding disposition, retries, and base
updates.

The gate is complete when the pushed patch has a resolved review (§ Stop
Condition), no accepted finding is unresolved, and required CI is green on the
final head. Missing or stale evidence, a failed Pro selection, an invalid response, or
a merge conflict stops the loop. None of them lets you infer the answer.

## When It Runs

Run a round when a PR is open on the worktree/PR lane, the change is eligible,
focused local proof and your own candidate review are done, and the user has
not opted out in this task. If the user opts out of an eligible review, record
the opt-out and finish with parent review and direct proof. Do not substitute
a local subagent review.

Run from a clean checkout of the PR branch at the pushed head, so the review,
CI, and the merge target are the same commit. Start the round as soon as that
head is pushed, in parallel with CI; green CI and a resolved review are
separate gates. PR-description content cannot block or invalidate a round. Its
own CI checks belong to `completion-workflow.md` § PR Description.

## Run A Round

`pnpm review:gpt` first checks that the checkout is the pushed PR head and
refreshes the PR base when needed. To run that check alone:

```bash
scripts/review-gpt-pr-head-preflight.sh <pr-url-or-number>
```

Round 1 is always a full audit in a new conversation:

```bash
REVIEW_GPT_BROWSER_LANE=<round-1-lane> \
REVIEW_GPT_ROUND_NUMBER=1 \
  pnpm --silent review:gpt pr-review \
    --wait \
    --response-marker REVIEW_COMPLETE \
    --response-file audit-packages/pr-<number>-round-<k>.md \
    --prompt "Review target: <pr-url-or-number>. Checked commit: $(git rev-parse --short HEAD). First-reviewed head: $(git rev-parse HEAD). Round 1 full-patch audit. Use the PR body as the intent contract and this head as the immutable first-review baseline."
```

Leave `REVIEW_GPT_BROWSER_LANE` unset to let the wrapper pick a usable lane.
Record the lane it used, the conversation URL, and the reviewed head in the
round handoff, because a later round needs all three. The packager writes
`<archive>.zip.review-round.json` beside the ZIP; keep that small file when you
retire the archive so later rounds can recover the reviewed heads and context
mode.

A later round (§ After A Fix says when one is warranted) reuses the
conversation and its lane:

```bash
# Expected full snapshot (sensitive, undeclared, large, or explicitly requested):
review_gpt_context_anchor_head="$(git rev-parse HEAD)"
# Expected small correction packet in the same thread:
# review_gpt_context_anchor_head=<most-recent-prior-full-snapshot-head>

REVIEW_GPT_ROUND_NUMBER=<k> \
REVIEW_GPT_FIRST_REVIEWED_HEAD=<round-1-full-sha> \
REVIEW_GPT_PREVIOUS_REVIEWED_HEAD=<round-k-minus-1-full-sha> \
REVIEW_GPT_CONTEXT_ANCHOR_HEAD="$review_gpt_context_anchor_head" \
REVIEW_GPT_THREAD_URL=<current-context-chatgpt-url> \
REVIEW_GPT_BROWSER_LANE=<round-1-lane> \
  pnpm --silent review:gpt pr-review \
    --wait \
    --response-marker REVIEW_COMPLETE \
    --response-file audit-packages/pr-<number>-round-<k>.md \
    --prompt "Review target: <pr-url-or-number>. Checked commit: $(git rev-parse --short HEAD). First-reviewed head: <round-1-full-sha>. Substantive round <k>; follow review-round.json for full-audit versus correction scope. Changes since the last round: <brief-description>."
```

The first-reviewed head stays the round 1 head for the life of the PR. The
prompt only says what changed since the last round; keep it short and free of
secrets. A same-thread round must set `REVIEW_GPT_BROWSER_LANE` to the original
lane on that command (never `auto` or `random`); the wrapper refuses otherwise.

The packager chooses what a later round sends. It reads the optional PR-body
line `ReviewGPT context sensitivity: routine` or
`ReviewGPT context sensitivity: sensitive` and measures the whole PR against
its base:

| PR | Sent |
| --- | --- |
| `sensitive`, or the line is missing, malformed, or duplicated (`undeclared`) | Fresh full snapshot |
| `routine`, at 500 changed lines or 10 changed files | Fresh full snapshot |
| `routine`, below both | Correction packet: the immediate patch, its changed-file list, round metadata, and the current files it touches |

Declare `sensitive` whenever anything on the eligibility list applies, whatever
the patch size. A missing declaration never stops a round.

When the conversation or its lane cannot continue, or a routine small PR needs
a new full audit, retry the same round as a fresh full audit. Omit
`REVIEW_GPT_THREAD_URL`, give a concrete reason, and anchor on the current
head:

```bash
REVIEW_GPT_ROUND_NUMBER=<k> \
REVIEW_GPT_FIRST_REVIEWED_HEAD=<round-1-full-sha> \
REVIEW_GPT_PREVIOUS_REVIEWED_HEAD=<round-k-minus-1-full-sha> \
REVIEW_GPT_CONTEXT_ANCHOR_HEAD="$(git rev-parse HEAD)" \
REVIEW_GPT_FULL_REVIEW_REASON="The prior conversation or lane is unavailable." \
REVIEW_GPT_BROWSER_LANE=<fresh-lane> \
  pnpm --silent review:gpt pr-review \
    --wait \
    --response-marker REVIEW_COMPLETE \
    --response-file audit-packages/pr-<number>-round-<k>.md \
    --prompt "Review target: <pr-url-or-number>. Checked commit: $(git rev-parse --short HEAD). First-reviewed head: <round-1-full-sha>. Fresh full audit for substantive round <k>. Changes since the last round: <brief-description>."
```

This keeps the round number and first-reviewed head. Save the new conversation
URL, lane, and reviewed head for later rounds.

### Retries

A retry never advances the round number.

- **Lane rate limit.** `REVIEW_GPT_RATE_LIMITED`, a visible "Capabilities
  reduced until…" notice, or Pro becoming unselectable under that notice means
  the attempt does not count, even if an answer or `PASS` came back. Retry on
  another lane in a fresh conversation: round 1 with a different explicit
  `REVIEW_GPT_BROWSER_LANE`, later rounds with the fresh-full command and
  `REVIEW_GPT_FULL_REVIEW_REASON="previous lane capability limit"`. Try each
  lane once. If all are limited, report the reset notice and stop until one
  recovers. Never move the limited conversation to another workspace.
- **Staging, attachment, or profile failure before completion.** For a
  fresh-conversation run, pin a different healthy lane and retry the same round
  on the same head. A same-thread run must keep its original lane; if that lane
  cannot continue, use the fresh-full command.
- **Capture failure after the prompt was accepted.** Do not resend. Recover the
  accepted request (§ Recover an accepted review after capture failure).
- **Every round 1 attempt was invalid and an already-authorized change has
  produced a new pushed head.** First confirm no valid review exists, and
  recover any accepted prompt still awaiting capture. Then run round 1 on the
  new head with a full snapshot and no previous-reviewed head. Never relabel a
  valid `PASS` or `FINDINGS` as invalid or drop its findings this way.

### Browser lanes

The lanes are `eragon` (CDP port 9448, alias `aragon`), `mountain` (9450),
`vonneumann` (9446), and `apollo` (9454). Pin one with
`REVIEW_GPT_BROWSER_LANE=<name>`. `REVIEW_GPT_BROWSER_LANE_COUNT` (1 to 4)
limits the automatic pool to the first lanes in that order; a host can set it
in `$XDG_CONFIG_HOME/murph/review-gpt.conf`, and a value on the command wins.
Automatic selection skips a lane whose profile is locked with no live CDP
endpoint; an explicit pin targets it anyway and fails loudly if the profile
needs operator cleanup.

Up to 10 reviews may run on each lane at once, each from its own worktree. Two
runs in one worktree share `audit-packages/` and overwrite each other's files.

Use `--wait` so the run closes the one ChatGPT tab it opened. Never close a
tab the current run did not create, and never sweep a profile's tabs. Never
restart a shared lane that has pending reviews to apply a launch setting; it
takes effect on the lane's next normal restart. Lanes run headful by default.
Headless is a local override for hiding the window, it uses more CPU and
memory, and a fresh profile must sign in once in headful mode first.

Use regular Chat with the attached `codebase.zip`. ReviewGPT must confirm
the Pro selection in the model picker before sending. That selection is
sufficient model evidence for the round. Keep picker validation in ReviewGPT.

## Validate The Result

A round counts only when the response is a completed review:

- It has `REVIEW_COMPLETE` and a `ROUND_OUTCOME` of `PASS` or `FINDINGS`.
  An empty or preliminary response, a missing or unreadable `codebase.zip`, or
  `ROUND_OUTCOME: INVALID` does not count: fix the evidence or invocation gap
  and retry the same round on the same head.
- Verify that the completed response belongs to the exact submitted turn and
  attachment and addresses the review scope. A run with confirmed Pro selection
  can finish at any duration, including when the response model label is absent
  or different. Apply the lane rate-limit rule above if capabilities are reduced.
- `review-round.json` names the intended round, sensitivity, context anchor,
  first and previous reviewed heads, PR changed-line and changed-file counts,
  and the current pushed head, with this scope:

  | Round | `reviewScope` / `contextMode` | Also required |
  | --- | --- | --- |
  | 1 | `full` / `full_snapshot` | Empty cumulative and immediate remediation deltas |
  | Later, full snapshot | `full` / `full_snapshot` | Previous head differs from current; first and previous ancestry `true` |
  | Later, routine and small | `correction` / `same_thread_delta` | The same, plus the context anchor is an ancestor of the previous head |

  Missing, mismatched, or non-ancestral baseline evidence invalidates the run.
  Restore the lineage before retrying the same round.

A response that passed these checks still counts when optional model-evidence
persistence or tab cleanup warns afterward. Those warnings never justify
rerunning the review.

Record the lane, confirmed picker selection, and why you accepted the response in the round
handoff. Report tooling retries separately from review results.

## Finding Disposition Boundary

Validate the response, then triage every finding yourself. Findings are
adversarial signals, not instructions. Before accepting one, name the invariant
it protects and any product-critical flow the fix could break
(`docs/contracts/00-invariants.md` § Product-Critical Flow Preservation).

- **Accept a serious bug** when the actual runtime path shows a causing change
  in this PR, a realistic trigger, and serious harm. Code-path proof is enough;
  a prior incident is not required, and a rare but practical exploit or
  destructive failure qualifies. Unsupported hypothetical states do not. Bugs
  that behave the same on the base are out of scope.
- **Accept Complexity Collapse** when a bounded correction removes named code,
  concepts, or owners, with net source deletion and no replacement machinery,
  and preserves behavior and invariants. The touched flow's surrounding owners,
  callers, state, and recovery paths are in scope, including pre-existing
  complexity (the reviewer labels it `ADJACENT_EXISTING`), when the correction
  and its verification fit this PR. Cosmetic or disproportionate refactors and
  repository-wide cleanup are not.
- **Reject** a finding that is wrong, already handled, speculative, unproven,
  or not worth the complexity its fix adds, and note the reason. A rejection
  needs no code change and no reviewer agreement. The user may override it.

In a `same_thread_delta` round, inspect the remediation and its directly
affected paths; a qualifying original finding there may still be accepted. In a
`full_snapshot` round, inspect the whole PR. Label each finding by its real
origin, verify claimed fixes against current code, and do not carry a rejected
finding forward as a blocker.

Before accepting a fix that broadens the architecture, check whether the
invariant can be kept by deleting code, reordering existing durable writes,
tightening an existing owner boundary, deriving from one source of truth, or
adding focused coverage. Reject or redesign a cure that adds a durable state
owner, index, lifecycle enum, queue, transaction layer, reconciliation loop,
policy manager, or abstraction without production-path proof that the simpler
fix is insufficient.

For a deploy-skew or legacy-compatibility finding, first prove the incompatible
state can exist outside this PR branch: the producer has shipped, old consumers
or producers can run during the rollout or rollback window, or production data
or external clients already hold the legacy shape. Size it at current scale
(rollout window, volume, exposed operations, reversibility, monitoring or manual
repair). If it cannot exist, or the only risk is a rare reversible miss for a
few members in a short rollout, reject it or handle it with a deployment note,
a changed deploy order, or by deleting the rollout seam. Do not add replay,
backfill, repair paths, migrations, shims, dual writes, queues, capability
negotiation, or reconciliation for a low-incidence temporary window.

Then report the result and, for each finding, your disposition, the code or path
evidence, the current harm or removable complexity, and the smallest justified
correction with its complexity cost. After reporting `FINDINGS`, keep going:
fix accepted findings, verify, and finish within the user's existing
authorization. A review that found issues is not a reason to end the turn or
ask the user to say "continue". A validated `PASS` proceeds to the remaining
completion checks. A `FINDINGS` result with zero accepted findings and recorded
rejection reasons needs no rerun.

Ask for a decision only when a correction materially changes the requested
outcome or scope, needs authority not already granted, or exposes a concrete
requirement conflict. Continue independent authorized work meanwhile. Findings
grant no new authority for destructive actions, production mutations, messages,
or spending.

## After A Fix

Fix accepted findings at the owning boundary with the smallest correction that
preserves the intended success path. Run focused verification under
`verification-and-runtime.md`, update the PR evidence, and push.

One round is the default. Prove a pushed fix with a test or direct evidence,
record both in the PR, and finish the merge checks. An accepted finding stays
unresolved until it is fixed and proven; that proof resolves it without another
round. Run another round, in parallel with the new CI run, only when a fix
changes the design (adds state, a migration, or a new authority path), reaches
a risky surface the last round did not see, or a later commit adds behavior no
round reviewed. Never run one just to confirm a fix. If CI later fails on a
reviewed head, that round's findings still count.

These changes need no new round when they leave production behavior, runtime
config, schema, and the implemented contract unchanged: isolated regression
tests or fixture updates, PR-body updates, finding-disposition comments, and
explanatory doc edits. Run their focused verification and CI, and note in the
PR body how the merge head differs from the reviewed head. Conflict resolution
follows § Base-Update-Only Exception unless it does one of the things above.

Revisit the requirement itself only on concrete evidence: fixes keep failing at
the same cause, compensating machinery keeps growing, or a product or authority
decision outside the task is needed. Then compare the original outcome with the
current implementation, choose the smallest correction or scope change, and
record a material decision with the PR evidence. Patch size and round count do
not trigger this.

## Base-Update-Only Exception

Once a round has zero accepted findings, do not update the branch just to chase
a moving base. Keep the reviewed head, require its normal CI, and prove
mergeability with `git merge-tree --write-tree`. That is sufficient.

When the authorized merge path does need a current base, prefer the merge
queue. Otherwise use a normal merge or rebase, record conflict paths and why
each resolution preserves behavior, run focused verification for affected
surfaces, and let required CI gate the new head. Preserve published history
unless rewriting it is explicitly authorized.

A base update needs no new ReviewGPT round when it is only that merge or
rebase, including manual conflict resolution you have checked hunk by hunk
against the reviewed PR side and the current base side. A resolution may pick
either side or mechanically combine both. If it authors new logic, changes
runtime configuration, schema, or the implemented contract, fixes a review
finding, carries other work, or cannot be confidently called mechanical, the
ordinary rule in § After A Fix applies. Conflict count does not decide this.

There is no limit on base updates and base movement needs no new permission;
inspect the new diff and mergeability each time. A changed head needs its own
required CI. At an authorized merge boundary, wait only for the routed review
gates and required checks, plus an optional check when its failure is relevant
to the changed surface or the user asked for it. Never bypass required checks,
review gates, or an unresolved ownership or product decision to finish a merge.

## Stop Condition

- Stop when the current patch has a resolved result: `ROUND_OUTCOME: PASS`, or
  `FINDINGS` with every finding either rejected for a recorded reason or fixed
  and proven under § After A Fix.
- `ROUND_OUTCOME: INVALID` is an evidence or invocation failure. Fix the gap
  and retry the same round.
- One round is the default and three is the cap. There is no automatic fourth
  round. An accepted round-three finding is still fixed and proven; then finish
  parent review, verification, and CI. Justify a fourth round against existing
  task authority, and ask the user only if it changes scope or authority.
- At handoff, report the review result, what changed, and any unresolved
  findings.

## Wait And Wake Ownership

Every run has one completion owner in the original session. Prefer `--wait` and
let that invocation own capture until it completes, times out, or fails. Stay
in the same session and watch the process, including across yielded tool calls.
A slow review is not a reason to end the turn, arm a continuation, or move the
work to a new session.

When a completion-returning wait is unavailable, poll the accepted thread from
the same session, at least five minutes between checks, within the run's
timeout. Do not add a status poll while a `--wait` process owns capture.

Use detached `cobuild-review-gpt thread wake` only for a deliberate handoff:
the session cannot stay active, or the user asks. Bind it to the exact thread,
capture metadata, owning session, checkout, and lane, with `--poll-interval 5m`
and `--poll-timeout 260m` unless the caller or user already set a bound.
(Response capture itself defaults to 250 minutes.) After a handoff the watcher
owns completion, so do not also poll by hand.

### Recover an accepted review after capture failure

When the waited run exits on a hard-refresh or export failure without a
confirmed lane rate limit, the request was already accepted. Keep its capture
metadata and export the thread from the same session instead of resending:

```bash
pnpm exec cobuild-review-gpt thread export \
  --browser-endpoint "$BROWSER_ENDPOINT" \
  --chat-url "$CHAT_URL" \
  --capture-metadata "$CAPTURE_METADATA" \
  --output .tmp/review-gpt-recovered-thread.json
```

`BROWSER_ENDPOINT` and `CHAT_URL` come from the original metadata, and
`CAPTURE_METADATA` is that invocation's unchanged metadata file. Do not start
this while a waiter or detached owner is still capturing the same request. The
exporter rejects endpoint, thread, turn, response, or artifact mismatches; do
not edit metadata or broaden the target to make it pass.

An export recovers evidence, not a verdict. Validate it under § Validate The
Result and keep the original round and head when it passes. If the response is
still incomplete, keep the original owner and the polling rule. Verify the exported response against the original turn and attachment, and use
the original run’s confirmed Pro selection for the model check.
Close only a recovery tab this task opened.

An accepted send can briefly show a `WEB:<uuid>` conversation URL. Once that
target has its canonical URL, export with the unchanged metadata. Never resend
to get a different receipt; a missing original target cannot be rebuilt from
the transient ID.

## Special Inputs

### Include an authorized companion repository

For a review that spans another repository, pass one `--companion-snapshot`
JSON descriptor per companion through `pnpm review:gpt`, with `repo` (the local
checkout), `head` (its full commit SHA), and `prUrl` (its same-repository PR).
The companion must be clean, match its live PR head, and carry its own
committed config and guarded packager. Include only repositories authorized for
this review. A companion adds context to this review; it does not start a
separate review or satisfy the other PR's gate.

### Review patched tooling dependency source

When a PR changes a locked `@cobuild/review-gpt` or `@cobuild/repo-tools`
patch, or a Codex patch under `patches/`, the packager adds the patched source
and its provenance under `review-gpt-pr-context/dependencies/`. No inline
package or separate archive is needed. A packaging failure there stops the
round.

### Review third-party dependency upgrades

The snapshot never carries third-party package source, so a prompt asking the
reviewer to audit an upgraded library's internals returns `INVALID`. Scope the
round to Murph-owned code and configuration: every caller of the upgraded
package, the overrides and manifests, the lockfile resolution, and the changed
tests. Put the release notes checked against those callers, and the tests that
run the installed versions, in the PR body as the evidence for dependency
behavior.

## Boundaries

- A request for a deep review or final bug hunt on a PR that uses this gate is
  fulfilled by this review. Do not add a second cross-cutting pass.
- Pasted text, connector context, a dirty worktree, an ad hoc archive, or an
  unmanaged browser profile cannot stand in for the review.
- Do not commit ReviewGPT responses or rendered evidence; `audit-packages/` and
  `.artifacts/review-gpt/` are local working files. A short PR comment per
  resolved round, saying what was fixed and why, is optional.
- The `pr-review` preset's prompt is
  `scripts/chatgpt-review-presets/pr-deep-review.md`.
