# Keep Text Murph available after phone connection

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Goal and evidence

Give an active member with a verified phone an eligible managed home line so native onboarding can offer Text Murph and its contact card, including when proactive welcome capacity is exhausted. Reuse the current line owner and phone-link composition.

Native onboarding projects its text action only from the assigned line. Phone linking originally synchronized identity after email activation without assigning a line. The prior local fix adds that assignment, but companion admission still skips repair for already synchronized phones. Separately, tolerant line assignment returns before saving a usable line when proactive capacity is unavailable.

## Scope

Remove the tolerant-path early return that discards an eligible line at the proactive limit; retain welcome suppression. Use the existing idempotent phone owner during active companion admission to repair missing routes. Preserve legacy credential handoff boundaries, disabled/unhealthy line exclusions, and the no-eligible-line fallback. No new number, queue, or state owner. No iOS UI changes or production mutation.

## Verification and completion

Product UX: Ready. Five focused suites passed (118 tests): companion admission/replay and legacy credential boundaries, line quota and atomic contention, phone-link composition, hosted contact context, and native onboarding/contact-card projection. The quota cases now prove an assigned number with no proactive welcome; absent eligible lines still do not produce a number.

Web typecheck, complexity, documentation drift, whitespace and privacy checks passed. Changelog generation and both changelog suites passed (17 tests). The change deletes the special route-discarding branch and reuses the existing idempotent phone owner for admission repair. No new state, provider calls, or UI owner. The complete diff was reviewed.

Deployment still requires the earlier runtime welcome-key readers before Web. Contextual greetings after an existing conversation are a separate outstanding behavior, not implemented by this routing fix.
Completed: 2026-09-12
