# Hosted sensitive-action approvals

Last verified: 2026-08-06

## Purpose

Hosted Murph actions that disclose or mutate sensitive user data can ask the member for a durable, passkey-backed decision before execution.

The implementation reuses the sensitive-action infrastructure added in PR #274:

- `HostedSensitiveActionChallenge` is the single member-scoped store for both ordinary one-time Settings challenges and Assistant action approvals.
- The existing Privy embedded-wallet challenge format and signature verification prove the approval decision.
- The hosted runtime's signed web-control transport creates or reads approvals.
- The active app session, CSRF guard, durable system mailbox, pointer-only Temporal signal, and browser-handoff return-to-Murph UX are reused.

No callback URL, approval-specific workflow, polling loop, scheduler, policy engine, model turn, or new state table is added.

## Two row modes in one table

The existing `hosted_sensitive_action_challenge` table has two SQL-enforced shapes:

1. Ordinary PR #274 rows are short-lived proof challenges. Their approval-only columns are null, and successful consumption deletes the row.
2. Rows with `kind = assistant.action.approve` are durable action approvals. They contain a stable approval locator, exact-action hash, bounded presentation, and `pending | approved | denied` decision.

An approval row starts with a non-secret placeholder token hash because `token_hash` remains the existing primary key. Pressing **Approve** rotates that value to a fresh one-time PR #274 challenge hash and binds the proof to the current app session. The approval decision is then written with a compare-and-set; the row is not passed through the ordinary consume-and-delete path.

Database checks reject mixed row shapes. The Settings challenge APIs are also narrowed to Settings action kinds, and ordinary challenge consumption explicitly rejects Assistant approval rows.

## Runtime contract

The hosted runtime receives one optional platform capability:

```ts
interface HostedRuntimeActionApprovalPort {
  request(input: HostedActionApprovalRequest): Promise<HostedActionApprovalResult>;
  read(input: HostedActionApprovalRequest): Promise<HostedActionApprovalResult>;
  consume(input: HostedActionApprovalConsumeRequest): Promise<HostedActionApprovalResult>;
}
```

A request contains:

- a stable caller-owned `actionId`;
- a versioned `actionKind`;
- a lowercase SHA-256 `actionFingerprint` over the exact immutable effect;
- bounded trusted plain-text `title` and `body` presentation.

`request` is idempotent for the active approval cycle:

1. The first call creates `pending` and returns a stable `/approve/:approvalId` URL.
2. The same request returns the same row and URL.
3. Reusing the action ID with a changed kind, fingerprint, or presentation fails closed.
4. A later explicit request may refresh a denied, expired, or consumed cycle so the member can retry the same exact action.

`read` derives and validates the same exact request identity, then returns the current `pending`, `approved`, `denied`, or derived `expired` status without creating or refreshing a row. Runtime reconciliation uses `read`; only a new explicit action request uses `request`.

The caller owns action execution, retries, and completion. It must recompute the exact request and call `consume` with the observed approved generation at the final effect boundary. Consumption is one-consumer, generation-bound, and idempotent for the same deterministic consumer ID. Approval has no claimed, executing, completed, or provider-error state.
When `pending` is returned, the approval URL is handed to the normal assistant reply path; the approval system must not send a separate hard-coded user message.

The hosted assistant-configuration tool uses this path for model and reasoning changes. It requires accepted user input on the requesting and consuming turns, fingerprints both the explicitly requested fields and the fully resolved next-turn target, and consumes approval in the same web transaction as the matching field-level preference mutation. Configuration reads do not require approval.

The runtime keeps the exact file-and-destination delivery intent in its own outbox as `awaiting_approval`. One active approval cycle owns one parked intent, keyed by the approval ID and cycle expiry, so repeating the same request in another turn reuses that owner. Web never reconstructs the effect from the approval row. A later approval wake names that exact cycle owner and observed approval generation, then only asks the runtime to re-read and dispatch that owner; it cannot select an older same-action owner or unrelated due delivery work. A delayed older-cycle wake cannot apply a refreshed generation. At assistant admission, a due reconciliation wake is selected by both its runtime-control route and its exact pending-effects kind. If re-reading approval produces that named delivery effect, it owns the pass and drains before simultaneously pending foreground chat. If the effect is denied, missing, superseded, or otherwise not deliverable, the runtime records the control receipt and continues the foreground assistant pass; every unrelated system wake remains queued. The normal pre-dispatch consume gate remains the authorization boundary. If Linq re-homes the delivery to a different final provider target, the runtime terminalizes the approved file intent before consumption or provider entry; sending to the new target requires a fresh action and approval. Ordinary text delivery may still use the current-home fallback. Background fallback reconciliation is a separate bounded path.

