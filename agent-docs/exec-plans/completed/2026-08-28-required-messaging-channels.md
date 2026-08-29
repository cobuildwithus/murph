# Required Messaging Channels Across Web And iOS

Status: completed
Owner: Codex
Started: 2026-08-28
Updated: 2026-08-29

## Goal

Require every hosted member who enters through Web or the native companion app
to add either a verified phone number or a linked Telegram account before
normal onboarding continues. Keep verified email as a valid authentication and
delivery fallback, restore the founder welcome email for native email signup,
and preserve the existing immediate welcome plus three-day onboarding sequence
over the best available authorized route.

## Product UX Plan

Effort: Product change.

### Requirement Boundary

- Email remains valid for sign-in, account recovery, and founder outreach, but
  no longer completes messaging setup by itself.
- A verified phone/Linq route or linked Telegram identity completes setup.
  Telegram may be awaiting the member's first inbound message and still count
  as linked.
- Web keeps its existing phone/Telegram setup surface. iOS adds one native gate
  backed by Privy's linked-account APIs and the canonical Web/Postgres
  projection; the app does not own a second completion flag.
- Founder email is sent whenever the existing verified-email recipient policy
  permits it, including companion onboarding.
- The founder welcome email and assistant welcome are distinct effects and may
  both use verified email. The assistant welcome and finite three-day follow-up
  prefer an established direct route, then use verified email when activation
  happens before a conversational route exists.
- Failed, cancelled, or unavailable provider work leaves the member signed in
  at a retryable gate with a sign-out escape hatch. It does not suspend or
  delete the account.
- This change does not retroactively resend founder welcomes or activation
  sequences that were already consumed.

### Outcome

Every newly onboarded member leaves setup with a conversational phone or
Telegram route that Murph can use, while email-authenticated members still
receive the founder welcome and never see a mislabeled contact action.

### Entry And Promise

A person can sign in with phone or email on either surface. If their canonical
member lacks both phone and Telegram, setup explains why a messaging route is
needed and offers both choices. A successful link is synchronized to the
canonical member before onboarding continues. The founder email is best-effort
after starter enrollment. Murph's distinct assistant welcome and the existing
three-day sequence use the route selected at activation, including verified
email when the account is still email-only.

### Affected People

- A new email-authenticated Web member sees the existing phone/Telegram setup
  before starter enrollment, can retry either option, and continues on success.
- A new or returning email-only iOS member sees a compact native setup gate
  before persona or health setup. Successful phone or Telegram linking is
  re-admitted through the backend before the gate disappears.
- A phone-authenticated or already Telegram-linked member passes through with
  no extra step and keeps the current direct-channel welcome behavior.
- A member whose link is cancelled, times out, or fails remains signed in with
  a clear retry and sign-out path. No new health authority begins behind the
  gate; a returning member's already-established sync remains intact.
- A member whose activation temporarily lacks a usable direct route can still
  receive the assistant sequence through the current verified email, which is
  revalidated at the email provider boundary.

### Proof Path

- Web: focused predicate, invite/readiness, companion enrollment, activation,
  route privacy, and runtime delivery tests prove required setup, founder email
  dispatch, direct-channel priority, and verified-email fallback.
- Assistant: a deterministic regression plus one focused real-Codex journey
  proves that the three-day onboarding occurrence reaches a useful email reply
  when the fallback is selected.
- iOS: unit tests prove linked-account operations, canonical refresh, phone-code
  recovery, and semantic contact labels; exact-pushed-head simulator evidence
  shows the required phone-or-Telegram choice gate.
- Cross-repo: the iOS field is additive and tolerant of an older Web response;
  Web deploys first so the canonical setup projection exists before the native
  gate ships.

### UX Finish

- Lead with “Choose how to message Murph,” not acquisition or notification
  language.
- Explain that email remains on the account while conversations happen through
  Messages or Telegram.
- Use “Text Murph,” “Message Murph on Telegram,” and “Email Murph” only when
  the action actually opens that channel.
- Disable repeated submissions while work is in flight, retain the entered
  phone number through code verification, and keep errors adjacent to the
  action that can recover them.

### Done When

- Email alone cannot pass the shared messaging-setup predicate.
- Web and iOS each block normal onboarding until phone or Telegram is linked.
- Companion enrollment no longer suppresses the founder welcome email.
- Activation prefers phone/Telegram and seeds both immediate and three-day
  assistant outreach, with a privacy-preserving verified-email fallback.
- The native completion CTA always names the channel it opens.
- Focused Web, assistant, and iOS proof passes; iOS visual evidence, both PR
  heads, required reviews, and exact-head CI are complete.

## Architecture

- Web/Postgres remains the sole owner of member identity, messaging readiness,
  activation, and automation state.
- Privy remains the identity-linking authority. iOS accesses it only through
  `AuthProviding`, then reuses companion admission to synchronize the linked
  identity into the canonical member.
- The existing initial-onboarding projection gains one additive optional
  readiness field so old Web and iOS builds can overlap safely.
- No database table, queue, onboarding state owner, dependency, or provider
  credential is added.

## Planned Changes

### `murph`

- Restore phone/Telegram-only messaging readiness.
- Project messaging readiness through companion initial onboarding.
- Restore companion founder email and add activation email fallback without
  broadening unrelated notification routes.
- Add focused tests, a real-Codex journey, canonical docs, and changelog.

### `murph-ios`

- Add phone-link and Telegram-link operations behind `AuthProviding`.
- Present a canonical messaging-setup gate and refresh through companion
  admission after linking.
- Render contact action labels from their actual channel.
- Add focused tests, simulator evidence, and canonical docs.

## Progress

- [x] Re-read both repositories' instructions and relevant product,
      architecture, security, reliability, and verification guidance.
- [x] Confirm no overlapping branch or pull request and create isolated task
      worktrees from current main heads.
- [x] Inspect the production symptom, shared readiness predicate, activation
      routes, native onboarding flow, and pinned Privy linked-account surface.
- [x] Implement the Web/server contract and focused proof.
- [x] Implement the iOS gate, recovery, and focused proof.
- [x] Update canonical documentation and changelog after both PR numbers exist.
- [x] Run scoped verification, assistant journey, required reviews, and
      exact-head CI; simulator visual proof is captured.
- [x] Commit, open coordinated PRs, and record the Web-first deploy order.

## Verification

Use the smallest focused Web Vitest suites plus affected typechecks, the named
real-Codex assistant journey, `xcodegen generate`, `swiftformat --lint .`, and
focused/full simulator tests required by the iOS repository. Broad acceptance
remains owned by exact-head GitHub Actions.

Completed proof: 60 focused Web onboarding tests, 213 assistant cron tests,
59 hosted-runtime event tests, the focused real-Codex journey, and the Web,
assistant-engine, and assistant-runtime typechecks passed. The companion retry
regression proves 503-before-convergence and 200-after-convergence. The hosted
email automation regression proves local-profile rejection, hosted-profile
persistence, and one due email delivery. Final ReviewGPT round 3 returned
`ROUND_OUTCOME: PASS`; the coordinated iOS PR passed its final review and native
verification.

## Rollout

Deploy Web before releasing iOS. The additive optional projection keeps the
new iOS build compatible with old Web during review, but enforcement becomes
canonical only after Web is live. Verify one email-authenticated and one
phone-authenticated journey, then one Telegram link, before declaring the
native release complete.
Completed: 2026-08-29
