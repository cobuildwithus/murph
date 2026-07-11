# Hosted group self-service leave and data withdrawal

## Goal

- Let a hosted-group participant explicitly leave from the current group conversation.
- Withdraw logical membership and every active vault share they granted to that group's runtime in one transaction.
- Reuse the existing durable cleanup mailbox so retryable deletion removes the participant's imported projections from the group workspace.

## Success criteria

- The current Linq sender can leave only themself and only from the hosted group whose runtime is handling the message.
- A successful leave atomically marks membership inactive, revokes all active shares to the group runtime, and appends cleanup wakes.
- Repeated leave requests are idempotent and do not recreate membership or shared data.
- Join-link and later reaction join paths can explicitly rejoin a former member without weakening access or consent checks.
- Product guidance states what group-scoped data is deleted and what cannot be retroactively erased from provider or message history.
- Focused tests, required audits, full typecheck, and the acceptance test lane pass.

## Scope

- In scope:
  - Hosted group membership storage and vault-share cleanup orchestration.
  - Hosted execution request/response contracts and parsers.
  - Conversation-scoped group tool wiring, assistant guidance, and regression coverage.
  - Durable product/contract documentation and deployment-order guidance.
- Out of scope:
  - Removing another participant.
  - Retroactive deletion from Linq/iMessage, email, backups, or other provider-controlled history.
  - A new web settings surface, ownership transfer workflow, or new persistence model.

## Constraints

- Technical constraints:
  - Revoke access before or atomically with cleanup; never rely on model-supplied identity.
  - Preserve the group runtime, other memberships, and other participants' data.
  - Keep cleanup retryable and idempotent through existing vault-share revoke envelopes.
  - Keep only the smallest replay fence needed to prevent a delayed reaction from silently reactivating membership.
- Product/process constraints:
  - Prefer deletion and the existing ownership boundary over new lifecycle machinery.
  - Keep unrelated working-tree and coordination-ledger work untouched.
  - Follow the hosted trust-boundary, completion-audit, verification, and PR-review workflows.

## Risks and mitigations

1. Risk: a delivery races with leave and reintroduces data after cleanup.
   Mitigation: revoke and cleanup-envelope append use the same locked transaction as membership withdrawal; the leave fence time is captured after locks.
2. Risk: a sender leaves another participant or a different group.
   Mitigation: derive identity and runtime scope from the authenticated current Linq delivery context, never from tool arguments.
3. Risk: a delayed old reaction silently rejoins the member.
   Mitigation: compare the provider event's durable first-received server time to `leftAt`, never the provider clock.
4. Risk: owner departure leaves contradictory group and runtime ownership.
   Mitigation: reject owner leave until an explicit ownership-transfer or group-dissolve flow exists.
5. Risk: confirmation overstates erasure.
   Mitigation: document that Murph-owned imported projections are removed while already-sent/provider-controlled history remains outside this operation.
6. Risk: old web instances ignore `leftAt` during a mixed deploy or rollback.
   Mitigation: deploy schema, then `leftAt`-aware web readers and drain old instances before enabling runtime leave; treat that web version as the rollback floor after the first leave.

## Tasks

1. Define and test the group-store leave transaction, idempotency, and explicit rejoin semantics.
2. Add the conversation-scoped hosted group tool action across shared contracts, parsers, web handling, and runtime-injected sender identity.
3. Add assistant skill/tool guidance and durable product documentation.
4. Run focused tests, required coverage/security audits, full acceptance verification, and local final review.
5. Finish the scoped commit, open a draft PR, and complete the PR review loop.

## Decisions

- `HostedGroupMember.leftAt` is null for active membership and set for a leave; do not add a second table or lifecycle state machine.
- Reject group-owner leave until ownership transfer or group dissolution can move or remove the durable group/runtime ownership boundary coherently.
- A later explicit link acceptance, or a reaction first received by Murph after `leftAt`, is the only rejoin path; older or equal reactions remain fenced out.
- Treat successful leave as membership withdrawal plus durable cleanup scheduling; cleanup delivery remains retryable and may complete after the conversational acknowledgement.

## Verification

- Commands to run:
  - Focused Vitest suites for hosted execution, hosted group store/tool, assistant runtime, and assistant engine.
  - `pnpm test:diff`
  - `pnpm verify:acceptance`
  - Required coverage-write and security/privacy completion audits, followed by local final review.
- Expected outcomes:
  - Tests prove self-only authorization, atomic revoke/withdraw ordering, idempotent repeat leave, cleanup signaling, explicit rejoin, and parser/tool coverage.
  - Diff-aware and full acceptance lanes exit successfully without tracked generated artifacts.
Status: completed
Updated: 2026-07-11
Completed: 2026-07-11
