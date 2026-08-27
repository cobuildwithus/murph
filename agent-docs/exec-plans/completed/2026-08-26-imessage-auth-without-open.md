# iMessage authentication without recurring app opens

Status: completed
Created: 2026-08-26
Updated: 2026-08-26

## Goal

- After one authenticated Murph-app setup, let the installed Messages
  extension keep performing its existing bounded workout actions without the
  containing app being open or periodically foregrounded.

## Success criteria

- A member with a previously enrolled Messages extension can refresh an active
  workout card and save an edit after the current 24-hour action credential has
  expired, without launching the containing app.
- A fresh install or signed-out member still completes one authenticated setup
  before the Messages extension gains action authority.
- Every action and receipt read continues to re-check current member access and
  historical launch consent, and sign-out, account deletion, replacement, or
  explicit revocation invalidates the Messages authority.
- The immutable card URL remains presentation-only: it contains no credential,
  member id, canonical record id, or write capability.
- The extension retains no Privy dependency, vault access, workout persistence,
  assistant turn, new queue, or second canonical state owner.
- Focused backend and iOS proof covers first setup, post-expiry renewal, action
  completion with the host app absent, revocation, stale/replaced authority,
  network recovery, and concurrent renewal behavior.

## Scope

- In scope: the existing iMessage mini-app credential lifecycle, its Web routes
  and deterministic session row, the shared Keychain client, the Messages
  workout refresh/apply path, focused tests, live architecture/product specs,
  and coordinated backend/iOS rollout.
- Out of scope: authority in response-card payloads, Privy inside the extension,
  arbitrary member actions, a general mobile client, background host-app work,
  new workout state, or unrelated response-card families.

## Constraints

- Technical constraints: reuse the deterministic Messages-owned session row,
  current member/access/consent gates, shared ThisDeviceOnly Keychain item,
  member-action mailbox, and canonical workout owner. Keep renewal bounded,
  replay-safe, revocable, and explicit about its durable security authority.
- Product/process constraints: this is a Product change and a sensitive
  cross-repository auth change. Keep both PRs draft until focused proof and
  exact-head ReviewGPT gates pass; document a reader/server-first deploy order
  and the old-client compatibility window.

## Product UX plan

- Outcome: a signed-in member opens an editable workout card in Messages and
  saves it there, even if Murph has not been opened recently.
- Entry and promise: after the one-time app sign-in/setup, opening an active
  workout card in a private iMessage thread either refreshes and saves through
  the extension or shows a truthful retry/access failure; routine credential
  age never tells the member to open Murph.
- Affected people: an established member returning after more than 24 hours;
  a member editing while Murph is terminated; a signed-out, deleted, suspended,
  or consent-blocked member; and an existing extension build that knows only
  the current 24-hour credential contract.
- Proof path: one initial host enrollment, simulated credential aging, native
  extension renewal and exact workout action, durable terminal receipt, then
  revocation/access/consent and old-client compatibility scenarios.
- UX finish: preserve the existing editor and saved states. Reserve “Open
  Murph” only for account setup or an account/consent boundary that truly needs
  host authentication, never for ordinary credential expiry.
- Done when: the established-member paths are Ready without the host app; the
  excluded signed-out/access-blocked paths remain fail-closed with an honest
  recovery step.

## Risks and mitigations

1. Risk: removing the 24-hour cutoff turns a leaked bearer into unbounded
   authority.
   Mitigation: keep the action credential short-lived and give only the
   device-local Messages session a narrow renewal path, or use an equivalently
   bounded revocable design; never make an expired action bearer silently valid
   for actions.
2. Risk: renewal races between the host and extension invalidate an in-flight
   save.
   Mitigation: serialize or converge renewal through the existing deterministic
   session row and prove the replacement/reload path.
3. Risk: server-first or client-first skew strands current extensions.
   Mitigation: keep current credential admission readable and usable while the
   renewal-capable iOS build rolls out; activate any new writer behavior only
   after compatible server routes are live.
