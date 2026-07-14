# PR 606 Final Security Highs

## Objective

Resolve the three independently proven final security findings on PR 606 without
restoring the retired post-selector Linq wrapper or broadening adjacent billing,
automation, or account-deletion behavior.

## Proven Gaps

- A legacy personal-home route repair can accept a target that already has a
  durable group-thread route, and the direct-home-only requirement is not
  preserved through the eventual provider-entry assertion.
- Direct-route input identity compares channel, thread, and directness but not
  `conversation.accountId`, so identical provider thread ids configured under
  different accounts can cross-admit input into the active turn.
- Direct Checkout revalidates suspension and Family authority after Stripe
  session creation but does not recheck direct billing eligibility or the
  canonical direct subscription, allowing a concurrent trial enrollment to
  make the new Checkout session stale while it remains completable.
- Expiring a newly rejected unbound Checkout session without durably recording
  it for retirement lets a later eligible retry reuse the expired session's
  Stripe idempotency key.
- Pre-field direct-home cron intents, including an intent prepared before cron
  finalization links it back to the job, can reach provider entry without the
  new assertion after a rolling deployment.
- The old-head Linq lost-active-operation E2E still expects a later contiguous
  same-route, same-actor input to start a second provider turn even though the
  current runtime intentionally folds that input into the live turn.

## Implementation

- Reject direct-home repair when the target already has any durable thread
  route, and carry one explicit direct-home-only bit through the existing
  scheduled-delivery/outbox boundary so provider entry repeats the same
  fail-closed assertion.
- Include exact `conversation.accountId` equality in the shared direct-route
  identity predicate used by both stored and hosted/pure input selectors.
- Under the existing final member lock, recheck direct billing eligibility and
  absence of a canonical direct subscription before binding the new Checkout
  session. If that authority became stale, atomically record the exact session
  on its reserved attempt for retirement, then expire it without returning its
  URL. If finalization itself throws, expire the exact session created by this
  request before rethrowing rather than adding a recovery transaction.
- Persist an explicit direct-home authority boolean on every new outbox intent,
  strengthen legacy dedupe reuse monotonically, and treat only legacy
  unanchored direct Linq intents as direct-home-only at the fresh mirror read
  immediately before text or voice provider entry. Reply-anchored legacy
  intents retain ordinary current-inbound authority.
- Reconcile only the stale lost-active-operation E2E with the intentional live
  input-folding contract, preserving its recovery coverage while proving one
  combined/current reply and no duplicate provider send.

## Validation

- Prove a known group route cannot be promoted by direct-home repair and a route
  that becomes group-shaped after repair is rejected before provider dispatch.
- Prove both stored and hosted/pure selectors treat the same channel/thread
  under another account as unrelated input.
- Prove a concurrent trial activation after Stripe session creation expires the
  new open session and returns no Checkout URL.
- Prove an eligible retry after stale-session cleanup uses a fresh durable
  attempt and Stripe idempotency key after retiring the recorded expired
  session instead of replaying it.
- Prove unknown finalization failures preserve the original error and expire
  the exact created session, including when the database commit result is lost;
  the next retry then observes retirement before creating a fresh attempt.
- Prove a URL-less Stripe session is bound before it is expired, so the next
  eligible retry retires that exact session and uses a fresh attempt and
  idempotency key instead of replaying the expired result.
- Prove explicit false/true outbox classifications persist, true cannot be
  downgraded by dedupe reuse, legacy proactive direct Linq sends fail closed,
  and legacy reply-anchored sends preserve ordinary authority.
- Prove lost outer-runner state still recovers the live child, the retained
  first input starts the causal turn, the contiguous same-actor input joins its
  delayed follow-up request, mailbox lag drains to zero, and only one Linq reply
  is sent.
- Run focused tests and typechecks, required coverage/security/final audits,
  scoped verification, exact-head ReviewGPT, and CI.

## Completion Evidence

- Focused final-file tests: hosted Web 63/63, assistant engine 200/200,
  assistant runtime 181/181, and operator config 18/18.
- Final typechecks: hosted Web, assistant engine, assistant runtime, and operator
  config passed.
- Diff-aware verification passed syntax, privacy/logging, dependency, boundary,
  and affected-package typecheck gates. All changed package suites passed; the
  aggregate was stopped only after an unrelated setup-CLI lane remained silent
  beyond the bounded wait.
- Required coverage-write added the unexpected finalization-failure regression;
  required security/privacy review returned zero Medium-or-higher findings.
- Final `git diff --check` and identifier/privacy scans are required immediately
  before the scoped commit. Exact-head ReviewGPT and CI remain post-push gates.

Status: completed
Updated: 2026-07-14
Completed: 2026-07-14
