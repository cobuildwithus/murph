# Audit and polish the Epic Clinical Records beta UI

Status: completed
Created: 2026-07-16
Updated: 2026-07-16

## Goal

- Have Claude Fable audit the member-facing Clinical Records flow and apply the
  smallest verified improvements that make connecting, understanding import
  status, recovering from errors, and disconnecting clearer and easier.

## Success criteria

- Fable reviews the existing `/records` and `/records/connect` experience for
  hierarchy, clarity, interaction, responsive behavior, accessibility, state
  handling, and consistency with Murph's product patterns.
- Every Fable finding is verified against the real code and classified as
  accepted, rejected, or out of scope; accepted findings are fixed without new
  state owners, dependencies, or speculative abstractions.
- Focused UI tests, Web typecheck/lint or the truthful selected Web verification
  lane, required completion audits, parent final review, PR CI, and any required
  ReviewGPT follow-up pass with no unresolved accepted finding.

## Scope

- In scope: the existing member-facing Records status and Epic connection
  pages, their direct UI tests, and only the smallest adjacent copy or component
  changes needed to resolve verified findings.
- Out of scope: Clinical Records auth, provider-directory, retrieval, storage,
  retry/reconnect, continuous-sync, or deployment architecture changes.

## Constraints

- Preserve the one-time Epic import model and existing consent, auth, privacy,
  and disconnect behavior.
- Keep exact health-record details, browser claims, provider tokens, and member
  identifiers out of prompts, screenshots, logs, and durable review artifacts.
- Prefer deletion, clearer ordering, and existing components over new
  abstractions or dependencies.
- Work only in the existing `codex/epic-beta-live` task worktree and preserve
  unrelated ledger lanes.

## Tasks

1. Inspect the current UI, tests, and available rendered evidence, then run a
   bounded review-only Fable audit.
2. Verify every finding against the source and product/design guidance.
3. Implement accepted improvements and focused regression coverage.
4. Run the required frontend, coverage, verification, Fable follow-up, and
   parent final-review loops.
5. Close the plan, commit and push the scoped result, update the PR description,
   and complete the required PR gates.

## Verification

- Focused Records UI tests during implementation.
- Truthful Web diff/app verification selected from
  `agent-docs/operations/verification-and-runtime.md`.
- Desktop and mobile browser proof when an in-app browser session is available;
  otherwise report the exact visual-proof gap.
- Required `frontend-review`, `coverage-write`, Claude Fable follow-up, parent
  final review, PR CI, and ReviewGPT follow-up when the final diff remains
  eligible.

## Completion evidence

- Fable's source audit identified stuck back-navigation pending states,
  insufficient distinction between complete and attention states, focus loss
  during search/disconnect flows, misleading or inconsistent status copy,
  dialog ordering, and missing loading semantics. The verified findings were
  corrected with existing component and browser primitives.
- Fable's remediation pass confirmed those corrections and identified two
  remaining low-severity issues: whitespace-only search validation and a
  mouse-visible programmatic focus ring. Both were corrected and covered.
- Suggestions to remove the dialog footer spacing overrides or change only
  these cards' radius were rejected after source comparison: the former
  offsets shared component negative margins, and the latter would create drift
  from adjacent Records and consent surfaces.
- The required frontend review found one low-severity query/result consistency
  issue during pending search. The field now stays focusable but read-only
  until the request settles, with regression coverage. The coverage-write pass
  added focused coverage and found no remaining backend-test gap.
- Focused Records component suite: 11 tests passed. Scoped ESLint and prepared
  Web typecheck passed. The affected-app verification passed dependency,
  boundary, orchestration, crypto, and raw-health-log guards; Web dev smoke;
  production build; lint with zero errors; and 5,399 tests with 141 skipped.
- Rendered desktop and mobile proof could not run because no in-app browser was
  attached to this environment. Source review, component rendering, and the
  production build are the available UI evidence.
Completed: 2026-07-16