An explicit current-user cleanup request may list or cancel only generated-file
intents whose exact origin session matches the trusted current user-action
scope. The cleanup capability depends on that current direct-reply authority,
not on whether the approval service or a fresh file-send target is available,
so an already parked intent remains cancellable during approval-service
degradation. A list returns the oldest 20 matching intents and the complete
matching count. Explicit cancel-all handling is bounded to five list/cancel
batches and reports any remainder or per-intent failure instead of looping
indefinitely. Cancellation may compare-and-set an intent from
`awaiting_approval` to terminal `abandoned`; the persistence result identifies
whether that exact transition won. One concurrent approval refresh may be
retried, while a concurrent terminal owner is reported from its observed state.
Once delivery preparation or dispatch advances the outbox owner, cancellation
refuses. The outbox remains the effect owner:
cancellation adds no approval-row state and does not rewrite the historical
approval decision, so a delayed approval observation cannot revive an intent
that cancellation already terminalized. Cancellation-coded abandonment also
does not repair the initiating turn receipt: that receipt continues to describe
the approval-link reply that was actually delivered, while the cancellation
turn reports its own result. Cancellation does not unlink files.
The existing quiescent runtime-residue pass remains the sole byte-deletion
owner and applies its complete inventory and fingerprint contract before the
next encrypted workspace checkpoint. Canonical and user-owned vault files
remain outside that cleanup authority.

## Browser decision flow

1. `/approve/:approvalId` requires the owning member's active hosted app session before showing details.
2. Pressing **Approve with passkey** rotates the row to a fresh `assistant.action.approve` challenge bound to member, session, approval ID, action ID, and action hash.
3. The browser signs the existing server-generated challenge with the member's passkey-MFA-protected embedded wallet.
4. The decision route verifies the signature and atomically changes `pending` to `approved` only if that exact challenge is still current.
5. Denial requires the authenticated session but not wallet MFA because it cannot release data or execute the action.
6. The same Postgres transaction appends one payload-free `runtime.pending-effects-reconcile-requested` system-mailbox row. Its stable event identity is derived from the approval identity, committed decision time, and decision, so a refreshed decision cycle receives a distinct wake.
7. After commit, the route best-effort sends the existing pointer-only `mailbox_appended` Temporal signal for that row.
8. The runtime records the control receipt, uses the observation-only approval read to recheck bounded pending delivery effects, and either resumes the approved delivery or terminalizes the denied one. When foreground chat is already waiting, only a collected exact approved effect delays assistant automation; a zero-effect reconciliation continues that foreground pass.
9. An approved or denied decision returns through the existing bare originating-conversation link. The member does not need to send a confirmation message: the durable system wake resumes an approved parked effect automatically, while the approval row and consume-time recheck remain the authorization evidence.

The mailbox row is a durable shoulder tap, not authorization evidence or outcome payload. The runtime observes the outcome through `actionApprovalPort.read()`, whose read-only result includes the current opaque approval-cycle owner for every status. The runtime refuses to apply an observation to a different parked owner, then consumes the matching approved generation again at the final delivery boundary.

Consumption closes the authorization generation against replay but does not rewrite the member's historical decision. Runtime approval reads and later consume attempts therefore report the consumed generation as expired, while the member-facing approval page continues to present that row as approved. A genuinely elapsed, unconsumed approval still presents as expired.

The browser records only the approval decision. Its pending and approved states
state that Murph continues only while the runtime still has the request pending;
a cancellation from the conversation remains authoritative, and an old approval
link cannot reactivate the cancelled delivery.

## Asynchronous outcome primitives

Two generic mailbox shapes cover distinct continuation needs:

- `assistant.notification.requested` is for an external result that needs Murph to generate a user-facing summary, such as a completed phone call.
- `runtime.pending-effects-reconcile-requested` is for a trusted owner-state change that may unblock an already-persisted runtime effect. It carries no result content and does not invoke the model.

Both commit durable work before signaling Temporal, keep the signal pointer-only, and leave execution with the runtime owner. Approval uses the second shape because the exact attachment and destination already live in the parked outbox intent.

## Privacy and retention

Approval rows contain no action payload, file bytes, raw recipient identifier, signature, or wallet authorization material. They store only an exact-action hash and bounded presentation text. The pending-effects mailbox payload contains only its control kind, member owner, timestamp, and a hashed generation-scoped event identity; it contains no file or destination data. Rows are member-scoped, cascade with the hosted member, and are explicitly covered by account deletion. User exports omit the rows and their security metadata.
