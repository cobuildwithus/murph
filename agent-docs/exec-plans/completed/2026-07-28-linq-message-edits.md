# Handle Linq message edits as conversational input

Status: completed
Created: 2026-07-28
Updated: 2026-07-28

## Goal

- Make a provider-authenticated inbound Linq `message.edited` webhook enter the
  existing hosted conversation owner with the edited text, without inventing a
  parallel queue, state machine, or delivery path.
- Preserve the original incident conclusion: edits are an unsupported ingress
  case, not an explanation for a separately provider-accepted outbound message
  that did not become visible on-device.

## Success criteria

- The shared Linq boundary validates the documented `2026-02-03`
  `message.edited` shape and rejects malformed or legacy-version payloads.
- Only inbound edits are eligible for conversational admission; outbound edits
  remain operational evidence and cannot wake Murph.
- Exact event replay remains idempotent through the existing provider-event and
  mailbox owners.
- Group/direct route authority and access checks reuse their existing owners;
  mailbox ordering, retention, wake signaling, and terminal reply ownership
  stay on the ordinary conversation path. An edit does not consume inbound
  quota or repeat original-message side effects.
- Production subscription requirements and safe rollout order are documented.
- Focused tests, canonical diff verification, acceptance verification,
  preliminary specialist review, product-experience review, final ReviewGPT,
  and PR CI all pass for the final pushed head.

## Scope

- In scope:
  - Linq `message.edited` parsing, minimization, provider-event observability,
    hosted admission, local subscription parity, tests, and owner docs.
  - A ReviewGPT design consultation before production-code changes.
- Out of scope:
  - Retrofitting edits into already-generated or provider-accepted replies.
  - A mutable transcript/message table, cancellation of an in-flight model
    turn, or a second edit-specific retry owner.
  - Solving handset delivery uncertainty for the earlier outbound message.

## Constraints

- Technical constraints:
  - Linq emits one edited text part with the original message id, chat,
    direction, sender handle, and edit timestamp; it does not emit a complete
    `message.received` payload.
  - The `message.edited` webhook is available only to subscriptions using
    `webhook_version: "2026-02-03"`.
  - Provider payloads are untrusted until the shared messaging-ingress parser
    validates the exact shape.
- Product/process constraints:
  - Preserve one accepted-conversation-input lifecycle and fail closed when
    route or sender authority cannot be proven.
  - Keep private incident content and direct identifiers out of source, tests,
    docs, logs, review prompts, and PR artifacts.
  - Use the worktree/PR lane and complete all mandatory review gates.

## Risks and mitigations

1. Risk: Treating an edit as a fresh message can produce a second response after
   the original already completed.
   Mitigation: ask ReviewGPT to pressure-test the product semantics before
   implementation, then make the continuation semantics explicit and bounded.
2. Risk: Reusing the `message.received` planner with synthetic or incomplete
   authority fields can misclassify the route or sender.
   Mitigation: do not reuse that planner. Correlate only to an accepted mailbox
   original, then revalidate the current direct or group authority from
   existing Web-owned state before appending the correction.
3. Risk: Enabling the subscription before Web can parse the event creates a
   retry storm or silent ignores.
   Mitigation: deploy additive Web support first, then add the event to the
   provider subscription and verify one signed inbound edit end to end.

## Tasks

1. Inspect the current Linq webhook, provider-event, planner, mailbox, and
   subscription owners plus the official payload contract.
2. Ask ReviewGPT for the smallest safe edit-event behavior and ownership model.
3. Implement the accepted design with exact-shape and product-path regression
   coverage plus durable owner documentation.
4. Run focused direct proof and canonical verification.
5. Complete preliminary specialists, product-experience review, parent review,
   final verification, final ReviewGPT, and PR CI.

## Decisions

- ReviewGPT design consultation completed against the exact source snapshot.
  The accepted architecture is an immutable correction appended by the hosted
  mailbox, correlated to an already-accepted original through a blind
  source-message lookup key. The diagnostic provider-event ledger remains
  non-authoritative.
- Do not pass the partial edit webhook through the full onboarding planner.
  Edits cannot create members, rerun first-contact classification, renew group
  access, consume quotas, send read receipts, or select a new conversation
  owner.
- Add optional structured correction markers to the existing Linq
  conversation-message contract: the provider part index and a deterministic
  opaque reference to the original accepted assistant input. Keep trusted edit
  semantics separate from the replacement text supplied by the person, and
  keep provider identifiers out of prompts.
- Do not mutate or supersede the original input, cancel a running turn, fetch
  mutable provider state, or add a pending-edit queue. Existing causal
  selection, live-input admission, pending recovery, and terminality remain the
  only execution lifecycle.
- Linq's current official contract proves a maximum of five edits within 15
  minutes, replacement text from 1 to 10,000 characters, at-least-once webhook
  delivery, and roughly 25 minutes of retries for 5xx/429/network failures.
  Therefore a missing original can use the existing retryable outcome only
  inside the bounded provider window; no indefinite local pending state is
  justified.
- Deploy nullable schema and ordinary-message source-key dual writes first,
  correction readers next, and the dormant edit writer after reader
  compatibility. Keep the provider subscription disabled until the source
  index has covered the 15-minute edit window plus the 25-minute retry tail.

## Verification

- Commands to run:
  - Focused messaging-ingress and hosted-web Vitest suites selected after the
    final owner boundary is known.
  - `pnpm test:diff <touched paths>`
  - `pnpm verify:acceptance`
- Expected outcomes:
  - Exact inbound edit replay creates at most one accepted conversation input
    and one normal continuation owner.
  - Outbound, malformed, unsupported-version, stale-route, and duplicate edit
    cases remain fail-closed or idempotent without a conversational wake.
- Completed direct proof:
  - Fresh-schema `prisma migrate deploy` applied all migrations, including the
    nullable blind source-message index.
  - The full real-PostgreSQL Linq concurrency suite passed 15/15, including
    original/edit serialization on the blind source key and production-store
    hydration of ordered original/correction lineage with retired content.
  - Focused ingress, execution-contract, mailbox-import, prompt/live-turn,
    local-subscription, hosted mailbox/planner/provider-event, and dispatch
    suites passed.
  - Typechecks passed for messaging ingress, hosted execution, assistant
    runtime, assistant engine, hosted local harness, and hosted Web.
  - Preliminary specialists returned four accepted findings: distinguish the
    exact original in prompt framing, prove direct/group revocation branches,
    prove changed-replay/equal-time failures, and exercise the production
    source-lineage writer/reader seam. The remediation and direct proofs are
    included in the final candidate; the preliminary pass is not rerun.
  - Product-experience review found one accepted post-reply policy gap. The
    correction prompt now requires one concise follow-up only for a material
    answer/action change and the existing durable `finish_without_reply` path
    for immaterial wording changes. The focused re-review marked the finding
    resolved.
  - The final local `pnpm test:diff` cleared architecture/privacy/dependency
    guards, all affected typechecks, and the assistant-engine, assistant-cli,
    assistant-runtime, assistantd, hosted-execution, and other completed
    package suites. Its broad CLI aggregate reproduced eight unrelated
    subprocess timeouts on the shared host and did not terminate by itself.
    The hosted-local harness initially failed because its required ignored
    assistant-runtime build artifact was absent; after preparing that artifact,
    the full harness passed 410/410 tests. One clean, secret-free remote
    `pnpm verify:acceptance` remains the exact-head completion proof after the
    final local commit.
Completed: 2026-07-28
