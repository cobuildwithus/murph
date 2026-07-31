# Proposal: narrow behavior-fix completion lane

Status: proposed, non-operative
Date: 2026-07-31

This document proposes a smaller completion route for a tightly bounded class
of behavior regressions. It does not change current workflow requirements. A
later implementation PR must update the live owner docs and any guards only
after maintainers accept the eligibility and fallback rules below.

## Why propose this

PR #1235 corrected a dashboard focus-refresh regression. The production change
added five lines and deleted one in the existing Browser Vault provider. A
focused test held the refresh response pending and proved that admitted content
stayed mounted; existing logout, 401, 403, route, empty, and identity-change
cases remained fail-closed. Fifty-nine focused tests, changed-file lint,
hosted-web typecheck, and all thirteen exact-head CI checks passed.

The completion process was much larger than the correction:

- a proof-only UI extraction and synthetic design fixture added 141 lines, then
  was deleted because no component, copy, CSS, layout, asset, or rendered
  presentation had changed;
- final ReviewGPT repeatedly packaged a roughly 46 MB repository snapshot but
  never reached a model result because packaging, attachment, and target
  staging failed;
- retrying across managed lanes opened four Brave profile windows before three
  were closed manually;
- a later one-window, no-ZIP ChatGPT Pro consultation also failed to progress
  past composer staging, so this proposal claims no external-model verdict.

The lesson is not that proof or review should disappear. The workflow needs a
semantic test that spends them where they can change confidence.

## Desired outcome

A regression like PR #1235 should still require root-cause proof, a direct
regression test, scoped static checks, a worktree, a PR, parent final review,
and green exact-head CI. It should not require a plan, design-catalog artifact,
preliminary ReviewGPT, or final ReviewGPT when every narrow-lane gate passes.

Risky or ambiguous work must remain on the current full workflow. This proposal
does not create a general "small diff" exemption.

## Proposed eligibility gate

Every criterion must be true for the complete user outcome, not merely for one
commit. Any uncertain answer routes to the normal workflow.

1. **Regression restoration.** The change restores an already documented,
   tested, or directly observable contract. It does not introduce a new user
   capability, product decision, permission, destination, or recovery path.
2. **One existing owner.** Production edits stay inside one existing subsystem
   and owner. The change adds no dependency, service, state owner, abstraction,
   compatibility path, migration, queue, timer, or lifecycle manager.
3. **Narrow shape.** As a scope alarm rather than the basis for eligibility,
   the final patch touches at most three production files and at most 25
   production lines added plus deleted. Tests and truthful task documentation
   do not count toward that limit. Exceeding either limit routes normally.
4. **Authority semantics unchanged.** The patch does not change who may act,
   how identity is bound, which credentials are accepted, permission or auth
   decisions, revocation behavior, private-data clearing, or trust boundaries.
   Moving an unchanged authority check, weakening it, or changing its freshness
   is ineligible.
5. **Durable contracts unchanged.** There is no persisted-state, schema,
   migration, API/wire contract, provider contract, public export, billing,
   deploy, environment, or dependency change.
6. **Operational semantics unchanged.** There is no change to retries,
   concurrency, ordering, idempotency, dedupe, scheduling, queue ownership, or
   failure-recovery responsibility.
7. **Product semantics unchanged.** Copy, action count or priority, required
   steps, navigation, audience, notification/delivery destination, permission,
   and terminal recovery remain unchanged. A pending state may keep an existing
   admitted surface visible only when the same owner, request, result, and
   terminal fail-closed behavior remain intact.
8. **Presentation unchanged.** The final diff changes no production TSX markup,
   CSS, visual token, asset, accessibility tree, responsive layout, or visible
   content. It may change whether an already-rendered component remains mounted
   during an existing request.
9. **Direct proof exists.** A focused automated test reproduces the prior bug,
   observes the relevant intermediate state instead of only the final result,
   and proves the correction. Existing or added tests also exercise the nearest
   terminal safety and fail-closed outcomes.
10. **No split-diff evasion.** Eligibility is evaluated over the entire user
    request, linked issue, stacked PR set, and review remediation, including
    adjacent changes opened to reach the same outcome. Splitting one risky
    change cannot make its pieces eligible.

## Proposed completion route

When all gates pass:

1. Use a task worktree, branch, and PR. A plan is optional by default.
2. Record the proven root cause and why the change restores rather than creates
   a contract.
3. Run the direct regression test plus the narrowest changed-owner
   lint/typecheck or equivalent static check.
4. In the PR body, answer every eligibility gate and name the tests that cover
   the intermediate state and terminal safety outcomes.
5. Skip the design catalog and screenshots because production presentation is
   unchanged. State that reason explicitly.
6. Skip preliminary and final ReviewGPT. The parent performs the existing scope
   and shape check plus a fresh final diff/call-path review.
7. Require the ordinary full exact-head PR CI surface and merge-conflict proof.
8. If review or CI expands the production contract, reevaluate all gates. One
   failed gate immediately returns the PR to the normal workflow.

The lane saves external-review and proof-artifact overhead; it does not weaken
the merge test surface.

## Presentation versus state timing

