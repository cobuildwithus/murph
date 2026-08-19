# PR ReviewGPT Completion Loops

Last verified: 2026-08-17

This document owns two distinct managed-browser ReviewGPT stages for PR-lane
completion:

1. One preliminary `completion-specialists` pass combines the applicable
   Product UX, prompt, frontend, and coverage lenses. It may return one bounded coverage patch
   artifact.
2. The separate `pr-review` loop is the final cross-cutting gate for eligible work
   and replaces local `deep-review`.

Both stages use the managed Eragon, Phlebas, Hercules, Mountain, and Vonneumann browser
lanes. They
never share round state: the preliminary pass does not create or advance the
final gate's immutable first-reviewed-head baseline. After focused local proof
and the parent's candidate review, both stages may start concurrently against
the same exact pushed candidate head. Their findings are resolved together
before the parent's final review and completion.

Never combine local `deep-review` with the final ReviewGPT gate for the same
completed change, including when the change is complex, sensitive, or the user
asks for a final bug hunt.

For final-ReviewGPT-eligible PR-lane work, do not call the PR good to merge until the
latest substantive round returns `ROUND_OUTCOME: PASS`, local triage has zero
accepted findings, and PR CI is green on the final head. A completed anomaly
retrospective may justify continuing the same PR, but it never substitutes for
a later `PASS` on the resulting patch.

## Outcome and Completion Bar

Certify the exact pushed PR patch against its stated user outcome and repository
invariants using the guarded repository snapshot. Round 1 is always a full-patch
audit. On round 2 or later, the packager reads the PR body's explicit context
sensitivity and measures the complete current PR against its base. Sensitive or
undeclared PRs re-send a fresh full snapshot regardless of size. Routine PRs do
the same at 500 changed lines or 10 changed files; only routine PRs below both
cutoffs send the remediation delta and its directly affected paths. An explicit
`REVIEW_GPT_FULL_REVIEW_REASON` selects a new full-audit conversation. The gate
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
can still deprioritize unrelated renderers and occluded windows. Balanced mode
passes none of Chromium's background-timer, occluded-window, or renderer
backgrounding opt-out flags; use the fully unthrottled fallback only for a
browser version with a proven capture stall.
The lanes also default to headful display mode. Headless is an explicit local
override for removing visible UI, not a resource-saving default: it preserves
ChatGPT's renderer and page JavaScript, and the settled one-page comparison used
more CPU and memory than headful. A fresh profile must complete sign-in once in
headful mode before it can run headless.
Leaving completed waited targets open still accumulates active renderers across
rounds even when ordinary browser history and site data have been cleared.

Changing the launch mode does not reconfigure a browser process that is already
running. Never restart a shared lane merely to apply this setting while it has
pending reviews; let the new flags take effect on the lane's next normal
restart.

## Preliminary Specialist Pass

Run one preliminary specialist pass when any of these lenses apply:

- Product UX: a product-owned journey, semantic-copy, required-action,
  state-selection, visible-feedback, timing, delivery, permission, recovery,
  or interaction-economy dimension changed;
- prompt: prompt text, instruction stacks, tool descriptions, prompt assembly,
  or prompt regression behavior changed;
- frontend: user-facing `apps/web` UI changed outside the tiny static-copy fast
  path; or
- coverage: the diff changes executable behavior or changes the tests, fixtures,
  configuration, or direct-proof scaffolding that establishes its proof.

The task must use a clean worktree/PR lane. Commit and push the review candidate
and open or update the PR. The canonical `pnpm --silent review:gpt` command
suppresses pnpm's pre-wrapper working-directory banner, recognizes the PR-only
preset, resolves the current branch PR, checks the clean local head
against its pushed head, and exports the required PR ref and phase before the
package can create an attachment. The coordinator records the applicable lenses,
product outcome, direct journey evidence, focused local proof, current exact-head
CI status, and selected redacted rendered evidence in the review packet. The PR
body supplies its short outcome, Product UX result, evidence, and applicable
risk details. CI may still be `pending`; the preliminary pass runs concurrently
with it.

Do not add `ReviewGPT first-reviewed head` merely for the preliminary pass. When
final round 1 starts concurrently, add it before launching both jobs and set it
to their shared exact pushed head. The preliminary pass still does not consume
or advance the final gate's baseline.

Run the preliminary preset with exact-head packaging:

