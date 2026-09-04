# Completion Workflow

Last verified: 2026-09-04

Use `agent-workflow-routing.md` for task scope, checkout, and plan/commit choice.
Use `verification-and-runtime.md` for checks. This document owns completion;
`pr-reviewgpt-loop.md` owns the mechanics of an applicable final external review.

## Outcome and Completion Bar

Finish the requested outcome at its existing ownership boundary, with focused
proof, parent review, a closed plan when applicable, and a scoped commit.
PR completion also needs green required checks on the final head and any routed
final review. A blocker is a reported gap, not a passing result. Merge and deploy
remain separate actions under the task's authority.

Preserve product-critical flows. A new restriction needs a current product or
security requirement, shipped contract, or reproduced harm. Reviewer caution
alone does not authorize a narrower product or another state owner.

## Sequence

1. Finish implementation and the relevant evidence below. Run focused tests,
   typecheck, and other checks selected by the verification guide. CI owns broad
   PR verification; run local umbrella checks only when useful for diagnosis.
   Direct default-branch pushes follow the guide's acceptance rule.
2. Review the candidate yourself: check the full diff, changed paths, actual
   outcome, privacy, ownership, complexity, and evidence gaps. Delete obsolete
   code and unjustified scope. Run `pnpm complexity:diff` for authored JS/TS;
   otherwise record why the metric does not apply. Review reported hotspots
   rather than treating the metric as a design verdict.
3. Make the changelog decision. Use `.agents/skills/write-changelog/SKILL.md`
   for a member-visible outcome; internal-only changes record a concrete reason.
   Write the complete PR body using the contract below.
4. Commit and push the candidate; open the PR as draft. For an intermediate
   plan-bearing commit, keep the plan active. `scripts/committer` takes explicit
   files and rejects directory targets; `scripts/finish-task` expands directories
   and closes the plan for the final commit. A PR with known edits still needed
   stays draft.
5. Once focused proof and parent candidate review pass and the pushed head is
   the intended candidate, mark the PR Ready. Start final ReviewGPT immediately
   when eligible, concurrently with CI. Follow the review loop's exact-head
   preflight and one completion owner; do not wait for CI before starting it.
6. Triage findings against real evidence. Fix accepted issues at the smallest
   correct boundary, rerun affected checks, and push. For a final ReviewGPT
   `FINDINGS` result, follow its Finding Disposition Boundary before mutation;
   `PASS` proceeds without a user-resume pause. Re-establish readiness after
   any new push. Never rerun a review only to obtain agreement on a rejected finding.
7. Perform the parent's final review after remediation. Close the active plan
   and commit through `scripts/finish-task`; push and verify the resulting head.
   Include every public-safe Frog entry created or modified during the task in that same scoped commit.
   A behavior-changing final edit needs the applicable checks and next review;
   explanatory docs and isolated proof additions follow the review loop's exemptions.
8. Fetch the current base and prove mergeability with
   `git merge-tree --write-tree HEAD origin/<base>`. Keep green required CI on
   the PR-authored head. Do not chase a moving base; use the review loop's
   Base-Update-Only Exception at an authorized merge boundary.
9. Report the outcome, evidence, and remaining risks or blockers. For a feature
   or fix, give the shortest practical verification steps and expected result.
   Keep an open PR's worktree. After confirmed merge or closure, retire it using
   the routing doc's guarded cleanup path.

## Product and Rendered Evidence

The parent owns these checks; there is no mandatory preliminary specialist,
local subagent, or separate simplify/final-review pass.

| Changed behavior | Required evidence |
| --- | --- |
| User-facing meaning, actions, audience, permission, timing, delivery, or recovery | Plan and replay materially different journeys under `product-ux.md`; record `Ready` or `Hold`. |
| Murph interpretation, tools, silence, or replies | Inspect the assembled prompt, prove deterministic boundaries, and run/review the focused real-Codex journey in `.agents/skills/verify-murph-assistant/SKILL.md`. |
| Hosted Web presentation or interaction | Inspect real rendering and applicable responsive/accessibility states. Follow `agent-docs/FRONTEND.md` for repository-owned design proof and safe media publication. |
| Tests or proof infrastructure | Check that proof exercises the actual invariant and composed owners, not a copy of the implementation. |
| Internal docs or meaning-preserving typo | Readback, reference checks, and relevant focused checks. |

