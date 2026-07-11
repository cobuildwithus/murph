# Hosted sensitive-action approvals

Last verified: 2026-07-10

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
  consume(input: HostedActionApprovalConsumeRequest): Promise<HostedActionApprovalResult>;
  read(input: HostedActionApprovalRequest): Promise<HostedActionApprovalResult>;
  request(input: HostedActionApprovalRequest): Promise<HostedActionApprovalResult>;
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

The caller owns action execution, retries, and completion. It must recompute the fingerprint and call `consume` with the observed approval generation at the final effect boundary. Approval has no claimed, executing, completed, or provider-error state.
When `pending` is returned, the approval URL is handed to the normal assistant reply path; the approval system must not send a separate hard-coded user message.

The runtime keeps the exact file-and-destination delivery intent in its own outbox as `awaiting_approval`. Web never reconstructs that effect from the approval row. A later approval wake only asks the runtime to re-read owner state; the normal pre-dispatch consume gate remains the authorization boundary.

## Browser decision flow

1. `/approve/:approvalId` requires the owning member's active hosted app session before showing details.
2. Pressing **Approve with passkey** rotates the row to a fresh `assistant.action.approve` challenge bound to member, session, approval ID, action ID, and action hash.
3. The browser signs the existing server-generated challenge with the member's passkey-MFA-protected embedded wallet.
4. The decision route verifies the signature and atomically changes `pending` to `approved` only if that exact challenge is still current.
5. Denial requires the authenticated session but not wallet MFA because it cannot release data or execute the action.
6. The same Postgres transaction appends one payload-free `runtime.pending-effects-reconcile-requested` system-mailbox row. Its stable event identity is derived from the approval identity, committed decision time, and decision, so a refreshed decision cycle receives a distinct wake.
7. After commit, the route best-effort sends the existing pointer-only `mailbox_appended` Temporal signal for that row.
8. The runtime records the control receipt, uses the observation-only approval read to recheck bounded pending delivery effects, and either resumes the approved delivery or terminalizes the denied one without running assistant automation.
9. The decision response returns the browser to the originating Murph conversation without pre-filling an approval-confirmation message.

The mailbox row is a durable shoulder tap, not authorization evidence or outcome payload. The runtime observes the outcome through `actionApprovalPort.read()` and consumes the matching approved generation again at the final delivery boundary.

## Asynchronous outcome primitives

Two generic mailbox shapes cover distinct continuation needs:

- `assistant.notification.requested` is for an external result that needs Murph to generate a user-facing summary, such as a completed phone call.
- `runtime.pending-effects-reconcile-requested` is for a trusted owner-state change that may unblock an already-persisted runtime effect. It carries no result content and does not invoke the model.

Both commit durable work before signaling Temporal, keep the signal pointer-only, and leave execution with the runtime owner. Approval uses the second shape because the exact attachment and destination already live in the parked outbox intent.

## Privacy and retention

Approval rows contain no action payload, file bytes, raw recipient identifier, signature, or wallet authorization material. They store only an exact-action hash and bounded presentation text. The pending-effects mailbox payload contains only its control kind, member owner, timestamp, and a hashed generation-scoped event identity; it contains no file or destination data. Rows are member-scoped, cascade with the hosted member, and are explicitly covered by account deletion. User exports omit the rows and their security metadata.