The repo config defaults response capture to 180 minutes. The workflow commands
inherit that timeout; use `--wait-timeout` only for an intentional per-run override.

```bash
pnpm --silent review:gpt completion-specialists \
    --wait \
    --response-marker SPECIALIST_REVIEW_COMPLETE \
    --response-file audit-packages/pr-<number>-specialists.md \
    --prompt "Preliminary specialist review target: <pr-url-or-number>. Checked commit: $(git rev-parse --short HEAD). Apply every Product UX, prompt, frontend, and coverage lens that the changed dimensions require."
```

Set `REVIEW_GPT_RENDERED_EVIDENCE_PATHS` to newline-separated image paths only
when images are part of the selected proof. It can contain zero, one, or many
images. An applicable frontend lens can omit it only when the PR explains why
images add no material proof and supplies another direct way to judge the
changed claim. Evidence paths must be repo-relative PNG, JPEG, or WebP files
under `.artifacts/review-gpt/` or `audit-packages/`; they stay ignored and
uncommitted. Redact direct identifiers and private content before packaging
them. The packager rejects absolute paths, traversal, symlinks, missing files,
unsupported types, and paths outside those two roots.

Set `REVIEW_GPT_PR_URL` only when intentionally targeting a PR other than the
one associated with the current branch. The guard still requires the local
head to equal that PR's pushed head. An explicit `REVIEW_GPT_REVIEW_PHASE` must
match the selected PR preset or the command fails before invoking ReviewGPT.

Keep the invocation's `--prompt` to the compact target/head instruction shown
above. The completion-specialists preset delegates detailed lens criteria to
the canonical files already inside `codebase.zip`; do not paste the PR body or
those lens documents into the composer. The wrapper rejects an assembled
completion-specialists prompt above 6,500 UTF-8 bytes, counting the preset plus
every `--prompt` and `--prompt-file` value; both the canonical command and
Frog's strict marker-bearing command must remain under that shared budget. Run
completion-specialists as the only preset so another preset cannot escape the
assembled-size check. If the ZIP tile is ready while Send remains disabled,
treat that as composer validation, not a second hydration lifecycle: remove
duplicated prompt text before retrying instead of extending browser waits or
rotating lanes.

The guarded ZIP contains:

- `review-gpt-pr-context/pr-body.md`
- `review-gpt-pr-context/pr.diff`
- `review-gpt-pr-context/changed-files.txt`
- `review-gpt-pr-context/review-phase.json`
- `review-gpt-pr-context/rendered-evidence.txt`
- `agent-docs/operations/product-ux.md` and the applicable prompt, frontend, and
  coverage references
- every explicitly listed rendered-evidence image
- current source, tests, and repository guidance

`review-phase.json` must identify `preliminary_specialists` and the exact pushed
head. The response must contain `SPECIALIST_REVIEW_COMPLETE` and one of
`SPECIALIST_OUTCOME: PASS`, `SPECIALIST_OUTCOME: FINDINGS`, or
`SPECIALIST_OUTCOME: INVALID`. Apply the same exact-turn, attachment, configured
model, and owned-target checks used by the final gate. Because this is a narrow,
lens-scoped pass, its minimum trustworthy duration is 5 minutes rather than the
final gate's default 7.5-minute floor. A marked response below 5 minutes does not
count. The ReviewGPT package enforces that same five-minute minimum for marked
concrete-model responses. Duration alone is not sufficient: confirm the exact
turn, attachment, requested model selection, completion marker, and substantive
lens coverage, then record the elapsed time and lane/model evidence.
An `INVALID` result is a tooling/evidence failure: correct the gap and retry the
same preliminary pass. A `PASS` or `FINDINGS` result is the one substantive
specialist pass; do not split or rerun it by lens.

Triage every finding against the real code and tests. If the response attaches
`reviewgpt-coverage.patch`, retain the exact review thread URL, artifact index,
and selected lane. Download only that assistant-owned artifact from the same
thread with the managed lane's CDP endpoint, for example:

```bash
pnpm exec cobuild-review-gpt thread download \
  --artifact-index <index> \
  --chat-url <exact-review-thread-url> \
  --browser-endpoint http://127.0.0.1:<selected-lane-port> \
  --output-dir audit-packages/pr-<number>-specialists
```

