# PR 932 native-reply destination correlation

Status: completed
Created: 2026-07-28
Updated: 2026-07-28

## Goal

Bind a Linq provider-native reply to the exact accepted group-outreach opener
that it references, so multiple live group intents in one direct chat can never
send a link for the wrong group.

## Retrospective trigger

ReviewGPT round 26 returned `RETROSPECTIVE_REQUIRED` after finding that
`readHostedGroupJoinOutreachReplyContextTx` selects the newest available opener
without consulting Linq's `reply_to.message_id`. This is unchanged original-PR
source, but the round-26 instant-start proof made the unsupported exact-origin
claim explicit. The PR is already well beyond the source-churn and round-count
thresholds, so no further tactical correction may begin until this
requirement-level decision is recorded.

## Requirement-level decision

- A nonempty provider `reply_to.message_id` is authoritative for group-outreach
  recovery. Resolve it through the accepted opener's existing
  `HostedLinqDelivery.messageLookupKey`.
- If that provider anchor is absent from the matching participant/chat/line
  delivery set, return no group context and let the existing ordinary inbound
  path respond. Never replace an explicit unmatched anchor with recency.
- When the provider sends no native-reply anchor, preserve the existing newest
  available opener rule as the direct thread's conversational context.
- Add no persisted state, index, queue, lifecycle, or reconciliation owner. The
  correction is one additional lookup constraint at the existing delivery
  correlation boundary.

## Shape decision

- The original requirement remains one private opener followed by one reply and
  the exact originating group's phone-bound link.
- The first-reviewed and current shapes are already a large indivisible
  provider/onboarding feature. Round 26 reports roughly 4.6k authored-source
  lines of current churn and no new production failure in the latest copy-bank
  or invite-handoff corrections.
- Continue only with the narrow existing-owner fix and production-faithful
  proof. Do not use the finding to add another correlation mechanism or broaden
  the PR.

## Success criteria

- Two accepted openers for different groups can coexist in one direct chat.
- A native reply to the older opener resolves only the older group, and a
  native reply to the newer opener resolves only the newer group.
- Instant-start replanning and the ordinary non-instant-start path both preserve
  that exact destination.
- An explicit unmatched native-reply anchor never falls back to another group's
  opener.
- Focused tests, Web typecheck, canonical diff verification, acceptance,
  exact-head CI, and a subsequent ReviewGPT correction round pass.

## Tasks

1. [x] Add failing production-faithful two-group correlation proof.
2. [x] Pass provider reply authority into the existing outreach resolver.
3. [x] Prove instant-start, ordinary fallback, unmatched-anchor, and retry
       behavior.
4. [x] Run required local verification and prepare the correction for its
       exact-head ReviewGPT and CI gates.

## Evidence

- The real-PostgreSQL two-group case failed before the fix: a native reply
  anchored to the older opener returned the newer group's join URL.
- The resolver now derives the provider message blind-index candidates from the
  inbound native-reply anchor and constrains the existing accepted-delivery
  query. No schema, state owner, index, or lifecycle changed.
- The PostgreSQL suite passes all 14 scenarios, including exact older/newer
  destinations and unmatched-anchor suppression.
- Focused dispatcher/store proof passes 171 tests. Its instant-start case
  contains two candidate groups and returns the group referenced by the native
  reply through the admission/enrollment replan.
- Full Web typecheck, targeted lint, and agent-doc drift pass.
- Canonical `pnpm test:diff apps/web` passes: 559 test files passed and 16
  skipped; 7,318 tests passed and 220 skipped; typecheck, lint with zero errors,
  development smoke, and production build passed.
- Canonical `pnpm verify:acceptance` passes all workspace typecheck, package
  coverage, Web/Cloudflare application verification, build, artifact, and
  package-boundary lanes.

Completed: 2026-07-28
Completed: 2026-07-28
