# Memory and reminder maintenance

Status: active
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- When a person says a proactive reminder arrived during a concrete conflict,
  Murph resolves that occurrence without guilt or pressure and can, with
  explicit consent, make flexible private reminders skip obvious calendar or
  separately authorized travel conflicts.
- Keep the overnight memory owner memory-first while reusing canonical
  automation and connected-app boundaries for a bounded seven-day audit.

## Success criteria

- Ordinary direct-turn guidance treats a mistimed interruption as support-loop
  feedback, resolves the current occurrence first, and never claims a repair
  without a successful canonical tool result.
- Every generated private reminder carries an explicit `fixed` or
  `skip-when-busy` policy; `fixed` remains the safe default.
- Only the exact built-in member maintenance occurrence can access the narrow
  maintenance tool, and that tool cannot create automations, change lifecycle,
  schedule, route, status, tags, title, or account connections.
- Connected evidence remains untrusted and is reduced to expiring busy
  intervals without persisting provider content.
- Focused assistant-engine tests and typecheck pass, exact-head CI is green,
  required ReviewGPT specialist/final gates have no unresolved findings, and
  the final diff contains no personal identifiers.

## Scope

- In scope:
  - Assistant prompt and `behavior-followthrough` guidance for mistimed support
    and explicit reminder availability policy.
  - Exact member-maintenance dynamic-tool exposure, connected-app reads, and
    instruction-only automation repair.
  - Nightly memory-first managed maintenance instructions and focused
    assistant-engine regression tests.
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
  - Calendar connection is not consent. Email/travel reads require separate
    explicit consent.
  - Exact-time, medical, clinician-directed, and safety-critical support stays
    fixed.
  - The current reminder occurrence is handled before optional integration
    offers, and a one-off conflict does not become a durable preference.
  - Use the isolated worktree/PR path, focused local proof, preliminary
    product-experience/prompt/coverage review, final ReviewGPT, and exact-head CI.

## Risks and mitigations

1. Risk: Untrusted calendar or email content influences durable automation
   instructions.
   Mitigation: Expose only read operations plus an instruction-only patch,
   require exact maintenance authority at execution, preserve all non-owned
   instruction bytes, and persist only bounded busy intervals.
2. Risk: A maintenance turn mutates an ineligible or safety-critical
   automation.
   Mitigation: Require the explicit `skip-when-busy` line, exclude fixed,
   maintenance, group, inactive, and expired records, and enforce the narrow
   mutation shape in code and tests.
3. Risk: Reminder maintenance failure interferes with canonical memory work or
   foreground replies.
   Mitigation: Run memory consolidation first, treat later failure as
   independent, keep the work in the existing silent finite maintenance lane,
   and retain foreground preemption.
4. Risk: Daily maintenance increases provider load or proactive send volume.
   Mitigation: Skip connected-app work when no eligible reminder exists, issue
   no user-facing message, and patch only changed instructions.

## Tasks

- [x] Port the supplied behavioral intent onto current `origin/main` without
   forcing context-light hunks.
- [x] Trace and harden the exact maintenance tool, automation owner, connected-app
   read boundary, notification execution context, and prompt/skill behavior.
- [x] Add focused policy, planning, scheduling, notification-context, and managed
   automation tests.
- [x] Update live architecture, security, and reliability owner docs for the new
   narrow maintenance boundary.
- [ ] Run focused tests, typecheck, direct diff/privacy review, commit and push the
   candidate, then complete ReviewGPT and CI gates.

## Decisions

- Treat the patch as behavioral intent because it does not mechanically apply
  to current `origin/main`.
- Keep availability truth inside canonical automation instructions as one
  expiring engine-owned block rather than adding a new persisted state owner.
- Admit only an explicit provider read-tool allowlist. Outlook calendar and
  email share one toolkit, so toolkit prefixes alone cannot enforce source or
  read-only boundaries.
- Run the model under the one-shot, network-denied
  `murph-member-memory-maintenance` permission profile. It may read the vault
  and write only canonical memory plus the audit, staging, and lock
  infrastructure those canonical writes require; reminder mutation stays
  behind the scheduled hosted owner.

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
    hosted Codex configuration suites passed 309 tests with 2 skipped.
  - `git diff --check` and added-line identifier/secret scans passed.

## Current state

- Implementation and focused local proof are complete.
- Next: create the exact candidate commit and PR, then run the preliminary
  product/prompt/coverage specialist review and final ReviewGPT concurrently
  with required CI.
