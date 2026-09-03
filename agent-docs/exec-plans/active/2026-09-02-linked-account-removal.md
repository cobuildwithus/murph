# Linked account replacement and removal

Status: active

## Outcome

Settings lets a member replace an existing Telegram account without asking
Privy to link a second Telegram identity. A member can also explicitly remove a
linked Telegram, email, or phone identity when another supported sign-in method
will remain. Murph-owned contact and routing state is revoked with the provider
identity so a removed channel does not stay active or visible.

## Task class and ownership

- Standard repo change with an auth/trust-boundary trigger, so it uses a task
  worktree, focused local proof, package typecheck/lint, exact-head CI, and final
  ReviewGPT.
- Product UX effort: Product change. This extends the existing Settings identity
  journey with removal and changes Telegram replacement sequencing.
- Privy remains the login-method authority. Postgres remains the canonical
  Murph contact/routing owner. The browser initiates Privy's unlink, then the
  authenticated Settings route verifies live provider state before revoking the
  corresponding Murph projection in one short transaction.
- No schema, dependency, queue, webhook, or new persisted state is required.

## Product UX plan

- Existing member with Telegram plus another sign-in: Change explains that the
  current Telegram account will be disconnected, revokes it, then immediately
  opens the normal Telegram linking flow. Canceling the second step leaves an
  honest disconnected state that can be retried.
- Existing member with linked Telegram, email, or phone plus another sign-in:
  Remove requires explicit confirmation, reports progress/failure in the
  existing dialog, and refreshes into `Not connected` after provider and Murph
  state converge.
- Member whose selected identity is the only supported sign-in: removal and
  Telegram replacement stay unavailable, with direct copy to add email, phone,
  or Telegram first. The provider's last-account rejection remains a backstop.
- Member with a stale browser, raced change, or conflicting provider identity:
  Settings offers only Refresh until the server-approved provider identity and
  canonical identity agree. The dialog rechecks that same canonical value
  immediately before unlink, and the cleanup route refuses any provider type
  that is still present or ambiguous.
- Provider unlink succeeds but Murph sync is temporarily unavailable: the
  dialog says the provider identity was removed and offers a retry that only
  performs idempotent Murph cleanup; it never tries to unlink twice.
- Phone removal disconnects both phone sign-in and Murph texting because the
  existing Settings row presents them as one connected channel. Email removal
  revokes verified-email messaging and the reply alias while retaining billing
  contact history. Telegram removal revokes direct Telegram routing.
- Existing Settings row, dialog, button, error, focus, and responsive patterns
  remain the visual source of truth. The current `/design?tab=components`
  identity-dialog representation will be extended with synthetic linked and
  removal states if it does not already expose them.

## Implementation plan

1. Project one state per auth method from the full server-approved Privy user
   into the Settings snapshot, including top-level Telegram, so presentation,
   recovery, and unlink eligibility share one source of truth.
2. Add one authenticated Settings unlink route. Resolve live Privy state before
   `BEGIN`; require the target method to be absent and another supported method
   to remain; then lock the member, verify the expected blind index, revoke the
   matching canonical fields, and enqueue the existing channel-update event.
3. Add focused owner mutations for Telegram routing, verified email plus reply
   alias, and phone identity plus Linq routing. Keep historical billing email,
   messages, memberships, and delivery records intact.
4. Add a shared Settings unlink controller that calls Privy's dedicated unlink
   hooks. Reuse it for the three dialogs and make Telegram Change run removal
   first, then the existing link/sync flow.
5. Cover snapshot projection, server authorization/race/idempotency boundaries,
   client retry and Telegram replacement, confirmation/accessibility copy, and
   the real design-catalog state.
6. Run focused tests, Web typecheck/lint, responsive browser proof, privacy/diff
   review, exact-head CI, and the required final ReviewGPT gate before handoff.

## Verification record

- Focused hosted-Web suite: 138 tests passed across account projection,
  Settings rows/dialogs, removal retries, canonical projection cleanup, and the
  authenticated DELETE route.
- Changelog page suite: 48 tests passed.
- `pnpm --dir apps/web typecheck:prepared`: passed.
- `pnpm --dir apps/web lint`: passed with 44 pre-existing warnings and no
  errors.
- `pnpm test:frontend-design-proof`: 12 tests passed with a process-scoped
  neutral Git identity; the fixture/privacy-hook conflict found on the first
  run is recorded in Frog.
- Dedicated Playwright proof: passed after the final identity-state correction. The production removal confirmation,
  disabled last-sign-in state, composed Settings rows, current changelog
  edition, and changelog catalog study were inspected at 1440x1000 and
  390x844 using synthetic data only.
- Parent candidate review: provider-first unlink, exact-principal authorization,
  alternative verified sign-in protection, provider propagation retry,
  expected-identity race guard, idempotent cleanup, channel-specific routing
  revocation, and post-commit mailbox wake paths walked without an open proof
  gap.
