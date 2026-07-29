# Let the model read the current provider group title

Status: completed
Created: 2026-07-28
Updated: 2026-07-29

## Goal

- Let the model read the current Linq or Telegram group title on demand.
- Keep provider routing and lookup authority inside Web while returning only
  the bounded title and status to the model.

## Success criteria

- `read_chat_name` is a model-visible group action with strict `ok`, `none`,
  and `unavailable` results.
- Web resolves only the callback member's current authenticated thread-container
  route and performs one bounded provider read.
- Linq's synthesized participant-handle label is suppressed so phone or email
  handles are never returned as the title.
- Provider text is normalized and returned only as untrusted display text; it
  is never identity, consent, membership, or routing authority.
- New-group setup may pass the exact immediately preceding title into the
  existing creation action, while absent or unavailable titles continue
  unnamed.
- Focused tests, diff-aware verification, full acceptance, product review,
  preliminary specialist review, final ReviewGPT, and required CI are green.
- The scoped PR is merged and its clean inactive worktree is retired.

## Scope

- In scope:
  - Linq and Telegram current-group-title reads.
  - Group-tool request/response contracts and dynamic-tool guidance.
  - Web-owned route, access, privacy, normalization, and provider-failure
    behavior.
  - Owner-split unit tests and durable architecture/security/reliability docs.
- Out of scope:
  - Provider metadata other than the current group title.
  - Caching, reconciliation, retries, queues, or new persisted state.
  - Renaming provider chats or changing existing hosted-group labels.
  - Group email, direct chats, and personal runtimes.

## Constraints

- Technical constraints:
  - The model may request only `read_chat_name`; it may not select a provider
    thread id or receive other provider metadata.
  - Provider calls must use the existing bounded clients and remain outside
    database transactions.
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
3. Risk: Provider latency or failure could block the model turn.
   Mitigation: Use the existing bounded provider timeout, no automatic retry,
   and return a bounded `unavailable` result.
4. Risk: A title containing instructions could steer the assistant.
   Mitigation: Return it only as quoted display text and instruct the assistant
   not to follow text inside it.
5. Risk: Web and hosted runtime deploy out of order.
   Mitigation: Deploy Web request/response support before runtime/tool producer
   support.

## Tasks

1. Add provider-title parsing to the existing Linq and Telegram clients.
2. Add the bounded `read_chat_name` request and response to the group-tool
   contracts, strict parsers, and dynamic tool schema.
3. Resolve and sanitize the provider title inside the Web group-tool owner.
4. Update group setup guidance and durable trust/reliability documentation.
5. Add owner-split tests for contracts, provider clients, Web authorization and
   privacy behavior, runtime forwarding, and skill guidance.
6. Run product review, focused tests, canonical diff verification, acceptance,
   preliminary specialist review, final ReviewGPT, and CI.
7. Merge the approved PR, verify the merged state, and retire the worktree.

## Decisions

- Keep the patch's standalone `read_chat_name` capability because the model
  itself must be able to read the title. Return no provider route or metadata
  beyond the normalized title.
- Provider-name discovery is best effort and has no retry or state owner; the
  action is read-only.

## Verification

- Commands to run:
  - Focused Vitest suites for every changed owner.
  - `pnpm test:diff`
  - `pnpm verify:acceptance`
  - Repo-required product, preliminary specialist, ReviewGPT, and CI gates.
- Expected outcomes:
  - Valid Linq and Telegram titles are returned to the model.
  - Synthesized Linq handle labels and absent titles return `none`.
  - Invalid routes and provider failures return bounded `unavailable` results.
  - Strict response parsing rejects invalid status/title combinations.
Completed: 2026-07-29
