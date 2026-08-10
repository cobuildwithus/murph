# Remove retired referral billing copy

Status: completed
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Replace the retired internal billing phrase across live product surfaces and
  owner documentation, while presenting referral rewards as days of Murph and
  preserving server-owned receipt authority.

## Success criteria

- Referral page reward cards and receipt previews show 10 or 14 days of Murph
  without dollar-denominated public reward copy.
- Assistant reward confirmations keep the exact server-provided day-estimate
  label without calculating days, messages, or calendar duration.
- Live tracked sources and docs contain no remaining form of the retired term;
  immutable completed-plan snapshots remain unchanged.
- Production referral states are represented in the design catalog and have
  inspected desktop/mobile evidence.
- Focused tests, typecheck, docs drift, required ReviewGPT specialist review,
  and exact-head PR checks pass.

## Scope

- In scope: public referral presentation, exact assistant receipt wording,
  changelog visuals, focused regression coverage, design-catalog studies, and
  current product/usage owner documentation.
- Out of scope: ledger values, Stripe behavior, qualification rules, referral
  settlement, allowance calculations, and immutable completed-plan snapshots.

## Constraints

- Technical constraints: keep the persisted USD-micros ledger and all reward
  ownership unchanged; derive public days from the existing referral policy;
  reuse production presentation components in catalog studies.
- Product/process constraints: do not expose private evidence; preserve the
  current design-system prohibition on historical funding labels in the live
  catalog; use the PR worktree and exact-head review gates.

## Risks and mitigations

1. Risk: public day labels could be confused with an exact capacity guarantee.
   Mitigation: retain copy that calls them typical duration and explains that
   actual duration varies by model, tools, media, and task complexity.
2. Risk: rendering the full referral page in the large design catalog can time
   out server-side verification.
   Mitigation: expose the existing reward receipt and card presentation pieces
   and render synthetic reward subsets directly.
3. Risk: terminology cleanup could alter internal accounting semantics.
   Mitigation: change presentation and terminology only; keep ledger fields,
   calculations, identifiers, and server authority intact.

## Tasks

1. Remove the retired wording from public web, assistant, changelog, and live
   owner-doc surfaces while preserving exact accounting behavior.
2. Add focused tests and design-catalog states for signup-only, group-only, and
   combined referral rewards.
3. Capture and inspect desktop/mobile evidence for every changed state.
4. Run focused verification, push the candidate, and correct exact-head CI
   failures attributable to the PR.
5. Retry the preliminary ReviewGPT pass after correcting its prior evidence
   gap, resolve findings, and close the plan with the final scoped commit.

## Decisions

- Public referral surfaces use days of Murph; assistant receipts repeat the
  exact day-estimate label supplied by the server.
- The branch now reuses `main`'s persisted-policy day formatter so historical
  receipts remain stable when current offer values change.
- Shared visual props, rather than new wrapper components, keep the production
  changelog render and evidence harness aligned without publishing historical
  wording into the current component catalog.
- The final cross-cutting ReviewGPT gate is not applicable because the patch is
  presentation/prompt-primary and does not change runtime ownership or behavior;
  the mandatory preliminary specialist lenses remain applicable.

## Review progress

- The preliminary specialist review found no product-experience, prompt, or
  frontend defect in the pushed candidate.
- Its three coverage findings were accepted: the referral design-state browser
  proof still targeted the removed full-page study, assistant coverage no longer
  rejected the retired phrase from the assembled skill and provider outputs,
  and changelog coverage did not assert the new semantic labels.
- The focused corrections now exercise all three synthetic reward states and
  their applicable receipts, dynamically reject the retired phrase without
  preserving it in test source, and count all seven rendered `Usage credit`
  labels at the changelog page boundary.
- Parent review restored equivalent dynamic negative guards across each changed
  web surface so the source cleanup does not weaken regression coverage.

## Verification

- Commands to run: focused web and assistant tests; web and assistant-engine
  typechecks; `pnpm test:frontend-design-proof`; `pnpm docs:drift`; stale-copy
  scan; `git diff --check`; ReviewGPT head preflight/specialist pass; exact-head
  GitHub Actions.
- Expected outcomes: all checks pass, credential-gated real-provider cases may
  skip explicitly, the stale-copy scan is empty outside immutable completed
  plans, and the specialist response is substantive with no accepted findings
  left unresolved.
- Completed outcomes: focused web and assistant tests, both typechecks, the
  three-case referral Playwright proof, frontend-design proof, docs drift,
  diff/privacy/stale-copy scans, and all required exact-head GitHub checks
  passed. Preliminary ReviewGPT returned substantive findings; every accepted
  coverage finding was resolved, while credential-gated provider cases and the
  live hosted-local Stripe matrix skipped explicitly as designed.
Completed: 2026-08-09
