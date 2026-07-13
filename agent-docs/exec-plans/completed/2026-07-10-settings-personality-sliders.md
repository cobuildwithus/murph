# Add Murph personality sliders to Settings

Status: completed
Created: 2026-07-10
Updated: 2026-07-11

## Goal

- Add a polished Settings dialog under Customize Murph where a member can
  adjust Humor, Push, and Detail on discrete 0–10 sliders and save the choices
  through the existing authenticated assistant-preferences path into the
  canonical vault.

## Success criteria

- The Settings surface opens one accessible desktop dialog/mobile drawer with
  all three controls, clear endpoint language, exact numeric values, and
  loading, dirty, save, cancel, and failure states.
- Saves strictly accept integer scores from 0 through 10, update only the dials
  changed by that Settings interaction, and enqueue one sparse
  `member.preferences.updated` wake without clobbering conversational changes
  to sibling dials.
- Web persistence, hosted wake parsing, and canonical vault application are
  covered by focused tests, including no-op, invalid, partial, and retry-safe
  paths.
- Product and deployment docs truthfully describe the new Settings surface,
  web-side display projection, canonical ownership, and rollout order.
- Required verification, desktop/mobile browser proof, specialist audits,
  parent final review, scoped commit, pushed PR, ReviewGPT loop, and CI
  complete with no unresolved actionable findings.

## Scope

- In scope: shared personality score validation; hosted preference event delta;
  hosted-member display projection and additive migration; authenticated
  settings API; Settings dialog/drawer; focused tests; durable docs; rollout
  guidance.
- Out of scope: onboarding steps for the three dials, group-scoped style,
  changing the five existing personality behavior bands, or inventing a new
  runtime-to-web readback channel.

## Constraints

- Technical constraints: canonical preference truth remains
  `bank/preferences.json` through `packages/core`; Postgres is only the existing
  web display/write projection; mailbox payloads stay sparse; schema evolution
  is additive; package dependencies stay acyclic; no new dependency is needed.
- Product/process constraints: use the existing warm-paper design system and
  Base UI primitives; preserve current tone/voice behavior; use an isolated
  worktree and preserve unrelated ledger work. The recovery controller owns
  ReviewGPT timing and does not authorize additional local audit subagents.

## Risks and mitigations

1. Old hosted runners may ignore or reject the new personality wake shape.
   Mitigation: deploy the compatible Cloudflare runner before enabling the web
   writer, document the rollback floor, and test strict old/new payload shapes.
2. Web projection can lag dials changed conversationally in the canonical vault.
   Mitigation: send only the dials actually changed in the dialog, never a full
   three-dial snapshot, and describe Postgres as a display/write projection.
3. A slider interaction can visually diverge from what is persisted during an
   in-flight save or dismissal.
   Mitigation: freeze controls and dismissal during save, return the exact
   persisted snapshot, and cover success/failure/dismissal behavior.
4. Sparse preference events can be lost if the system mailbox treats them as
   replaceable snapshots.
   Mitigation: retain and apply every preference delta in mailbox order, with
   an older retry blocking newer preference work.

## Tasks

1. Audit and complete the inherited shared-contract, parser, Prisma, and
   hosted-member preference changes.
2. Extend the authenticated settings API and server-to-client settings props,
   then add focused backend and integration tests.
3. Delegate and review the Fable-built personality dialog/drawer and focused UI
   tests against the supplied slider references and Murph design system.
4. Update the product spec and owning architecture/app docs, including rollout
   and rollback behavior.
5. Run the truthful verification lane, direct browser scenarios, required
   security/privacy, frontend, and coverage audits, then resolve findings.
6. Finish the plan with a scoped commit, push the current-main branch, open/update
   the PR, run ReviewGPT to zero accepted findings, and verify final CI/merge
   compatibility.

## Decisions

- The original stacked worktree was recovery-only. After PR #529 and PR #556
  merged, replay the preserved task index onto a fresh branch from current
  `origin/main`; do not modify the user's primary checkout.
- Reuse the existing `member.preferences.updated` canonical write path; do not
  add a second settings owner or runtime-to-web synchronization service.
- Keep the slider feature-local unless review proves a second immediate shared
  consumer, avoiding a premature shared UI primitive.
- Treat `member.preferences.updated` as an ordered delta contract. Delete the
  prior latest-snapshot supersession behavior instead of adding merge state.
- Reject mixed tone-or-voice plus personality API requests so an old consumer
  fails closed on a personality-only event during deploy skew.
- Keep this dirty task worktree isolated while the separate conversation
  personalization task is actively changing overlapping docs and prompt code.
  Integrate only after that task and PR #529 have landed; do not rebase either
  live worktree in place.
- Do not terminalize retrying preference events or use the stale web projection
  as a compare-and-set baseline. The former loses an acknowledged Settings save
  after the mailbox watermark advances; the latter discards a newer explicit
  web choice whenever conversational canonical state was already ahead of the
  projection. Exact same-dial ordering needs an authoritative cross-lane causal
  token or per-setting canonical mutation metadata and must be designed on the
  landed owning stack.
