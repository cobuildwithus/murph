# Complete cross-channel automation engagement fix

Status: completed
Created: 2026-09-08
Updated: 2026-09-08

## Outcome and authority

Extend the tested Telegram correction to accepted email conversations and prepare one pull request. Preserve the 28-day inactivity window, current route and consent checks, usage authorization, and foreground priority. No production mutation or deployment is in scope.

## Evidence and implementation

Email ingress resolves an authorized route, builds an email-prefixed conversation event, and appends it through the authenticated Web mailbox callback. The engagement lookup currently excludes that event family. Extend the same metadata-only query with the existing email prefix; do not decode content or introduce new state. Structural mailbox retention exceeds the activity window.

## Product UX

Effort: Patch. Active members using Telegram or email retain ordinary scheduled-work eligibility with a dormant Linq route. Inactive and usage-denied members retain their existing behavior. Background system work never qualifies as conversation activity. The assistant's instructions, tools, and output decisions do not change.

## Verification and candidate review

The real PostgreSQL regression rejected email activity before the extension and passed afterward. All 149 focused tests across mailbox, reconciliation, email ingress, and changelog passed. Web typecheck, focused ESLint (one pre-existing warning), and complexity guard passed. Parent review confirmed the same single metadata-only query, no new authority or persisted state, and preserved usage/consent/delivery checks. Product UX: Ready for the admission patch. The implementation is complete in PR #3046; exact-head CI and final ReviewGPT remain PR delivery gates, recorded in the PR body. No production recovery or deployment was performed.
Completed: 2026-09-08
