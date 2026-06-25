# Hosted sensitive-action approvals

Last verified: 2026-06-24

## Purpose

Hosted Murph actions that disclose or mutate sensitive user data can ask the member for a durable, passkey-backed decision before execution.

The implementation reuses the sensitive-action infrastructure added in PR #274:

- `HostedSensitiveActionChallenge` is the single member-scoped store for both ordinary one-time Settings challenges and Assistant action approvals.
- The existing Privy embedded-wallet challenge format and signature verification prove the approval decision.
- The hosted runtime's signed web-control transport creates or reads approvals.
- The active app session, CSRF guard, runtime recheck signal, and browser-handoff return-to-Murph UX are reused unchanged.

No callback URL, mailbox type, approval workflow, polling loop, policy engine, or model-facing approval tool is added.

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
}
```

A request contains:

- a stable caller-owned `actionId`;
- a versioned `actionKind`;
- a lowercase SHA-256 `actionFingerprint` over the exact immutable effect;
- bounded trusted plain-text `title` and `body` presentation.

`request` is idempotent:

1. The first call creates `pending` and returns a stable `/approve/:approvalId` URL.
2. The same request returns the same row and URL.
3. Reusing the action ID with a changed kind, fingerprint, or presentation fails closed.
4. Later calls return `approved`, `denied`, or derived `expired`.

The caller owns action execution, retries, and completion. It must recompute the fingerprint and call `request` again at the final effect boundary. Approval has no claimed, executing, completed, or provider-error state.
When `pending` is returned, the approval URL is handed to the normal assistant reply path; the approval system must not send a separate hard-coded user message.

## Browser decision flow

1. `/approve/:approvalId` requires the owning member's active hosted app session before showing details.
2. Pressing **Approve with passkey** rotates the row to a fresh `assistant.action.approve` challenge bound to member, session, approval ID, action ID, and action hash.
3. The browser signs the existing server-generated challenge with the member's passkey-MFA-protected embedded wallet.
4. The decision route verifies the signature and atomically changes `pending` to `approved` only if that exact challenge is still current.
5. Denial requires the authenticated session but not wallet MFA because it cannot release data or execute the action.
6. The route best-effort signals `runtime_recheck_requested` and redirects using the existing server-resolved Murph contact UX.

The reply text is only a wake/fallback affordance. It is never authorization evidence; the runtime trusts only `actionApprovalPort.request()`.

## Privacy and retention

Approval rows contain no action payload, file bytes, raw recipient identifier, signature, or wallet authorization material. They store only an exact-action hash and bounded presentation text. Rows are member-scoped, cascade with the hosted member, and are explicitly covered by account deletion. User exports omit the rows and their security metadata.