Read the full patch before applying it. Confirm every path is a test, fixture,
or direct-proof scaffold; reject production, prompt, UI, config, schema,
workflow, dependency, lockfile, generated, or docs hunks. Run
`git apply --check audit-packages/pr-<number>-specialists/reviewgpt-coverage.patch`
only after that inspection, then apply that same named file deliberately and
rerun the focused local proof for the affected behavior. Push the result so the
required exact-head CI surface evaluates it. Never pipe a downloaded artifact
directly into `git apply`, and never treat the attachment as landed code.

Resolve accepted Product UX, prompt, and frontend findings in the
parent, rerun focused proof, and push the resulting candidate. If final round 1
ran concurrently, preserve its first-reviewed-head baseline and verify the
combined behavior-bearing remediation in the next substantive round. If accepted
Product UX remediation materially changed a product-owned dimension, the
parent must reapply `agent-docs/operations/product-ux.md` § Review Ownership to
that corrected pushed head and updated direct journey evidence, then record a
refreshed product purpose verdict. This is parent-owned corrected-head
revalidation, not another subagent or ReviewGPT invocation. Do not rerun the
preliminary pass for those substantive corrections. Complete parent final
review and final verification only after findings from both stages are
resolved, then close any active plan and push the final task head.

## Final Gate: When It Runs

Run the loop when all of the following hold:

1. The task used the worktree/PR lane and a PR is open.
2. The routed work is final-ReviewGPT-eligible rather than docs/process-only,
   prompt-primary, frontend-only work that satisfies the eligibility exemption,
   or trivial copy-only.
3. Focused local proof and the parent's candidate review are complete, and the
   exact pushed candidate is stable enough for a full-patch audit.
4. The preliminary specialist pass starts against the same exact head when any
   of its lenses apply. It may still be running; completion still requires its
   substantive result, resolved findings, and recorded coverage-patch
   disposition.
5. The user has not explicitly opted out of the final gate in the current task.

The review target is the pushed PR head. Run the loop from a clean checkout or
worktree of the PR branch at that pushed head so ReviewGPT artifacts, CI, and
merge target all refer to the same commit. Do not run it on unpushed local
changes, a dirty worktree, or a checkout that is not at the pushed head.

The PR body must carry the short intent, Product UX result, direct evidence,
changelog decision, and any risk details required by
`agent-docs/operations/completion-workflow.md` § PR Description. Complete that
section's ordered launch preflight before firing a round; do not use a running
ReviewGPT job to discover missing PR-body metadata.

Before the final gate starts, the PR body must also contain exactly one
`ReviewGPT context sensitivity: routine` or
`ReviewGPT context sensitivity: sensitive` line plus a short reason. Use
`sensitive` whenever the final-gate eligibility exclusions or cross-cutting
conditions in `agent-docs/operations/completion-workflow.md` apply, regardless
of patch size. A small cosmetic change or narrow bug fix is `routine` only when
none apply. Missing, malformed, or duplicate declarations are packaged as
`undeclared` and default to the full snapshot.

At round 1, record the exact first-reviewed head in the PR body. Include the exact machine-readable line
`ReviewGPT first-reviewed head: <full-sha>`. Keep that line and baseline
immutable. The packager fails if its supplied first head differs from this
persisted PR-body value. Later substantive rounds report the remediation delta
from that baseline without asking the author to maintain a manual line-count
table. Here `<full-sha>` means exactly the 40-character lowercase hexadecimal
value returned by `git rev-parse HEAD`; a shortened SHA is invalid.

Fire each round as soon as the head it reviews is pushed. Do not wait for PR CI
to go green first. Final round 1 may run in parallel with both CI and the
preliminary specialist pass on the same head; use separate managed browser
lanes for concurrent ReviewGPT jobs. Green CI on the final head and resolved
results from both ReviewGPT stages remain separate merge-readiness gates.

Skip the final gate for docs/process-only PRs, prompt-primary PRs,
frontend-only PRs that satisfy the eligibility exemption, trivial copy-only
changes, other low-risk changes that satisfy
`agent-docs/operations/completion-workflow.md` § Final ReviewGPT Eligibility, or
explicit current-task user opt-out. If ReviewGPT is opted out and the
cross-cutting trigger still applies, route to local `deep-review` instead;
never run both. Prompt-primary PRs still run the preliminary specialist prompt
lens, and exempt frontend-only PRs still run every applicable preliminary
product, frontend, and coverage lens plus their ordinary rendered and UI proof.
Run the separate final gate only when other scope independently requires it or
the current user explicitly asks for it.

