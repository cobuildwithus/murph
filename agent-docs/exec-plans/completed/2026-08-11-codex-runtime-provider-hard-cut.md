# Collapse assistant runtime provider abstraction to Codex

Status: completed
Created: 2026-08-11
Updated: 2026-08-11

## Goal

- Make the assistant runtime architecture tell the truth: Codex App Server is
  the sole execution runtime, while Codex model-provider selection remains an
  independent BYO inference choice.
- Delete one-member runtime-provider branches, aliases, guards, and conversions
  where their only job is to pretend another runtime can be selected.

## Success criteria

- Runtime execution, target normalization, session continuity, and catalog
  resolution use direct Codex-owned data flow with no fake provider dispatch.
- Existing persisted/public `codex-cli` wire fields and hosted handoff contracts
  continue to parse and serialize where they remain active compatibility
  boundaries.
- Model-provider configuration, credentials, setup choices, usage/pricing
  attribution, and custom inference behavior are unchanged.
- Unsupported persisted runtime targets still fail closed with the existing
  actionable error.
- The implementation has net-negative conceptual and executable code, focused
  regression coverage, green scoped verification, ReviewGPT approval, and green
  required PR checks.

## Scope

- In scope:
  - `@murphai/operator-config` runtime target/config normalization and adapters.
  - `@murphai/assistant-engine` Codex execution, session, routing, and catalog
    consumers that currently re-check the single runtime variant.
  - Focused tests and durable architecture docs required to keep the distinction
    between runtime and model provider explicit.
- Out of scope:
  - Codex native image migration; API-key runtimes retain Murph's custom image
    path.
  - Changes to inference/model-provider choices, auth, pricing, or setup UX.
  - Churn-only renaming of generic per-turn provider events, usage records, or
    stable public/persisted schemas.
  - Deployment changes or removal of active hosted compatibility fields.

## Constraints

- Technical constraints:
  - Preserve session route and thread compatibility fingerprints for equivalent
    existing Codex configurations.
  - Preserve strict model-provider validation and fail-closed rejection of
    unsupported persisted runtime targets.
  - Do not add a replacement abstraction, compatibility manager, dependency, or
    broad migration state.
- Product/process constraints:
  - Use the sanctioned task worktree and return a scoped PR from the current
    remote base.
  - Have ReviewGPT Pro implement a bounded patch, then inspect every hunk before
    applying it.
  - Run focused coverage-bearing checks and the required preliminary and final
    ReviewGPT PR gates concurrently with CI on exact pushed heads.

## Risks and mitigations

1. Risk: Runtime-provider cleanup accidentally removes real model-provider
   behavior.
   Mitigation: Keep `modelProvider`, registered provider config, credentials,
   Codex config emission, setup choices, and usage attribution in scope for
   explicit preservation and regression proof.
2. Risk: Simplification changes persisted session identity or resume routing.
   Mitigation: Preserve serialized wire values and fingerprint inputs; run the
   focused operator-config and assistant-engine continuity suites.
3. Risk: A broad rename creates churn without reducing ownership or branches.
   Mitigation: Accept only deletion/direct-data-flow hunks with a concrete call
   site; retain generic names that still describe real external provider work.
4. Risk: Hosted and local deployments interpret the config at different
   revisions.
   Mitigation: Retain active external and persisted compatibility fields and
   verify no cross-deploy contract changes before declaring deployment concerns.

## Tasks

1. [x] Inventory the sole-runtime branches, their callers, and every active
   public/persisted/hosted compatibility boundary.
2. [x] Send the bounded deletion-first implementation brief to a fresh ReviewGPT Pro
   conversation and wait for an attached patch.
3. [x] Inspect the full patch, reject unrelated or speculative hunks, apply it only
   after `git apply --check`, and simplify further where local evidence requires.
4. [x] Update focused tests and current owner docs only where behavior or ownership
   materially changes.
5. [x] Run diff-aware or package-local coverage-bearing tests plus root typecheck and
   inspect the final diff for identifiers, secrets, scope, and line shape.
6. [x] Commit and push the exact candidate, open a draft PR with the required intent
   contract, run preliminary and final ReviewGPT gates with CI, remediate accepted
   findings, and finish the plan on the approved final head.

## Decisions

- Keep `codex-cli` at public and persisted boundaries that still encode runtime
  compatibility; the cleanup targets internal dispatch indirection rather than a
  wire-format migration.
- Treat Codex model providers as real inference choices, not assistant runtimes.
- Preserve Murph's custom image path because the pinned Codex native image path
  is not available to ordinary API-key-backed inference.
