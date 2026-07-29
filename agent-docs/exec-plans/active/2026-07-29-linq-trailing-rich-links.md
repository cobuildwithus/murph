# Render terminal Linq URLs as native rich-link previews

Status: active
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Render a terminal HTTPS URL as a provider-native Linq rich-link preview
  without sending a URL in the first message of a newly created chat.
- Preserve the existing local and hosted delivery owners, retry semantics, and
  non-link message behavior.

## Success criteria

- Shared parsing recognizes one safe terminal HTTPS token after normal wrapper
  and punctuation removal while rejecting credentials, non-HTTPS schemes,
  oversized URLs, embedded URLs, and ordinary text.
- Existing-chat text or media is accepted before a separate link-only provider
  message; link-only existing-chat sends stay one provider request.
- New-chat sends with natural text or media create that URL-free primary
  message and then send the link-only preview against the returned chat id.
- Link-only new-chat requests fail clearly instead of fabricating user-facing
  opener copy that the caller did not supply.
- Every multi-request path derives a distinct stable follow-up idempotency key
  from the delivery owner's existing key and fails retryably when the provider
  cannot identify the created chat.
- Reaction-bound messages remain one provider message instead of creating a
  second, ambiguously actionable bubble.
- Hosted two-request sends fit the existing provider-fence budget.
- Focused tests, canonical diff verification, canonical acceptance, the
  product-experience review, preliminary specialist review, parent review,
  final ReviewGPT, and PR CI complete with no unresolved accepted findings.

## Scope

- In scope:
  - shared trailing-HTTPS parser and export
  - local operator-config Linq send/create adapters
  - hosted Web Linq send/create adapters
  - focused tests and durable Linq egress documentation
- Out of scope:
  - provider SDK upgrades or dependency changes
  - new persisted state, queues, delivery owners, or reconciliation
  - changing hosted reply anchoring or unrelated Linq message formatting
  - rich previews for embedded or nonterminal URLs

## Constraints

- Technical constraints:
  - A Linq `link` part must be the only part in its provider message.
  - A new-chat create request cannot contain either a `link` part or a URL in
    its initial text; do not invent filler copy to bypass that provider rule.
  - Reuse the installed SDK's public `MessageSendParams` surface rather than
    duplicating its rich-link wire type.
  - Keep the first accepted text/media message id as the logical delivery
    result.
- Product/process constraints:
  - Keep outbound copy conversational and make the extra provider message
    explicit in the product-experience and hot-path review.
  - Treat the supplied patch as behavioral intent and preserve newer
    `origin/main` behavior.
  - Use the isolated PR lane and exact-head review gates.

## Risks and mitigations

1. Risk: a retry after the first provider effect succeeds could duplicate one
   half of the delivery.
   Mitigation: retain the original key for the primary effect and derive one
   deterministic `:link` key for the link effect; prove request identity.
2. Risk: two serial hosted requests could exceed the group-aware provider
   fence, which budgets ten seconds for provider I/O.
   Mitigation: divide that existing budget evenly between the two requests;
   keep link-only and ordinary messages on the existing single-request budget.
3. Risk: broad URL parsing could alter ordinary prose or unsafe URLs.
   Mitigation: accept only one bounded terminal HTTPS token with no URL
   credentials and retain focused adversarial coverage.
4. Risk: local and hosted Linq adapters drift.
   Mitigation: put URL-token recognition in `@murphai/contracts`, keep provider
   request construction in each existing adapter, and prove both paths.

## Tasks

1. Reconcile the supplied patch with current `origin/main` and the installed
   Linq SDK types.
2. Add focused parser, local adapter, hosted adapter, retry-identity, and
   bounded-timeout coverage.
3. Update the live Linq egress documentation and run focused/canonical proof.
4. Run the product and preliminary specialist reviews, resolve accepted
   findings, then complete parent review and canonical acceptance.
5. Close this plan through `scripts/finish-task`, push the exact head, run final
   ReviewGPT concurrently with CI, prove mergeability, and hand off the PR.

## Decisions

- `@murphai/contracts` owns only the provider-neutral terminal URL split.
- Existing local and hosted adapters remain the two provider request owners.
- There is no new delivery state: replay converges through Linq's existing
  idempotency contract and the owners' already-durable keys.
- Hosted sends remain intentionally unthreaded; this task does not revive
  provider reply anchors.

## Verification

- Commands to run:
  - focused Vitest for contracts, operator-config Linq HTTP, hosted Web Linq
    HTTP, and hosted group-tool behavior
  - `pnpm test:diff <all touched source/test/doc paths>`
  - `pnpm verify:acceptance`
  - required exact-head product, specialist, final ReviewGPT, CI, and
    mergeability gates
- Expected outcomes:
  - all commands pass on the exact pushed head
  - direct request-body proof shows URL-free natural chat creation, link-only
    existing-chat payment and preview requests, stable distinct idempotency
    keys, explicit link-only new-chat refusal, and unchanged ordinary sends
  - no unresolved accepted review finding remains
