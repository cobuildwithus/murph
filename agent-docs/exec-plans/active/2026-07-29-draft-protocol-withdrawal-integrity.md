# Withdrawn protocol lineage integrity follow-up

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Keep a withdrawn Health Commons protocol hidden and unavailable for new
  starts while preserving every saved private run's original protocol lineage,
  effective snapshot, run plan, and analysis plan.
- Give the member a truthful recovery path: leave the old run unchanged, start
  an accepted alternative as a distinct experiment, and abandon the old run
  only after separate explicit agreement.

## Success criteria

- Public and design-catalog surfaces do not republish the withdrawn protocol or
  embed live outbound links in synthetic studies.
- Start drafts name only the human-readable experiment.
- Planned and paused runs cannot activate after their protocol is withdrawn.
- A planned withdrawn run rejects an actual change to any protected lineage or
  plan field before writing, including when abandonment is requested in the
  same update.
- An abandonment-only update remains allowed and preserves all protected
  fields.
- Focused tests, package typechecks, Web lint, docs drift, product review,
  preliminary specialist review, final parent review, ReviewGPT, and exact-head
  CI complete successfully.

## Scope

- In scope:
  - Start-channel presentation and synthetic design-catalog proof.
  - Assistant withdrawal/recovery instructions.
  - Vault activation and protected-field update guards.
  - Durable product-contract documentation and focused regression tests.
- Out of scope:
  - Restoring or redirecting the withdrawn public protocol page.
  - Migrating, rewriting, or automatically abandoning existing private runs.
  - Adding a new queue, state owner, or compatibility layer.

## Constraints

- Technical constraints:
  - The vault document remains the source of truth.
  - Reject protected-field rewrites before the canonical write begins.
  - Compare semantic values so identical no-op inputs are not treated as
    lineage changes.
- Product/process constraints:
  - Do not expose raw protocol references or revision hashes to members.
  - Do not replace an existing experiment with an alternative.
  - Keep the solution deletion-first and reuse the existing update boundary.
  - Publish through a follow-up PR because the original PR merged before this
    remediation was committed.

## Risks and mitigations

1. Risk: An update abandons a planned or paused withdrawn run while silently
   rewriting its plan.
   Mitigation: Reject any combined status/protected-field mutation and prove
   byte-for-byte preservation for each protected field.
2. Risk: The guard blocks the member's explicit decision to abandon the old
   run.
   Mitigation: Keep abandonment-only updates valid and verify the protected
   values remain identical.
3. Risk: A design study leaks the hidden title or launches a real messaging
   action.
   Mitigation: Use synthetic copy, inert fragment links, layout assertions, and
   desktop/mobile render evidence.

## Tasks

1. Finish the withdrawal/recovery guard and regression coverage.
2. Run focused verification and repeat the required product review.
3. Commit and push the candidate, open a follow-up PR, and capture current
   design proof.
4. Resolve the preliminary specialist findings, perform the parent final
   review, close this plan with the final scoped commit, and push the exact
   reviewed head.
5. Run final ReviewGPT concurrently with exact-head CI and hand off the active
   PR/worktree once all required gates are green.

## Decisions

- Preserve the original private run rather than trying to repair it from the
  mutable public catalog.
- Guard the five persisted fields named by the product contract:
  `commonsProtocolRef`, `protocolRef`, `effectiveProtocolSnapshot`, `runPlan`,
  and `analysisPlan`.
- Permit abandonment only as a separate status-only decision.
- Apply the withdrawal-specific guard before the generic non-planned lineage
  rule so a paused run receives the same truthful recovery contract.

## Verification

- Commands to run:
  - Focused Vitest suites for Vault, assistant instructions, and Web
    presentation.
  - Typechecks for Vault, assistant engine, and Web.
  - Web lint and documentation drift checks.
  - Repository-required product, specialist, final, and CI gates.
- Expected outcomes:
  - Protected rewrites fail without changing the experiment document.
  - Abandonment-only succeeds and preserves the protected record.
  - The synthetic channel picker is compact, inert, and contains no withdrawn
    title or internal protocol data.
- Current focused evidence:
  - Vault lineage suite: 27 tests passed.
  - Vault, assistant engine, and Web typechecks passed.
  - Assistant instruction suite: 16 tests passed.
  - Web presentation suites: 9 tests passed.
  - Web lint passed with unrelated existing warnings only.
  - Documentation drift and whitespace checks passed.