Design proof is required when reviewers must judge changed pixels, words,
hierarchy, interaction, accessibility, responsive behavior, or a newly
renderable state. Examples include a new spinner, changed empty state, altered
button priority, new error copy, layout movement, or a component that did not
previously exist.

Behavioral proof is normally sufficient when the rendered component is byte-for-
byte unchanged and the correction only preserves that already-admitted
component while an existing request is pending. The regression test must hold
the request pending and assert continued visibility. A screenshot of the stable
component does not prove the timing property and should not be manufactured.

If a production TSX, CSS, asset, or accessibility surface changes, the narrow
lane is unavailable even when the intended screenshot looks identical.

## ReviewGPT browser budget proposal

The browser lifecycle change is useful beyond the narrow lane:

- Select one managed lane/profile for the task and reuse it for preliminary and
  final stages. Run those stages sequentially, after resolving preliminary
  findings, so they do not race packaging or establish a stale final baseline.
- A waited run may create one owned target in that profile. It must close that
  exact target on success, failure, timeout, or interruption.
- Allow one pre-model staging retry in the same profile after owned-target
  cleanup. Do not automatically fan out to another profile for attachment,
  composer, target, or capture failures.
- Bound pre-model staging to five minutes per attempt. Time spent before the
  model starts is tooling time and never counts as review evidence.
- A proven model-quota limit may use a different lane only after explicit user
  approval, because it opens another managed browser profile.
- After two same-lane pre-model failures, record ReviewGPT as unavailable. For
  ordinary work that is otherwise eligible for the existing local
  cross-cutting gate, run one local `deep-review` instead. Auth, privacy,
  security, billing, persisted-state, public-contract, deploy, or other
  high-risk work remains blocked for explicit maintainer direction; local
  fallback does not silently certify it.
- Never call an infrastructure failure a PASS. Report attempts separately from
  substantive review rounds.

This budget trades unlimited browser retry for a deterministic independent
fallback on ordinary work while keeping sensitive work fail-closed.

## Abuse cases

| Attempted shortcut | Why it fails the proposal |
| --- | --- |
| Split an auth change into three tiny PRs | The combined outcome and linked PR set are evaluated; authority semantics also fail the gate. |
| Call a new behavior a bug fix | Regression restoration requires prior contract evidence and forbids new capabilities or product decisions. |
| Hide a UI change in a provider or hook | Eligibility follows rendered and product semantics, not directory names. Any changed visible content or accessibility state fails. |
| Add a cache or manager to keep content visible | New owner/abstraction and durable or operational semantics fail the gate. |
| Test only the final successful result | Direct proof must hold and inspect the intermediate state plus nearest terminal safety outcomes. |
| Keep production edits tiny by moving logic into tests or generated files | Eligibility uses the complete outcome and owner change; generated indirection does not erase production semantics. |
| Start narrow, then accept a review-driven behavior expansion | Every behavior-bearing remediation triggers full gate reevaluation. |

## Proposed implementation edits

If maintainers accept this RFC, use one later implementation PR to make the
smallest coherent live-policy change:

- `AGENTS.md`: route qualifying narrow behavior fixes to the bounded lane and
  clarify that unchanged state timing does not invent design-catalog UI.
- `agent-docs/operations/agent-workflow-routing.md`: update the tiny low-risk
  row, plan default, and audit exception while retaining worktree/PR/CI.
- `agent-docs/operations/completion-workflow.md`: add the conjunctive gate,
  parent review contract, rendered-proof distinction, and full-lane escalation.
- `agent-docs/operations/verification-and-runtime.md`: specify the focused
  regression plus scoped static proof and exact-head CI ownership.
- `agent-docs/operations/pr-reviewgpt-loop.md`: make one lane/profile task-owned,
  sequence preliminary before final, cap same-lane pre-model retry, and define
  low-risk fallback versus high-risk blocker.
- `agent-docs/FRONTEND.md`: require catalog/screenshots for changed production
  presentation, not unchanged component continuity proved by a timing test.
- Add focused policy/guard tests before changing any automated admission logic.
  The semantic checklist should remain human-reviewed unless objective pieces
  can be enforced without rewarding path or line-count gaming.

## Trial and rollback

Start with a ten-PR trial. Each fast-lane PR should include the checklist,
production shape, focused proof, exact-head CI result, and any later regression
or reviewer escalation. After the trial, compare elapsed completion time,
review findings, CI failures, and post-merge regressions with similar normal-
lane fixes.

Rollback is documentation-only: remove the exemption and route all future work
through the existing workflow. Already-merged code remains covered by its PR
tests and exact-head CI.

## Recommended policy

Adopt the narrow lane only for evidence-backed restoration inside one existing
owner where product, authority, durability, operations, and presentation
semantics are all unchanged. Keep focused intermediate-state and terminal-
safety tests, parent final review, PR isolation, exact-head CI, and conflict
proof mandatory. Any uncertainty escalates.

Non-negotiable safeguards:

- no auth, identity, permission, privacy, billing, health-safety, persistence,
  public-contract, dependency, deploy, retry, concurrency, or migration changes;
- no new owner, abstraction, compatibility path, or user-facing presentation;
- no eligibility by line count alone and no split-diff evasion;
- direct regression and terminal-safety proof;
- green exact-head CI;
- one managed browser profile, bounded same-lane retry, and no false PASS when
  review infrastructure fails.
