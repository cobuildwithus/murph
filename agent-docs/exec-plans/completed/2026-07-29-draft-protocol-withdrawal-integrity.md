# Withdrawn protocol lineage integrity follow-up

Status: completed
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
- Distinguish a withdrawn fresh start, where no experiment exists, from a
  withdrawn saved run. Only the saved-run branch discusses preservation or
  abandonment.

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
  - Vault plan and lineage suites: 40 tests passed.
  - Vault, assistant engine, and Web typechecks passed.
  - Assistant instruction suite: 16 tests passed.
  - Web presentation suites: 10 tests passed.
  - Web lint passed with unrelated existing warnings only.
  - Documentation drift and whitespace checks passed.
  - Product-experience review passed before the preliminary specialist pass
    and again after remediation, with no findings. The remaining evidence gap
    is that focused prompt and service tests do not exercise a live assistant
    conversation through both withdrawal branches.
  - Preliminary specialist ReviewGPT returned four accepted findings. The
    fresh-start and saved-run instructions are now distinct, and its exact
    owned coverage patch was inspected, confirmed tests-only, checked with
    `git apply --check`, then applied to the three focused test files. The
    added coverage proves service-level plan/start rejection without a write,
    semantic no-op acceptance, and real-versus-synthetic Telegram link
    behavior.
  - Parent final review inspected the complete branch patch, the write-lock
    call paths, the applied specialist coverage, the design-catalog boundary,
    and the open-PR overlap. It found no remaining correctness, privacy,
    security, architecture, or duplication issue.
  - Candidate exact-head CI passed repository hygiene, frontend design proof,
    viewport overflow, the host-support matrix, Cloudflare hosted E2E, and the
    Vercel deployment status. Final-head CI and ReviewGPT will run after this
    plan is archived in the final scoped commit.
Completed: 2026-07-29
