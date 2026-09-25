# Welcome members over email and text

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Goal and evidence

Send the same signup welcome over both verified email and the eligible direct text route when both are available. Preserve later phone connection, per-channel deduplication, line capacity, recipient authorization, suppression after a reply, and one activation/follow-up.

The existing activation still selects only one welcome route. The prior phone-link change handles a subsequently connected phone but skips already assigned text routes, so it cannot supply both welcomes during initial signup.

## Implementation

When both routes are eligible, keep the original welcome identity for email and append the phone welcome with the existing phone identity in the same activation transaction. Keep the onboarding follow-up route unchanged. Share the existing exact-text notification composition between activation and later phone connection; no schema or runtime notification shape change.

## Product UX and proof

Exercise both destinations available at signup, email then phone, phone only, email only, suppressed welcome, exhausted line capacity, and replay. Both destinations receive the same message once. Existing line policy remains authoritative. Use synthetic recipients and delivery ports only.

Product UX: Ready. The activation tests prove both destinations are queued together with the same welcome text, stable independent keys across source events, one follow-up route, and preserved suppression and line-capacity policy. Existing phone-only, email-only, Telegram, and later-phone cases pass.

Verification passed:

- Hosted-execution build; Web and assistant-engine typechecks.
- Five focused Web suites: activation, phone welcome, authentication completion, changelog fragments and page (64 tests); final activation rerun after routing extraction (33 tests).
- `pnpm test:assistant:live -- --test 'queues one signup welcome on each channel regardless of delivery order: emailFirst=true'` and the corresponding `emailFirst=false` journey. Both leave exactly two outbox messages with distinct channel identities after replay. Email reuses its existing intent; phone replay is suppressed. The exact-text path makes zero model/provider requests despite running through the local subscription journey harness.
- Complexity, documentation drift, whitespace and privacy checks. The activation owner's measured complexity debt decreased.

Review: the complete source/test/documentation diff preserves route authorization, existing wake formats and legacy delivery identities. A shared pure builder replaces duplicate welcome composition. Queue admission is atomic with activation; delivery remains independently owned by the existing outbox. No new tables, jobs, follow-ups, or provider paths. No PR was opened; deployment remains separate.

## Deployment

This extends the prior local phone-welcome commit. Its runtime welcome-key readers must deploy before Web produces the phone identity. There are no migrations or new jobs. No production backfill or direct member send is included.
Completed: 2026-09-12
