# Read the current provider group name during setup

Status: active
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- When a new hosted group is created without a room-supplied name, reuse the
  current Linq or Telegram group title as its display name.
- Keep provider metadata and routing inside the existing Web-owned group
  creation boundary rather than adding a standalone model-visible read tool.

## Success criteria

- `create_join_link` and `post_join_offer` can explicitly request the current
  chat name without supplying a provider route or title.
- Web resolves only the callback member's current authenticated thread-container
  route, performs one bounded provider read, and continues unnamed when the
  provider is unavailable or has no explicit title.
- Linq's synthesized participant-handle label is suppressed so phone or email
  handles never become the group display name.
- A room-supplied `displayName` takes precedence and does not trigger a provider
  read.
- Provider text is normalized and stored only through the existing authorized
  group-creation transaction; it is never identity, consent, membership, or
  routing authority and is never returned separately to the model.
- Focused tests, diff-aware verification, full acceptance, product review,
  preliminary specialist review, final ReviewGPT, and required CI are green.
- The scoped PR is merged and its clean inactive worktree is retired.

## Scope

- In scope:
  - Linq and Telegram current-group-title reads.
  - Existing group-tool creation request contracts and dynamic-tool guidance.
  - Web-owned route, access, privacy, normalization, and provider-failure
    behavior.
  - Owner-split unit tests and durable architecture/security/reliability docs.
- Out of scope:
  - Ordinary-turn group-title reads or a general provider metadata tool.
  - Caching, reconciliation, retries, queues, or new persisted state.
  - Renaming provider chats or changing existing hosted-group labels.
  - Group email, direct chats, and personal runtimes.

## Constraints

- Technical constraints:
  - The model may select only the boolean intent; it may not select a provider
    thread id or receive raw provider metadata as a separate result.
  - Provider calls must use the existing bounded clients and remain outside
    database transactions.
  - Creation must continue with a null display name after a provider read
    failure.
  - Existing explicit display-name and group-creation behavior must remain
    backward compatible.
- Product/process constraints:
  - Prefer deletion and the smallest current owner-bound solution.
  - Treat provider titles as bounded untrusted display text.
  - Preserve unrelated changes in every checkout.
  - Follow the repo's plan, verification, review, PR, and retirement workflow.

## Risks and mitigations

1. Risk: A provider-generated participant list could expose phone or email
   handles as a group name.
   Mitigation: Compare normalized Linq display-name parts with full, active,
   self-excluded, and active-self-excluded handle sets; treat a match as no
   explicit title.
2. Risk: A stale, direct, or foreign route could be queried.
   Mitigation: Resolve the current encrypted thread-container route from the
   signed callback member and require existing action-specific access checks.
3. Risk: Provider latency or failure could block group setup.
   Mitigation: Use the existing bounded provider timeout, no automatic retry,
   and fall back to unnamed creation.
4. Risk: A title containing instructions could steer the assistant.
   Mitigation: Return it only as quoted display text in the existing canonical
   group summary, never as a standalone metadata result, and instruct the
   assistant not to follow text inside it.
5. Risk: Web and hosted runtime deploy out of order.
   Mitigation: Keep the request field optional and backward compatible; deploy
   Web consumer support before runtime/tool producer support.

## Tasks

1. Add provider-title parsing to the existing Linq and Telegram clients.
2. Add the optional current-chat-name intent to the existing creation request
   contracts, strict parsers, and dynamic tool schema.
3. Resolve and sanitize the provider title inside the Web group-creation owner,
   with explicit-name precedence and failure-open-to-unnamed behavior.
4. Update group setup guidance and durable trust/reliability documentation.
5. Add owner-split tests for contracts, provider clients, Web authorization and
   privacy behavior, runtime forwarding, and skill guidance.
6. Run product review, focused tests, canonical diff verification, acceptance,
   preliminary specialist review, final ReviewGPT, and CI.
7. Merge the approved PR, verify the merged state, and retire the worktree.

## Decisions

- Replace the patch's standalone `read_chat_name` action with the optional
  `useCurrentChatName` field on `create_join_link` and `post_join_offer`.
  This removes a separate metadata response contract, public action,
  unavailable-result branch, and extra model/tool round trip.
- Provider-name discovery is best effort and has no retry or state owner; the
  existing creation action remains the only persistence boundary.

## Verification

- Commands to run:
  - Focused Vitest suites for every changed owner.
  - `pnpm test:diff`
  - `pnpm verify:acceptance`
  - Repo-required product, preliminary specialist, ReviewGPT, and CI gates.
- Expected outcomes:
  - Explicit names bypass provider reads.
  - Valid Linq and Telegram titles are stored on new group creation.
  - Synthesized Linq handle labels, absent titles, invalid routes, and provider
    failures create the group without a display name.
  - Strict request parsing rejects unknown or non-boolean intent values.