## One Round

1. The canonical command verifies that the local checkout is the pushed PR
   head before invoking ReviewGPT. For a standalone preflight without starting
   ReviewGPT, run:

   ```bash
   scripts/review-gpt-pr-head-preflight.sh <pr-url-or-number>
   ```

2. Run ReviewGPT with the PR preset and the default randomized usable managed
   browser lane. The command derives the final phase and current branch PR;
   pass the substantive round through `REVIEW_GPT_ROUND_NUMBER`. Round 1 adds
   the full PR body, current patch,
   exact round metadata, and guarded repository snapshot to `codebase.zip`:

   - `review-gpt-pr-context/pr-body.md`
   - `review-gpt-pr-context/pr.diff`
   - `review-gpt-pr-context/changed-files.txt`
   - `review-gpt-pr-context/review-round.json`
   - `review-gpt-pr-context/since-first-reviewed-head.diff`
   - `review-gpt-pr-context/since-previous-reviewed-head.diff`

   Later rounds either re-send the full guarded snapshot or use a small
   correction packet in the same conversation, as described below. Only an
   explicit full-review reason starts a new conversation.

   Round 1 defaults `REVIEW_GPT_FIRST_REVIEWED_HEAD` to the current PR head and
   leaves the remediation delta empty. For round 2 or later, preserve the
   original first-reviewed head and provide both it and the immediately previous
   reviewed head. Set the context anchor to the current PR head when the next
   package is expected to be a full snapshot; set it to the most recent prior
   full-snapshot head only when the next package is expected to be a same-thread
   delta:

   ```bash
   REVIEW_GPT_BROWSER_LANE=<round-1-lane> \
   REVIEW_GPT_ROUND_NUMBER=1 \
     pnpm --silent review:gpt pr-review \
       --wait \
       --response-marker REVIEW_COMPLETE \
       --response-file audit-packages/pr-<number>-round-<k>.md \
       --prompt "Review target: <pr-url-or-number>. Checked commit: $(git rev-parse --short HEAD). First-reviewed head: $(git rev-parse HEAD). Round 1 full-patch audit. Use the PR body as the intent contract and this head as the immutable first-review baseline."
   ```

   ```bash
   # Expected sensitive, undeclared, large, or explicitly requested full snapshot:
   review_gpt_context_anchor_head="$(git rev-parse HEAD)"
   # For an expected routine, small same-thread delta, use this instead:
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
       --prompt "Review target: <pr-url-or-number>. Checked commit: $(git rev-parse --short HEAD). First-reviewed head: <round-1-full-sha>. Substantive round <k>; follow review-round.json for full-audit versus correction scope. Prior findings, dispositions, landed fixes, and mechanisms: <compact-summary>. Retrospective status: <not-required-or-current-decision>."
   ```

   When the existing conversation or its original lane cannot continue, retry
   the same substantive round as an explicitly fresh full audit. Do not pass
   `REVIEW_GPT_THREAD_URL`, and replace any inherited stale anchor with the
   current pushed head:

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
       --prompt "Review target: <pr-url-or-number>. Checked commit: $(git rev-parse --short HEAD). First-reviewed head: <round-1-full-sha>. Fresh full audit for substantive round <k>. Prior findings, dispositions, landed fixes, and mechanisms: <compact-summary>. Retrospective status: <not-required-or-current-decision>."
   ```

   Choose a healthy lane for round 1 and keep that value with the conversation
   URL in the round handoff. Every later round that reuses that conversation
   must set the same `REVIEW_GPT_BROWSER_LANE` directly on that invocation; a
   compatibility variable or local config default cannot supply same-thread
   identity. The wrapper fails before packaging when that direct value is
   absent or automatic. An explicit full-review reason starts a new conversation
   and may choose a fresh lane.

   The later-round summary is required process metadata. Include each prior
   finding's accepted/rejected/out-of-scope disposition, the landed correction,
   and its underlying mechanism. Keep it compact and secret-safe; do not paste
   repository contents. If a completed retrospective permits continuation, name
   its decision and why the current delta stays inside it. An explicitly
   requested full audit starts a new conversation, so a missing,
   placeholder-only, or too-thin summary makes that run `INVALID`; that audit
   cannot return `PASS` without enough ledger detail to identify and verify
   every prior accepted finding. Ordinary later rounds retain the conversation
   ledger, whether the packager selects a full snapshot or a correction packet.

   Round 1 opens a new conversation and attaches the full guarded snapshot. On
   later rounds, the packager reads the PR body's context-sensitivity declaration
   and measures the full current PR shape reported by GitHub. A `sensitive` or
   `undeclared` PR attaches a fresh full snapshot regardless of size. A `routine`
   PR does the same at 500 changed lines or 10 changed files. Only a `routine` PR
   below both cutoffs attaches a short correction packet containing the immediate
   patch, its changed-file list, round metadata, and current versions of files
   touched by the patch. Missing, malformed, or duplicate declarations become
   `undeclared`; the packager never guesses that a PR is routine from file paths.
   The size decision uses one GitHub response containing the current head and
   complete base-to-head PR shape, not only the immediate remediation delta. The
   packager fails closed if that head differs from the head being packaged and
   records its parsed sensitivity and selected mode in `review-round.json`; the
   same-thread follow-up prompt obeys that mode, so prompt and ZIP scopes cannot
   diverge. If a routine small PR still needs a new
   full-audit conversation, omit
   `REVIEW_GPT_THREAD_URL` and set `REVIEW_GPT_FULL_REVIEW_REASON` to a concrete
   reason. Neither path resets the round number or immutable first-reviewed
   head. Save the new conversation URL and reviewed head after an explicit full
   audit. Later delta rounds reuse the current conversation and pass its most
   recent full-snapshot head as `REVIEW_GPT_CONTEXT_ANCHOR_HEAD`.

   The repo wrapper runs the current installed Brave binary with one usable
   ReviewGPT browser lane per run: Eragon on CDP port `9448`, Phlebas on `9442`,
   Hercules on `9444`, Mountain on `9450`, or Vonneumann on `9446`, always with
   profile `Default` and
   `app_connector=current` so review context comes from the guarded ZIP and
   not a ChatGPT connector. ReviewGPT attaches that snapshot as
   `codebase.zip`; Repomix is disabled by default and is not part of this flow.
   Each lane's user-data directory and CDP port preserve its authentication and
   process isolation; ignored copied app bundles are not browser-version
   authority.

   `REVIEW_GPT_BROWSER_LANE_COUNT` limits the automatic pool to the first one
   through five lanes and defaults to four. A host with a provisioned
   Vonneumann profile opts into all five by setting it in the local
   `$XDG_CONFIG_HOME/murph/review-gpt.conf`, without committing machine-specific
   preferences or account details.

   A lane is considered usable when its managed profile is unlocked, or when its
   configured CDP endpoint is already alive. The default random path skips a
   profile that has a stale or GUI-held `SingletonLock` and no live CDP endpoint;
   an explicit `REVIEW_GPT_BROWSER_LANE` pin still targets that lane directly
   and fails loudly if the profile needs operator cleanup.

   The wrapper requests the configured Pro review model on the selected lane.
   If ChatGPT reports that the selected lane has reached its model limit, do not
   move an existing conversation to another workspace. Reuse its original lane,
   or use the fresh-full recovery command above with a different lane instead of
   downgrading the model.

   To pin a specific lane, preserve a conversation's workspace, or debug one
   profile, set `REVIEW_GPT_BROWSER_LANE=eragon|phlebas|hercules|mountain|vonneumann` on
   that command.
   `aragon` is accepted as an alias for `eragon`. A first round may leave it
   unset to select a usable lane automatically, but its handoff must record the
   selected lane before a later same-thread round. Never use `auto` or `random`
   with `REVIEW_GPT_THREAD_URL`.

   After a concrete pre-completion staging, attachment, or profile failure on a
   fresh-conversation run, do not leave the immediate retry on the random
   selector: pin a different healthy lane and retry the same round number against
   the same pushed head. A same-thread retry must instead pin its original lane;
   if that lane cannot continue, use the fresh-full recovery command.

   Use `--wait` for normal review runs so ReviewGPT closes the tab it created
   after capture. Do not resend an accepted prompt during recovery; continue
   from the same thread and close any task-owned recovery tab when done.

3. Confirm the captured output is an actual completed review before triaging
   it. If the run leaves an empty/preliminary response, lacks
   `REVIEW_COMPLETE`, or reports a missing/unreadable `codebase.zip`, the round
   does not count. A response that passed exact-turn and completion checks does
   count even when optional model-evidence persistence or bounded owned-target
   cleanup later emits a warning; those post-completion diagnostics must never
   relaunch the model audit. Fix a concrete pre-completion tooling/profile
   failure before considering another run against the same pushed head.

   Verify `review-round.json` names the intended round, context sensitivity,
   context anchor, first-reviewed head, previous reviewed head, current PR
   changed-line/file counts, and current pushed head. Round 1 must have `full`
   scope,
   `full_snapshot` context, and empty cumulative and immediate remediation
   deltas. A later sensitive, undeclared, large, or explicitly justified round
   must have `full` scope and `full_snapshot` context. A later routine small
   round must have `correction` scope and `same_thread_delta` context. Every
   later round requires a previous head
   different from the current head and `true` first/previous ancestry. A delta
   also requires the context anchor to be an ancestor of the previous reviewed
   head. The packaged first head must match the immutable PR-body line and the
   invocation. Missing, mismatched, unavailable, or non-ancestral baseline
   evidence invalidates the run; restore or reconstruct the lineage before
   retrying the same substantive round.

   A response with `ROUND_OUTCOME: INVALID` does not count as a substantive
   round. Correct its evidence or invocation gap and retry the same round number
   against the same pushed head.

   Treat 7.5 minutes as the default final-gate trust floor, not an absolute
   stopwatch verdict. A marked concrete-model response below 6.5 minutes is too
   fast and does not count. A response from 6.5 minutes up to the 7.5-minute
   default is near-threshold and may count at local discretion when inspection
   confirms the exact turn, attachment, requested model selection, completion
   marker, and a substantive review proportionate to the requested scope. Record
   the elapsed time, selected lane/model evidence, artifact-quality judgment,
   and acceptance reason in the round handoff. ReviewGPT's package-level
   five-minute attestation threshold does not replace this stricter final-gate
   judgment. Responses at or above 7.5 minutes still require all ordinary
   evidence checks and are not trusted by duration alone.

   If a too-fast response is not accepted under this narrow exception, preserve
   it only as diagnostic output and retry the same substantive round number
   against the same pushed head. Browser, model, capture, attachment, and
   too-fast-response retries never advance the round counter. If evidence shows
   a different or downgraded model, incomplete response, missing snapshot, or
   shallow/templated output, discard the round regardless of duration, correct
   the profile or invocation, and retry. A different-lane retry must use a fresh
   conversation and full snapshot. If only one lane is healthy, pin it with
   `REVIEW_GPT_BROWSER_LANE` and note the temporary override in handoff.

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

   In a `same_thread_delta` round, accept a reported bug only when the remediation
   delta introduced it or made it materially worse. A serious issue in unchanged
   original PR work triggers the retrospective path. In a later `full_snapshot`
   round, the reviewer audits the complete current PR again, so either an
   original-PR or review-induced issue may be accepted and fixed normally. A
   pre-existing or adjacent issue belongs outside this PR unless the stated
   outcome cannot ship without resolving it. A claimed correction that fails to
   resolve its prior accepted finding counts as review-induced and must be
   corrected before `PASS`.

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
   update the evidence and risk notes when they changed, and push to the PR branch.

7. Fire the next substantive round immediately after a pushed accepted fix
   changes production source, runtime config, schema, behavior, or the
   implemented contract. Conflict resolution creates a new substantive round
   only when it makes one of those changes; the behavior-preserving base-update
   exception below owns mechanical conflict resolution. The packager selects a
   re-sent full audit or same-thread correction from the full current PR shape.
   Run it in parallel with the new CI run. If CI later fails on a reviewed head,
   the round's findings still count.

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

If a round has already reached zero accepted findings, do not update the PR
branch merely to chase a moving base before handoff. Keep the reviewed head,
require its normal CI, and prove current-base mergeability with
`git merge-tree --write-tree`. A clean merge-tree plus green required CI on the
PR-authored head is sufficient preparation.

This exception applies when the post-review change is only a normal merge or
rebase of the PR base branch, including bounded manual conflict resolution that
is proven behavior-preserving. For every conflict, the parent must inspect the
resolved hunk against the already-reviewed PR side and the current base side.
The resolution may select either side or mechanically combine both; it must not
author new logic, change runtime configuration or schema, alter the implemented
contract, fix a review finding, or include feature work or unrelated
behavior/test/config/doc edits. Conflict count is orientation only and does not
decide eligibility.

At an authorized merge boundary, wait only for the routed review gates and
required GitHub checks. Do not wait for optional or non-required status checks
after those gates are green unless a failing check is relevant to the changed
surface or the user explicitly requested it.

When strict up-to-date checks block the merge, prefer the merge queue. If no
queue is available, the unchanged reviewed patch has a one-update budget for
this completion attempt: perform one normal base update, record any conflict
paths and preservation reasons, run focused verification for affected surfaces,
and let required PR CI gate that head. The budget remains consumed until merge
or handoff; a later base advance, CI retry, or agent turn does not reset it. Do
not rerun ReviewGPT solely for that update. If any resolution authors behavior
not already represented by the reviewed PR or current base, materially changes
the implemented contract, includes another branch-authored change, or cannot be
confidently classified as mechanical, use the ordinary next-substantive-round
rule instead of the base-only budget.

If the base advances again after required CI is green on that one updated head,
do not update the branch or restart CI. Fetch the current base and rerun
`git merge-tree --write-tree`. When it is clean, use only an already-authorized
non-refresh merge path: the merge queue or an explicit stale-head/admin bypass.
Such a bypass may relax only strict-current status; it never bypasses required
CI or routed review gates. If the merge-tree conflicts, or no non-refresh path
is both available and authorized, report `moving-base race`, leave the PR and
worktree active, and stop. Do not poll for a quiet base.

## Stop Condition

- Stop when the exact current patch returns `ROUND_OUTCOME: PASS` and local
  triage produces zero accepted findings.
- `ROUND_OUTCOME: INVALID` is an evidence/invocation failure. It does not advance
  the round counter; correct the gap and retry the same substantive round.
- `ROUND_OUTCOME: RETROSPECTIVE_REQUIRED` pauses tactical remediation until the
  requirement-level retrospective is recorded. It is not a structural verdict.
- Hard cap: 7 rounds per PR. There is no automatic eighth substantive round. An
  accepted round-seven finding may still be reproduced and fixed; do not leave a
  known bug in place merely because the review counter reached seven. After that
  fix, pause the ReviewGPT loop and confirm the preliminary specialist pass,
  required local audit, parent final review, verification, and PR CI are all
  complete. Record the cap
  retrospective and obtain an explicit continuation decision before starting
  round eight; the answer may be delete, revert, shrink, split, redesign,
  continue, or abandon. A green non-ReviewGPT gate does not make the PR
  merge-ready without the required later `PASS`.
- Report a per-round summary at handoff: findings received, accepted, rejected
  with reasons, origin/mechanism, what landed, source-shape movement, and any
  retrospective decision. Report tooling retries separately.

## Boundaries

- The preliminary specialist pass and final gate both require a clean exact-head
  worktree/PR lane. Current-checkout fast-path work cannot use this document as
  a substitute for its routed local proof.
- When both stages run concurrently, package the same exact pushed head, use
  separate managed browser lanes, keep their response files and markers
  distinct, and preserve the final round-one baseline if specialist remediation
  creates a later substantive round.
- Do not run local Codex `deep-review` for a completed change that uses this PR
  gate. An explicit request for deep review or a final bug hunt is fulfilled by
  this cross-cutting ReviewGPT review and does not create a second pass.
- Do not substitute Codex subagents, pasted text, connector context,
  dirty-worktree context, ad hoc archives, or an unmanaged/non-ReviewGPT browser
  profile for either ReviewGPT stage.
- Do not commit ReviewGPT responses, rendered evidence, or downloaded patch
  artifacts. Files under `audit-packages/` and `.artifacts/review-gpt/` are
  local working artifacts.
  Agents may instead post a concise PR comment as each round is resolved,
  stating what they fixed and why; these comments are optional.
- The `pr-review` prompt lives at
  `scripts/chatgpt-review-presets/pr-deep-review.md`; despite the historical
  filename, it is the ReviewGPT PR-review prompt used by this loop.
- The preliminary prompt lives at
  `scripts/chatgpt-review-presets/completion-specialists.md`.
