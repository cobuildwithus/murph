# Preserve delivery uncertainty and finish accepted settlement

Status: completed
Created: 2026-11-06
Updated: 2026-11-06

## Outcome and ownership

Unknown non-idempotent email and Telegram outcomes do not resend. Accepted delivery
finishes through the existing engine outbox and the hosted collect, drain and wake
boundary, including after a channel is disabled. Recognized transient approval
consumes retry with the same generation and consumer. Optional accounting does not
move a confirmation deadline.

The engine owns classification and confirmation. The hosted adapter owns provider
entry evidence. The Cloudflare port and Worker route own proof that no send started.

## Scope and decisions

Existing errors, records, locks and retry policy only. No schema, wire or persisted
vocabulary change.

- The email recipient branch throws `ASSISTANT_DELIVERY_AMBIGUOUS`, which the outbox
  already persisted for it. `ASSISTANT_EMAIL_GROUP_FANOUT_INCOMPLETE` stays recognized
  for its remaining producer.
- The ambiguity error is a fresh object, because marking a caught error could carry
  `deliveryMayHaveSucceeded: true` on a shared abort reason into a later delivery.
- An accepted confirmation retry is not an outbound predecessor. It takes the same
  branch as `status === "sent"` in candidate selection and boundary wake calculation,
  so a later reply in a steered turn is neither held nor hidden. Phone-result and
  Linq-reaction ordering are unchanged.
- Hosted `sendTelegram` does not re-check liveness after acceptance. The outbox
  persists the receipt and the existing outer check then runs. Other Telegram senders
  keep their check.
- A failed write-fence read in the Cloudflare port, and a failed Worker
  `authorize_effect` lookup, are pre-provider and stay retryable. The shared Worker
  helper is unchanged because two other routes use it.
- A raw `TimeoutError` from a stalled approval response is marked retryable inside
  `consume` only, the one operation where repeating is safe.

## Proof

Failing proofs were observed first, for each of: recipient transport failures staying
retryable; an abort during the recipient read reaching the send; a voice 429 replacing
an uncertain fallback; an accepted Telegram transcript resending after liveness loss;
a null wake for accepted confirmation; lost consume responses becoming terminal;
accounting clearing or replacing the deadline; a later reply held behind an accepted
predecessor; and a Worker authority failure returning 500.

`hosted-runtime-delivery-settlement.integration.test.ts` runs real collection, dispatch,
wake calculation and vault storage, stubbing only the provider, approval and receipt
ports. `runner-platform.test.ts` and `runner-outbound.test.ts` prove the real port and
route shapes that stub stands in for. Web's repeat-consume contract is proven by
`apps/web/test/action-approvals.db.test.ts`.

The Linq file branch has no consume-failure case of its own. It shares
`preloadApprovedHostedAssistantVaultFiles`, which runs before any provider attempt and
outside that dependency's error handling, and the existing Linq regressions pass.

Final source, real exit codes, all 0: assistant-runtime 429 tests across six suites
including the Telegram, email, Linq and file-checkpoint suites; assistant-engine 193
tests; `apps/cloudflare` 732 tests across `runner-outbound`, `runner-platform` and
`hosted-email`; typecheck and build for the touched packages; `pnpm complexity:diff`;
`scripts/check-raw-health-log-payloads.ts`.

## Review

Read-only deep review: three findings. Accepted: the accepted-transcript resend, fixed
by the `sendTelegram` deletion, and the Worker authority failure. Rejected: marking the
runtime email guard's pre-call rejection, because no `await` separates the entry check
from that guard, the failure loses a reply rather than duplicating it, and the fix needs
an email-specific guard. The accepted-predecessor regression was found in parent review.

Final ReviewGPT runs on the pushed head; its outcome is recorded in the pull request.

## Deployment

Cloudflare Worker first, then the runner image. Parked confirmations settle once after
the runner release, with no provider send.

Completed: 2026-11-06