4. Risk: reinstall or account switching reuses authority for the wrong member.
   Mitigation: preserve current member-bound rotation, sign-out/account-deletion
   cleanup, ThisDeviceOnly storage, and fresh-install trust-boundary checks.

## Tasks

1. Ask ReviewGPT for a scoped backend implementation patch and security design
   critique, then inspect every returned hunk before applying anything.
2. Implement the accepted backend renewal/session contract with route, service,
   concurrency, deletion, access, consent, and compatibility proof.
3. Implement the iOS extension renewal owner and recovery copy without adding
   host background work, Privy, or workout persistence.
4. Update both repositories' live architecture/product docs and member-visible
   changelog decision.
5. Run focused backend, iOS, cross-boundary, formatting, typecheck/build, and
   direct Product UX walkthrough proof.
6. Push coordinated draft PR heads, run preliminary specialist and sensitive
   final ReviewGPT gates with CI, resolve accepted findings, and complete the
   coordinated deployment handoff.

## Decisions

- Preserve one authenticated containing-app setup; “download once” does not
  turn an unauthenticated Messages install into account authority.
- The app-card URL and workout revision binding remain capability-less
  presentation/precondition data, not authentication.
- ReviewGPT's implementation patch is untrusted input: apply only accepted,
  repository-compliant hunks after local inspection and proof.
- ReviewGPT's first delivery is rejected as implementation evidence: its own
  notes reported that the claimed patch attachment was missing. An exact-thread
  correction must supply a real unified diff that passes local inspection and
  `git apply --check` before any hunk can influence the candidate.
- The corrected same-thread ReviewGPT artifact was downloaded by exact captured
  turn and artifact identity. Its declared SHA-256 and size matched, its patch
  was privacy-scanned, and it passed `git apply --check` against the clean
  task baseline. Accept its same-row lifecycle threat model, generation binding,
  revocation semantics, compatibility analysis, and server-first rollout
  guidance.
- Reject ReviewGPT's schema-v2, signed nonce-bearing action credential, shared
  app-session HMAC dependency, and dedicated Messages store. Those 1,600-plus
  added lines create multiple concurrent action bearers and duplicate the
  existing store without enforcing an independent boundary. The candidate
  instead keeps one deterministic stored action bearer, converges concurrent
  renewal under the existing member lock, and re-checks access and historical
  consent before minting it.
- Database load is bounded to one indexed renewal prelookup and one short,
  database-only member transaction touching the existing deterministic session
  row and already-required member/sponsorship/consent rows. Maximum admitted
  cardinality is one lifecycle row per member, with no per-card fanout, no
  provider call in the transaction, and at most one action rotation per 24-hour
  credential window.

## Verification

- Backend: focused iMessage mini-app service/route/account-deletion tests,
  member-action ingress/outcome tests, relevant typecheck, and one composed
  hosted-local action journey.
- iOS: Messages mini-app client, credential-store, workout entry/session tests,
  SwiftFormat, XcodeGen, simulator tests, and extension build.
- Cross-repository: exact request/response fixtures agree, old iOS behavior
  remains server-compatible, post-expiry extension renewal reaches an applied
  canonical workout receipt without host foreground, and revocation blocks it.
- Completion: diff/privacy inspection, Product UX walkthrough Ready,
  preliminary Product UX/coverage ReviewGPT PASS, sensitive final ReviewGPT
  PASS, exact-head required CI green, and clean current-base merge-tree proof.

Local candidate proof completed so far:

- Web typecheck and Prisma schema validation pass.
- Focused Web service, route, and session-store tests pass: 36 tests.
- PostgreSQL lifecycle/account-deletion proof passes: 4 tests, including
  concurrent renewal convergence.
- iOS build-for-testing passes and the full Messages API-client class passes:
  22 tests.
- Focused SwiftFormat passes for all three changed Swift files. The whole-tree
  lint remains blocked by pre-existing wrap-rule timeouts in two unchanged
  workout exercise catalog files.
Completed: 2026-08-26