- Preserve `provider: "codex-cli"` in the target-to-config projection because
  focused contract tests prove that projection is still an active compatibility
  boundary; internal normalized config remains concrete and carries no runtime
  selector.
- Keep the current base's appointment-reminder prompt-heading correction out of
  this patch. A clean rebase incorporated that correction before final
  verification without changing this task's runtime-provider patch.

## Verification

- Commands to run:
  - Focused Vitest files for changed operator-config and assistant-engine runtime,
    normalization, session continuity, catalog, and hard-cut contracts.
  - `pnpm test:diff <changed paths...>` when it truthfully covers both owning
    packages and reverse dependents; otherwise package-local coverage commands.
  - `pnpm typecheck`.
  - Exact-head preliminary `completion-specialists` ReviewGPT pass, final
    `pr-review` PASS, and required GitHub Actions checks.
- Expected outcomes:
  - Equivalent Codex configs keep the same serialized runtime identity and
    thread continuity behavior.
  - Unsupported legacy runtime identifiers fail closed.
  - BYO model-provider resolution, strict validation, and usage/pricing tests
    remain green.
  - The PR deletes more runtime-provider machinery than it adds and introduces
    no new execution variant or ownership layer.

## Evidence so far

- ReviewGPT Pro returned one inspected patch changing 37 files at `+325/-730`.
- Full hunk inspection and `git apply --check` passed before applying the exact
  downloaded artifact.
- A focused compatibility test found that the patch removed the live
  `provider: "codex-cli"` projection; the source and matching contract test were
  corrected without restoring internal provider dispatch.
- Root `pnpm typecheck` passed.
- Focused operator-config tests passed: 8 files, 38 tests.
- Focused assistant-cli tests passed: 2 files, 15 tests.
- Focused assistant-engine tests passed: 22 Codex coverage tests and 100
  local-service runtime tests. The latter requires an 8 GiB worker heap locally.
- The first diff-aware lane passed all affected typechecks and 3,497 engine
  tests; its only failures were two prompt-heading assertions already corrected
  on the current base and untouched by this patch.
- The candidate rebased cleanly onto current `origin/main` before the final
  local proof.
- The clean post-rebase diff-aware lane passed every selected typecheck, test,
  package-boundary check, web verification step, and Cloudflare verification
  step. Notable coverage included 3,535 assistant-engine tests, 2,171
  assistant-runtime tests, 435 CLI tests, 9,472 web tests, 2,398 Cloudflare Node
  tests, and 10 Cloudflare Workers tests.
- The first post-rebase attempt exposed a pre-existing CLI artifact-preparation
  lock that outlived a timed-out worker. After removing only the proven empty
  owned lock, preparing the runtime artifacts through the repository command,
  and recording the friction, the focused CLI reproduction and the complete
  diff-aware rerun passed.
- Final base-to-head shape before PR packaging is net deletion in executable
  source and tests; the only additional files are the active execution plan and
  two required developer-friction records.
- Draft PR #1651 opened against the exact pushed candidate with the immutable
  first-review baseline and required intent contract.
- The first simultaneous specialist/final packaging attempt hit the existing
  timestamped audit-ZIP collision recorded by Frog. The affected jobs were
  retried on isolated managed lanes after inspecting the invalid result; no
  review prompt was duplicated in an active thread.
- The substantive preliminary specialist pass returned one low-severity
  coverage finding. Its attached 20-line patch was read in full, confirmed to
  touch only one assistant-engine test, apply-checked, applied deliberately,
  and proven by the direct `codex-runtime-helpers.test.ts` lane: 1 file and 72
  tests passed.
- The package wrapper ignored that focused filename and ran the full
  assistant-engine suite, where one unrelated outbox timing assertion failed.
  Exact-head GitHub assistant coverage subsequently passed with the accepted
  capability assertion, proving the PR-owned lane on the final implementation
  head.
- Final ReviewGPT round 1 returned `ROUND_OUTCOME: PASS` with no qualifying
  findings on the immutable first-reviewed production patch. The accepted
  specialist remediation added only regression proof, so it did not create a
  new substantive final-review round.
- Parent final review re-read the complete current source diff, walked the
  normalization, hosted handoff, session continuity, setup, execution, resume,
  and fail-closed paths, and found no remaining actionable gap.
- All required GitHub checks passed on corrected implementation head
  `32b623970abec92de941dc935f731ddcae3bc5ab`, including release app
  verification, build/typecheck, assistant/CLI/platform coverage, both CLI host
  matrices, fixture coverage, frontend metadata proof, billing proof, private
  artifact checks, and the aggregate release gate.
Completed: 2026-08-11