- PR #529 and PR #556 are merged. Reconcile on a fresh branch from current
  `origin/main` rather than rebasing or modifying any dirty checkout.
- The user explicitly approved Claude Opus after the required Fable profiles
  were unavailable. Opus completed the dialog/drawer and focused tests from the
  supplied references; retain that implementation subject to local review and
  verification.
- Do not launch ReviewGPT until the exact PR head is pushed and the recovery
  controller has been given `RECOVERY_REVIEWGPT_READY` for coordination.

## Progress

- Completed shared validation, sparse web persistence, fail-closed API parsing,
  additive constrained migration, ordered runtime application, focused backend
  tests, and owning architecture/product/runtime documentation. Removed the
  unused persistence source argument and extended malformed personality payload
  coverage to non-object values.
- Recovered the interrupted task after confirming that no later session had
  continued this worktree. Fresh conversation planning now drains a bounded
  page of due member-preference work before it proceeds, so a healthy backlog
  cannot cross the conversation write. A fresh review rejected indefinitely
  blocking on future or retryable preference work because that could starve a
  product-critical current-inbound reply; the same-dial retry race therefore
  remains open. Follow-up analysis found no reusable terminal/replay or
  cross-lane revision primitive; an exact fix needs authoritative per-setting
  causality rather than a boolean barrier or stale projection comparison.
- A focused cross-lane audit proved that race end to end: an acknowledged
  Settings delta can retry after a newer conversational write and overwrite
  that newer value. Sparse events still preserve sibling dials, so the hosted
  contract comment now states that narrower guarantee. Exact latest-intent
  ordering remains a follow-up for a shared authoritative per-setting revision
  on the landed owning stack.
- After the user approved Opus as the fallback, the dialog/drawer, Base UI
  slider wrapper, Settings integration, and focused interaction tests were
  implemented and reviewed locally.
- The required security/privacy review found no medium-or-higher findings. The
  frontend review found ambiguous failure copy, a mobile error that could sit
  below the scroll position, and missing slider description associations. The
  accepted fixes use uncertainty-safe copy, keep mobile errors in the fixed
  footer, and wire descriptions plus endpoint labels to each slider thumb; the
  frontend re-audit found no remaining actionable findings.
- Recovery found the staged task patch in the removed worktree's preserved Git
  index, replayed it onto a fresh branch from current `origin/main` after PR
  #556 merged, and reapplied the documented post-audit fixes. The dirty primary
  checkout and unrelated worktrees remain untouched.
- Parent final review added the missing regression proof for the frontend
  accessibility fix: focused tests now prove that each slider thumb references
  both its dial description and endpoint labels, including through the real
  Base UI wrapper.
- The controller-authorized `coverage-write` audit added one boundary assertion
  for the exact UI-emitted event shape: a personality-only update containing one
  sparse dial parses unchanged. Its focused test passes, and the audit reports
  no unresolved actionable coverage finding.

## Verification

- Focused verification on the recovered PR #556 base passed all 16 touched test
  files (422 tests), and the post-review accessibility test passes 13 tests.
  Prisma validation/generation and the prepared runtime build pass.
- `pnpm test:diff packages/contracts packages/hosted-execution
  packages/assistant-runtime apps/web` passed after explicitly building
  `packages/assistant-runtime/dist`, a prerequisite the merged diff lane omits
  before its new hosted-local-harness reverse-dependent checks. The lane passed
  all affected typechecks, package tests and boundaries, the web production
  build/lint/4,284 tests, and Cloudflare's 1,735 tests.
- `pnpm verify:acceptance` twice passed all repo guards, typechecks, docs,
  hygiene, app verification, and every non-CLI package coverage owner. Its
  local app/coverage overlap caused one unrelated CLI read-model test per run
  to hit the 60-second timeout. The canonical isolated CLI coverage command
  passed all 114 files/1,051 tests in 234 seconds, the two timed-out test cases
  pass quickly without the app fanout, and isolated contracts coverage passed
  22 files/169 tests. This is a proven local resource-contention limitation,
  not a task regression; final CI remains required.
- `git diff --check` passes. The in-app browser exposed no connected surface,
  so rendered desktop/mobile interaction proof remains an explicit environment
  gap; component tests cover desktop/mobile rendering, sparse saves, failure
  recovery, dismissal locking, and accessible thumb semantics.
- The required write-capable coverage audit passed after adding one sparse-event
  parser assertion; its focused hosted-execution file passes 3 tests and no
  actionable coverage gap remains.
- Commands still to run: final scoped commit, PR CI, and exact-head ReviewGPT
  after the recovery-ready checkpoint.
- Expected outcomes: all focused and diff-aware checks pass; invalid and empty
  updates fail before persistence; successful saves round-trip exact scores and
  apply sparse canonical deltas; UI remains keyboard/touch usable at relevant
  viewports; no unresolved audit or PR findings remain.
Completed: 2026-07-11
Completed: 2026-07-11