A mock or internal success proves only its boundary. Trace a composed change
through the final user-visible or external effect that defines its promise.
Use synthetic evidence and report unavailable proof. Match viewports and
screenshots to material claims; there is no screenshot quota.

## Final ReviewGPT Eligibility

Run final ReviewGPT when the implementation changes:

- interacting owners, packages, apps, or runtime protocols;
- state ownership, schemas, migrations, ordering, concurrency, retries, or idempotency;
- auth, privacy, secrets, billing, health safety, public APIs, external effects,
  hosted execution, deploy boundaries, or another trust boundary;
- a large or high-risk refactor; or
- the user explicitly requests final ReviewGPT or a final cross-cutting bug hunt.

Otherwise skip it for docs/process text, low-risk tooling or tests, static
content, prompt-primary work, and frontend-only presentation/interaction.
Prompt and frontend exemptions do not cover independently sensitive behavior,
server actions/routes, backend changes, persistence, or production configuration.
They also do not waive the parent-owned evidence above.

An explicit user opt-out preserves focused proof and parent review without a
replacement mandatory subagent. Use local `deep-review` only when requested,
and follow the review loop's rule against duplicating the final cross-cutting gate.

## PR Description

Start from `.github/pull_request_template.md`. Keep the description about the
final change and the evidence a reviewer needs. Retain mechanically required
fields; use a concrete not-applicable reason instead of an empty checklist.

| Section | Content |
| --- | --- |
| Why and outcome | Problem and resulting behavior in one or two short paragraphs. |
| Product UX | Effort, affected journeys, exclusions, differences from plan, and `Ready`/`Hold`; or internal-only reason. |
| Evidence | Focused commands/results and direct proof. Distinguish pending CI and unavailable external proof. |
| Non-obvious affected surfaces | Necessary adjacent changes and their regression proof, or `None`. |
| Architecture and reuse | Four bullets: `Existing systems reused`, `New logic`, `New abstractions`, `Complexity intentionally avoided`. Explain why existing owners suffice when nothing is added. |
| Complexity impact | `Guard`, `Hotspots`, `Agent judgment`. Record the command/result, changed functions above 20 and disposition, and whether further simplification is justified. No authored JS/TS permits a concrete not-applicable reason. |
| Hot reply path impact | Applicable call/latency evidence below, or a reason the foreground path is unaffected. |
| Murph initial provider input impact | Applicable complete-input measurement below, or a reason for both individual and group runtimes. |
| Deployment concerns | Exactly one section and disposition, using one of the examples below. |
| Change-shape breakdown | Added/deleted lines for source, tests/fixtures, docs, config/tooling, generated/other, plus total; state classification and binary files. |
| Changelog | Exactly one section with item IDs or a concrete internal-only reason. |

Add `## Design proof` for user-facing hosted Web UI: `Design page`, `Evidence`,
and `Coverage`. Use a reviewer-openable absolute anchored URL to the real
production component on `/design?tab=components`, consent surface on
`/design?tab=consent`, or composed section under `/screenshots/<category>`.
The parent verifies origin, currentness, reachability, and representation;
the guard validates shape only. Add a representation only when one does not
already cover the changed state. Refresh inaccessible previews.

Content-only changelog entries/edition metadata follow the no-preview route in
`apps/web/changelog/README.md`. Existing page/layout metadata-only changes are
exempt only when the guard proves the unreferenced static metadata export is the
sole runtime change and contains no viewport or theme metadata. Renderer,
component, style, and interaction changes need ordinary design proof.

### Applicable risk evidence

- **Foreground reply path:** use the definition in `docs/contracts/00-invariants.md`.
  Name every database, network/provider, or other awaited operation added or moved
  onto that path. Include maximum calls, serial/parallel ordering, timeouts,
  retries, fallback, latency, and before/after proof.
- **Database collections:** report composed maximum query count, peak pooled
  connections/concurrent transactions, external/crypto work, and live authority
  revalidation. Apply the invariant's maximum-cardinality load contract.
