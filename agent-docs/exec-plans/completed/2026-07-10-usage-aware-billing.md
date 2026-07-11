# Usage-Aware Billing

Status: completed
Created: 2026-07-10
Updated: 2026-07-11

## Goal

- Let a hosted member see their current included AI usage and honest runway in Settings, and let Murph read the same web-owned billing projection through one read-only dynamic tool so a manual, in-thread upgrade heads-up can use current facts.
- Correct exhausted synthetic group-thread handling so it never presents a personal Pulse Trial conversion path.

## Success criteria

- `apps/web` owns one canonical member-scoped usage-status projection derived from the existing allowance resolver and hosted usage ledger, with no new persisted state and no Stripe call on the read path.
- Settings presents plan, used/remaining included usage, period/reset timing, and a bounded forecast/action when the evidence supports it.
- Hosted Murph exposes one read-only `murph.plan_usage` tool backed by the same projection and server-derived first-party action, without subscription mutation authority.
- Trial, paid Pulse, paid Edge, sponsored Family, and synthetic group-thread cases remain distinct; group exhaustion cannot emit trial conversion copy.
- Automated usage triggers, recurring asks, group balance UI, and group top-up accounting stay out of scope until the manual product gates are met.
- Focused tests, the full required verification lane, specialist audits, parent final review, PR CI, and the PR ReviewGPT loop all complete with no unresolved accepted findings.

## Scope

- In scope:
  - Canonical usage status and forecast read service in `apps/web`.
  - Authenticated Settings usage UI implemented through the repo's Fable route.
  - Signed web callback plus assistant-engine dynamic read tool.
  - Honest assistant guidance and current hard-limit notice correctness.
  - Product/architecture docs and focused regression coverage.
- Out of scope:
  - Automatic threshold monitoring or unsolicited assistant sends.
  - Group shared-balance persistence, payment links, checkout/top-up routes, payer celebrations, or repeated pleas.
  - Generic billing transition machinery or direct tool-driven billing mutations.

## Constraints

- Technical constraints:
  - Keep `apps/web` as the only owner of hosted usage and billing truth.
  - Reuse current allowance/billing primitives and signed runtime callback patterns; add no schema, queue, cron, or duplicate ledger.
  - Forecast cost-weighted included usage rather than literal token inventory, and omit a forecast when current evidence is insufficient or exhausted.
  - Return only member-scoped, bounded billing facts and server-derived actions to the hosted runtime.
- Product/process constraints:
  - Personal copy is a warm, direct heads-up, never an existential plea or guilt frame.
  - Group comedy remains a manual experiment and must use honest numbers, one ask per dry spell, no shame, and a neutral conversational beat.
  - Preserve unrelated work, implement the UI only through Fable, commit with `scripts/finish-task`, open a PR, and run ReviewGPT to completion.

## Risks and mitigations

1. Risk: a naive forecast overstates precision or creates fake urgency.
   Mitigation: derive it from actual period spend and elapsed time, expose its basis, clamp to the current period, and omit it when it cannot be stated honestly.
2. Risk: the assistant gains a second billing authority or exposes another member's state.
   Mitigation: keep the tool read-only, bind the callback to the current signed runtime member, and derive all actions server-side.
3. Risk: the UI or copy turns a usage boundary into a dark pattern.
   Mitigation: show plain numbers first, keep the action secondary until relevant, and prohibit guilt, fake scarcity, automated cadence, and group shame.
4. Risk: a synthetic group member is confused with a Pulse Trial because both currently use the same numeric cap.
   Mitigation: classify allowance source explicitly instead of inferring product state from the amount.

## Tasks

1. Trace the current allowance, billing action, settings, signed callback, dynamic tool, and hard-limit notice seams on the latest `main`.
2. Add the canonical usage-status projection and unit coverage, including plan/phase/source/action and conservative forecast behavior.
3. Add the signed callback and read-only assistant tool, plus prompt/tool guidance and boundary tests.
4. Delegate the Settings UI implementation to Fable, then inspect desktop/mobile states and focused component behavior.
5. Fix synthetic group-thread limit classification and any directly related stale Family copy without adding a group balance system.
6. Update durable product/architecture docs, run required verification and specialist audits, and resolve all findings.
7. Close the plan with a scoped commit, push, open the PR, run ReviewGPT rounds to zero accepted findings, and confirm final CI/mergeability.

## Decisions

- The first PR deliberately ships the personal read/visibility primitive and correctness fixes only. Manual 1:1 and group experiments remain operational product tests, not automated product state.
- Usage is expressed as included AI usage/cost capacity, not a literal token count, because the existing entitlement is cost-weighted across models.
- The assistant tool returns a server-authorized action descriptor/URL and never accepts a target plan or performs a billing mutation.

## Current state

- Done: canonical usage projection, signed callback, runtime propagation, read-only assistant tool, plan/forecast/action edge-case fixes, synthetic group classification, reset-only group copy, durable docs, Settings usage UI and group-thread banner, focused owner coverage, web and Cloudflare typechecks, lint, formatting, and diff checks. Security review found one cross-member runtime-fence gap; the narrow fence fix, outer-Worker regression, 187 focused Cloudflare tests, Cloudflare typecheck, and clean security re-audit closed it. Frontend review found that the group banner still linked to personal Settings; the banner now has no CTA, uses a chat-scoped accessible label, and its focused page test passes 10/10. The coverage-writing pass added assertions that both active and denied thread-container decisions retain their explicit source. Parent final review found no additional issue. A local Settings server booted, but no browser backend is available, so desktop/mobile rendering remains an explicit verification gap.
- Now: close the reviewed task with `scripts/finish-task`, rebase the scoped commit onto current `origin/main` (including merged PR #556), and run the full acceptance lane on the reconciled head.
- Next: push/open the PR, report the exact-head ReviewGPT coordination checkpoint, then clear ReviewGPT, CI, and mergeability gates.

## Verification

- Commands to run:
  - Focused Vitest files for usage allowance/status, signed callback, assistant dynamic tools, hard-limit notice selection, and Settings rendering.
  - `pnpm test:diff <all touched owner paths>` during iteration when truthful.
  - `pnpm verify:acceptance` for the high-risk cross-owner final baseline.
  - Direct authenticated usage-status/tool scenarios plus desktop/mobile rendered Settings inspection.
  - Required `security-privacy-review`, `frontend-review`, and `coverage-write` subagent passes, followed by parent final review.
  - PR head preflight, ReviewGPT rounds to `REVIEW_COMPLETE` with zero accepted findings, final PR CI, and mergeability proof.
- Expected outcomes:
  - Every selected command passes on the final pushed head, direct scenarios use only synthetic member data, and all audit findings are fixed or explicitly rejected with evidence.
Completed: 2026-07-11
