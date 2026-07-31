# Memory and reminder maintenance

Status: completed
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- When a person says a proactive reminder arrived during a concrete conflict,
  Murph resolves that occurrence without guilt or pressure and can, with
  explicit consent and exact account selection, make flexible private reminders
  skip obvious Google Calendar or Outlook conflicts.
- Keep memory consolidation isolated from a later read-only reminder refresh
  while reusing canonical automation and connected-app boundaries.

## Success criteria

- Ordinary direct-turn guidance treats a mistimed interruption as support-loop
  feedback, resolves the current occurrence first, and never claims a repair
  without a successful canonical tool result.
- Every generated private reminder carries an explicit `fixed` or
  `skip-when-busy` policy; `fixed` remains the safe default.
- Only the exact built-in member maintenance occurrence can access the narrow
  maintenance tool, and that tool cannot create automations, change lifecycle,
  schedule, route, status, tags, title, or account connections.
- The model can name only an eligible automation. Host code owns the exact
  account, current seven-day provider request, result reduction, and fenced
  suffix replacement; raw provider content never reaches the model or
  persistence.
- Focused assistant-engine tests and typecheck pass, exact-head CI is green,
  required ReviewGPT specialist/final gates have no unresolved findings, and
  the final diff contains no personal identifiers.

## Scope

- In scope:
  - Assistant prompt and `behavior-followthrough` guidance for mistimed support
    and explicit reminder availability policy.
  - Exact reminder-maintenance dynamic-tool exposure, host-built calendar
    reads, version-fenced owned-suffix replacement, and deterministic
    pre-provider skip execution.
  - Separate nightly memory and reminder maintenance instructions plus focused
    core, assistant-engine, and assistant-runtime regression tests.
  - Durable architecture, security, and reliability documentation required by
    the new maintenance trust boundary.
- Out of scope:
  - New databases, queues, reminder state owners, calendar event writes, account
    connection management, broad inbox scans, group reminder maintenance, and
    automatic rescheduling.
  - Frontend changes or new user-facing messages.

## Constraints

- Technical constraints:
  - Canonical memory stays in `bank/memory.md`; canonical reminder instructions
    stay in `bank/automations/*.md`.
  - Reuse the existing connected-app and automation ports without exposing
    their broader ordinary-turn schemas to maintenance.
  - Validate exact built-in occurrence authority at tool execution, not through
    prompt text alone.
  - Keep all provider reads bounded to one unambiguous account and seven days.
- Product/process constraints:
  - Calendar connection is not consent. The foreground interaction must obtain
    explicit opt-in and store one exact active Google Calendar or Outlook
    account; missing or ambiguous selection remains fixed.
  - Exact-time, medical, clinician-directed, and safety-critical support stays
    fixed.
  - The current reminder occurrence is handled before optional integration
    offers, and a one-off conflict does not become a durable preference.
  - Use the isolated worktree/PR path, focused local proof, preliminary
    product-experience/prompt/coverage review, final ReviewGPT, and exact-head CI.

## Risks and mitigations

1. Risk: Untrusted calendar content influences durable automation
   instructions.
   Mitigation: Expose one lookup-only composite refresh, build the provider
   request in host code, reduce raw results to timestamps before model output,
   and let the scheduled owner construct and fence the owned suffix.
2. Risk: A maintenance turn mutates an ineligible or safety-critical
   automation.
   Mitigation: Require the explicit `skip-when-busy` line, exclude fixed,
   maintenance, group, inactive, and expired records, and enforce the narrow
   mutation shape in code and tests.
3. Risk: Reminder maintenance failure interferes with canonical memory work or
   foreground replies.
   Mitigation: Use a separate later exact-id read-only turn, keep both jobs in
   the existing silent finite maintenance lane, and retain foreground
   preemption.
4. Risk: Daily maintenance increases provider load or proactive send volume.
   Mitigation: Skip connected-app work when no eligible reminder exists, issue
   no user-facing message, and patch only changed instructions.
5. Risk: Revoked policy, changed account, failed refresh, or stale evidence
   suppresses a reminder.
   Mitigation: Ordinary instruction writes strip the owned suffix; refresh
   revalidates the source/account/version after the read; delivery requires
   exact current policy/account authorization and a canonical evidence lease
   for an occurrence scheduled within 24 hours of generation. Disconnect stops
   future refreshes but can take up to one day to age out an existing lease.

## Tasks

- [x] Port the supplied behavioral intent onto current `origin/main` without
   forcing context-light hunks.