- **Initial provider input:** capture the complete first provider-visible request
  for identical representative individual and group fixtures at base and head.
  Include assembled instructions/messages, tool/schema/generated guidance, and
  other provider-visible fields. Use the target tokenizer; report absolute and
  delta tokens, signed percentage, UTF-8 bytes and delta, method, and exclusions.
  Authored-text counts alone are not full-input measurements.
- **Deployment:** state supported skew, consumer-first safe order, rollback floor,
  expected exposure at current scale, reversibility, mixed-version convergence
  proof, and post-deploy checks. Consider Web/Worker and Worker/warm-container
  skew. A current/current test alone does not prove mixed-version compatibility.

Add a Risks section only for material issues or deliberately deferred work not
already covered. Do not repeat the work plan or every possible review lens.

### Review launch preflight

Before final ReviewGPT, read back the rendered PR body and confirm the complete
intent and evidence. Add exactly one of each machine-readable line:

- `ReviewGPT first-reviewed head: <full-sha>`: the 40-character pushed commit
  from `git rev-parse HEAD`; this round-one baseline stays immutable.
- `ReviewGPT context sensitivity: routine` or
  `ReviewGPT context sensitivity: sensitive`, with a reason. Any sensitive
  trigger above makes it sensitive regardless of size. Missing/invalid metadata
  defaults to a full snapshot, not a small correction packet.

Use `pr-reviewgpt-loop.md` for packaging and later rounds. Launch on the stable
pushed candidate concurrently with CI. A PR-body edit may retrigger evidence
validation without changing the reviewed commit baseline.

### Changelog examples

```markdown
## Changelog
- Changelog: updated
- Items: 2026-08-09 · stable-item-id
```

```markdown
## Changelog
- Changelog: not applicable
- Reason: Internal workflow and review tooling only.
```

### Deployment examples

```markdown
## Deployment concerns
- Deployment: applicable
- Supported skew: Old and new readers accept both deployed record shapes.
- Safe order: Deploy the backward-compatible reader before the new writer.
- Rollback floor: Rollback stays safe until the new writer publishes state.
- Expected exposure: At most one rollout window can observe mixed versions.
- Reversibility: Disable the writer before reverting the compatible reader.
- Convergence proof: Smoke confirms every instance reports the new version.
- Post-deploy checks: Verify the version and inspect bounded error aggregates.
```

```markdown
## Deployment concerns
- Deployment: not applicable
- Reason: Internal review tooling does not change a runtime deploy boundary.
```

## Review-Resolution Loop

Treat review findings as claims to verify, not implementation instructions.
Read the actual path and dependency contract. Accept a finding only with a
realistic trigger, serious harm, and code-path evidence. Reject wrong, speculative,
already-handled, disproportionate, or out-of-scope findings with a reason.
Rejected findings need no reviewer agreement.

For accepted issues, prefer deletion, reordering, derivation, or correction at
the current owner. Prove a real deployed/legacy consumer or persisted shape
before adding compatibility machinery. A hypothetical future rollout is not
sufficient. If fixes repeatedly grow the same mechanism, use the review loop's
retrospective before adding another layer.

The final ReviewGPT Finding Disposition Boundary remains authoritative:
`FINDINGS` pauses candidate mutation until user resumption except for its proven
Non-Production Remediation case; `PASS` continues.
Rerun affected proof after remediation. The review loop determines whether a
new substantive round is required; isolated tests, explanatory docs, rejected
findings, and base-only movement do not by themselves require one.

## When To Run Cross-Cutting Review

Use Final ReviewGPT Eligibility above. This is one gate, not a second review.

## Tiny Copy-Only Fast Path

A small static typo, punctuation, grammar, or equivalent localization correction
may use readback and focused checks when it preserves meaning and changes no
layout, state, interaction, or product promise. Semantic copy follows Product
UX; security, billing, medical, or guarantee claims follow their risk route.

## Safety Rules

Preserve unrelated work, privacy, and authority under `AGENTS.md`. Report the
exact failing check and why a pre-existing failure is unrelated. Green tests
do not substitute for direct proof at a changed user or operational boundary.
If deployment skew can degrade production, include `DEPLOYMENT CONCERNS:` in
the handoff with safe order, compatibility window, and post-deploy checks.
