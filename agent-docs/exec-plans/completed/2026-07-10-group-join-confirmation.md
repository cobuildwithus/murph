# Private confirmation after a hosted group join

Status: completed
Created: 2026-07-10
Updated: 2026-07-11

## Goal

- When a member first joins a hosted group, append a private mailbox wake to
  their own Murph account that confirms the join, asks whether it was
  intentional, and links to the existing first-party sharing editor.

## Success criteria

- Reaction-based and join-page-based first joins use the same transactional
  confirmation path.
- Existing memberships and repeat accepts do not create another confirmation.
- The notification targets only the joining member's private assistant route,
  uses the existing generic assistant-notification wake, and includes a full
  first-party group URL.
- A missing private route or public base URL does not roll back the join.
- Focused tests, repository-required verification, completion audits, and
  privacy review pass.

## Scope

- In scope: hosted group join store, reaction and web accept callers, private
  notification construction/routing, focused tests, and the durable product
  contract.
- Out of scope: a new mailbox event kind, a scheduler or retry queue, changing
  group-leave behavior, or redesigning the join UI.

## Constraints

- Technical constraints: append the mailbox item in the membership transaction;
  signal the existing runtime wake only after commit; preserve existing join
  and share-grant invariants; do not overlap the mailbox consumed-at lane.
- Product/process constraints: keep copy reciprocal and calm, use a full
  first-party URL, do not claim the sharing page removes membership, and do
  not expose mailbox identifiers in public API responses.

## Risks and mitigations

1. Risk: repeat reactions or join-page share edits cause duplicate texts.
   Mitigation: create the notification only when the shared join primitive
   creates a new membership, with a stable membership-derived event ID.
2. Risk: the notification is routed to the group conversation.
   Mitigation: resolve the member's private home route from persisted identity
   and routing state inside the transaction; skip notification creation when
   no private route is available.
3. Risk: owner-controlled group data becomes model prompt injection or copy
   overpromises an undo path.
   Mitigation: keep group names out of model instructions and send bounded,
   server-rendered exact text that describes the link only as a sharing editor.

## Tasks

1. Add a small transactional group-join confirmation helper using the existing
   generic assistant-notification mailbox contract.
2. Invoke it from the shared first-join transaction and signal it after commit
   in both join entry points.
3. Add focused tests for routing, deduplication, failure tolerance, and public
   response privacy.
4. Record the user-visible contract and run required verification and audits.
5. Finish the scoped task commit and open/review the pull request.

## Decisions

- Reuse `assistant.notification.requested`; no new mailbox kind or runtime
  consumer is needed.
- A reply is invited, but the link is described only as a way to review or
  change shared data because the existing page is not a leave-group control.
- The confirmation uses server-rendered exact text and does not pass the
  owner-controlled group display name through a model turn.
- Notification creation is best-effort with respect to route/base-URL
  availability, while any created item is atomic with membership creation.

## Verification

- Commands to run: focused Vitest files, the truthful diff verification lane,
  repository privacy/secret checks, required security and coverage audits, and
  PR checks where available.
- Expected outcomes: all new and affected tests pass; type checking succeeds;
  no duplicate notification is created for an existing membership; no private
  mailbox metadata is returned by the public accept API.
Completed: 2026-07-11