- [x] Trace and harden the exact maintenance tool, automation owner, connected-app
   read boundary, notification execution context, and prompt/skill behavior.
- [x] Add focused policy, planning, scheduling, notification-context, and managed
   automation tests.
- [x] Update live architecture, security, and reliability owner docs for the new
   narrow maintenance boundary.
- [x] Run focused tests, typecheck, direct diff/privacy review, commit and push the
  candidate, then complete ReviewGPT and CI gates.

## Decisions

- Treat the patch as behavioral intent because it does not mechanically apply
  to current `origin/main`.
- Keep availability truth inside canonical automation instructions as one
  expiring engine-owned block rather than adding a new persisted state owner.
- Support calendar conflicts only in this change; delete travel/email
  interpretation rather than sharing raw message content with a vault-capable
  model.
- Use one model-visible `refresh_calendar_availability` action with only an
  automation lookup. Host code chooses the exact Google Calendar or Outlook
  action and account, derives the current seven-day window, caps and normalizes
  the result, then submits it to the scheduled owner with the pre-read
  automation version.
- Keep the existing memory automation and permission profile unchanged. Add a
  separate network-denied reminder maintenance turn that can read only
  `bank/automations` and has no memory authority.
- A clean empty read removes the old block. Failed or incomplete refreshes
  leave instructions unchanged, but delivery ignores evidence for occurrences
  scheduled more than 24 hours after generation so failure remains fail-open.
- Round 2 retrospective chose a bounded derived-data lease instead of a live
  account-status network check on every occurrence. Setup remains pending until
  the first successful refresh. Disconnect/revoke prevents future refreshes but
  may leave an issued lease usable for occurrences scheduled within 24 hours;
  policy removal or account replacement invalidates it immediately.

## Verification

- Commands to run:
  - Focused Vitest over the new policy test and directly affected planning,
    managed-automation, cron, and notification-runtime tests.
  - `pnpm --dir packages/assistant-engine typecheck`.
  - `git diff --check` plus identifier/path leakage searches over the final diff.
  - Required exact-head GitHub Actions and ReviewGPT specialist/final gates.
- Expected outcomes:
  - All focused checks pass, CI is green, the specialist outcome passes or every
    accepted finding is resolved, final ReviewGPT reaches zero accepted
    findings, and no private provider content or direct identifier is added.
- Local results:
  - `@murphai/hosted-execution` typecheck passed; its focused permission suite
    passed 3 tests.
  - `@murphai/core` typecheck passed; its focused automation persistence suite
    passed 21 tests.
  - `@murphai/assistant-engine` typecheck passed; eight focused suites passed
    303 tests.
  - `@murphai/assistant-runtime` typecheck passed; the full workspace phase and
    hosted Codex configuration suites passed 310 tests with 2 skipped.
  - `git diff --check` and added-line identifier/secret scans passed.
  - The branch rebased cleanly onto the latest `origin/main`; the full focused
    matrix above passed again on the rebased candidate.
  - Preliminary specialist ReviewGPT and final round 1 independently found the
    generic connected-app/model authority and missing account/revocation
    binding unsafe. The replacement design removes model-supplied provider
    queries and instruction patches, separates memory authority, binds one
    exact calendar account, and makes revocation/staleness fail open.
  - Post-remediation focused core, assistant-engine, and assistant-runtime
    policy/typecheck suites pass locally. Deterministic foreground
    provider-input capture matches the pre-change baseline exactly: direct
    24,404 tokens / 111,676 bytes with 14 tools, and group 19,861 tokens /
    91,336 bytes with 12 tools.
  - Round 2 required an architecture retrospective for disconnect semantics.
    The recorded decision keeps a truthful 24-hour derived-data lease instead
    of adding a live connected-account check to every reminder. Focused prompt
    and managed-automation proof passed 63 tests plus assistant-engine
    typecheck.
  - CI exposed the stable system-prompt byte budget after the truthful wording
    change. The wording was compressed without changing the contract; the exact
    prompt-budget regression and all 9 reminder-maintenance policy tests passed.
  - Final ReviewGPT round 3 passed with no findings on the current executable
    head. Exact-head GitHub Actions are fully green, and final diff/privacy
    review passed.

## Current state

- The host-owned calendar-only implementation, bounded evidence-lease contract,
  focused local proof, preliminary specialist remediation, final ReviewGPT
  correction loop, exact-head CI, parent review, and privacy review are
  complete.
- The draft PR is ready for human review.
Completed: 2026-07-30
