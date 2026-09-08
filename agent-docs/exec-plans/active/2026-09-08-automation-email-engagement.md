# Complete cross-channel automation engagement fix

Status: active
Created: 2026-09-08
Updated: 2026-09-08

## Outcome and authority

Extend the tested Telegram correction to accepted email conversations and prepare one pull request. Preserve the 28-day inactivity window, current route and consent checks, usage authorization, and foreground priority. No production mutation or deployment is in scope.

## Evidence and implementation

Email ingress resolves an authorized route, builds an email-prefixed conversation event, and appends it through the authenticated Web mailbox callback. The engagement lookup currently excludes that event family. Extend the same metadata-only query with the existing email prefix; do not decode content or introduce new state. Structural mailbox retention exceeds the activity window.

## Product UX

Effort: Patch. Active members using Telegram or email retain ordinary scheduled-work eligibility with a dormant Linq route. Inactive and usage-denied members retain their existing behavior. Background system work never qualifies as conversation activity. The assistant's instructions, tools, and output decisions do not change.

## Verification and candidate review

Pending PostgreSQL regression, focused mailbox/reconciliation/changelog tests, Web typecheck, lint, complexity, and parent review. PR CI and final ReviewGPT run on the stable pushed candidate.
