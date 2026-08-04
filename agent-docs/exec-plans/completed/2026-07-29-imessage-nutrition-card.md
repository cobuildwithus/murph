# Inline iMessage daily nutrition response card

Status: completed
Created: 2026-07-29
Updated: 2026-07-29

## Goal

- Deliver a read-only `daily_nutrition` response card through Murph's existing
  assistant response/outbox owner. A private direct iMessage recipient sees a
  compiled Murph Messages extension card whose immutable values are carried in
  the message URL; every other route receives deterministic text derived from
  the same card payload.

## Success criteria

- `murph.attach_response_card` accepts exactly one validated
  `daily_nutrition` card, fails closed for group use and media coexistence, and
  attaches it to the current final response without creating another delivery
  path.
- The provider result, durable outbox intent, and hosted delivery side effect
  carry one optional card, and the outbox identity changes when the card
  changes.
- A confirmed private direct Linq iMessage route sends one `imessage_app` part
  containing a versioned, Base64 JSON `data:` URL under 4,096 characters.
- Linq capability false, error, or missing-handle cases deliver deterministic
  ordinary text; static iMessage fallback/layout text contains no nutrition
  values or dates.
- The existing automatic 9 PM meal closeout retains its automation identity,
  schedule, route, cleanup, and safety rules while requiring an immediate
  canonical totals read before attaching a single-date card.
- Focused tests cover schema validation, encoding, deterministic rendering,
  outbox identity, tool restrictions, Linq request shape, and capability
  fallback.
- The independently reviewed sibling iOS change decodes and renders the same
  V1 envelope locally with no network, account, keychain, or persisted state.

## Scope

- In scope:
  - Closed response-card contract and deterministic render/transport helpers.
  - Codex dynamic tool attachment and provider-result propagation.
  - Existing assistant outbox and hosted delivery payload integration.
  - Linq capability check, one-part app-card send, and ordinary-text fallback.
  - Existing automatic meal closeout skill instruction update.
  - Focused tests and the smallest matching durable architecture guidance.
  - A separately reviewed sibling `murph-ios` Messages extension target,
    decoder, SwiftUI card, tests, host embedding, and submission configuration.
- Out of scope:
  - App Clips, database or API card storage, encryption, authorization,
    expiration, cleanup, remote reads, or shared Keychain access.
  - Generic layouts/components, arbitrary model-authored UI, card actions,
    live updates, goals, progress rings, per-meal or group cards, multiple
    cards, and web routes or dashboards.
  - Changing the managed automation ID, schedule, queue, route, or opt-in.

## Constraints

- Technical constraints:
  - Reuse the existing response-media attachment and delivery ownership seams;
    a card is a singular sibling primitive and may not coexist with media.
  - Runtime code, not the model, owns `schemaVersion: 1`, encoded transport,
    static layout text, and both fallback renderers.
  - No Prisma schema/migration or `apps/web` card route changes.
  - Preserve package public-entrypoint and acyclic dependency rules.
  - Do not log card payloads or include nutrition values in Linq diagnostics.
- Product/process constraints:
  - Numerical nutrition output remains subject to the existing member safety
    and eating-disorder safeguards.
  - Multi-date catch-up and missing-calorie closeouts keep existing text or
    suppression behavior.
  - Use ReviewGPT for implementation input and the required exact-head PR
    review gates; inspect every returned patch before applying it.
  - The backend and iOS changes require separate commits/PRs and must identify
    one another as counterpart contracts.

## Risks and mitigations

1. Risk: Model-copied totals differ from the immediately preceding canonical
   read.
   Mitigation: Require exact copy semantics in the closeout skill and keep the
   card presentation-only; do not add a second canonical read owner in V1.
2. Risk: An iMessage-only card is attempted for an unavailable or non-direct
   route.
   Mitigation: Require direct-route evidence and a successful Linq capability
   check; otherwise send deterministic text through the existing delivery
   owner.
3. Risk: Inline values are mistaken for encrypted or revocable data.
   Mitigation: Document that the message is the immutable snapshot, keep the
   payload minimal, and make forwarding preserve the same frozen values.
4. Risk: Linq's public guide and runtime support diverge on `data:` URL limits.
   Mitigation: keep the transport isolated behind one encoder, enforce the
   product's 4,096-character bound, and treat physical-device preservation of
   `selectedMessage.url` as a pre-release gate.
5. Risk: Persisted cards stop rendering after a future schema change.
   Mitigation: retain the small V1 decoder and compiled view; reject unknown
   versions and card kinds with a harmless unsupported-card state.

## Tasks

1. Inspect current response-media, provider-result, outbox, hosted side-effect,
   Linq, managed-closeout, and sibling iOS proof seams.
2. Ask ReviewGPT for a scoped Murph implementation patch with focused tests,
   then inspect and integrate it without accepting new state owners.
3. Complete or correct the Murph implementation locally and run focused
   contract, runtime, outbox, and delivery tests plus required typechecks.
4. Create a fresh sibling iOS branch from current main, ask ReviewGPT for the
   selective proof migration, inspect/integrate it, and verify XcodeGen,
   formatting, builds, tests, accessibility states, and light/dark rendering.
5. Run the required product-experience and preliminary specialist reviews,
   resolve findings, perform parent final review, then use ReviewGPT as the
   sole cross-cutting final gate for each eligible exact pushed PR.
6. Finish scoped commits and PRs with counterpart/deployment contracts and
   explicitly record any remaining physical-device evidence gates.

## Decisions

- The message is the immutable snapshot; inline card data is encoded but not
  encrypted, account-bound, revocable, or remotely fetched.
- `daily_nutrition` is the only V1 card kind in a closed response-card union.
- A card is presentation attached to the current response, not media and not a
  standalone send.
- The outbox remains the single delivery owner and stores deterministic
  semantic text derived from the card.
- Capability is checked at send time with no durable or long-lived cache.
- The Messages extension is a local decoder/renderer only and retains no
  composer, poll, API client, credential store, settings, or auth UI.
- Response-card tool availability is derived from the trusted managed meal
  closeout automation authority as well as the private-direct audience; manual
  turns and other automations cannot offer it.
- The provider result preserves the provider-authored scheduled decision
  separately from runtime-owned card presentation. The notification owner
  validates that decision, derives transcript/fallback text from the card, and
  passes the same card to the existing outbox.

## Verification

- Murph commands:
  - Focused Vitest suites for response-card contracts, Codex attachment,
    outbox identity/persistence, hosted payloads, Linq body/capability
    fallback, and managed closeout behavior.
  - `pnpm test:diff <changed owners>`
  - `pnpm verify:acceptance`
- iOS commands:
  - `xcodegen generate`
  - `swiftformat --lint .`
  - `xcodebuild test` for the Messages extension scheme on an available iOS
    simulator, plus a host-app build proving extension embedding.
- Expected outcomes:
  - All automated checks pass with no card values in static fallback, layout,
    logs, or diagnostics.
  - Simulator evidence covers complete, partial, malformed, unsupported,
    light, dark, and accessibility states.
  - Physical-device/TestFlight evidence separately proves Linq preserves the
    inline URL, the extension renders offline and after logout/relaunch, the
    generic card and SMS fallback behave correctly, forwarding freezes values,
    and retries do not duplicate delivery.

## Review notes

- Preliminary ReviewGPT found that the scheduled notification adapter parsed
  runtime-rendered card text as its JSON decision and did not forward the card,
  that the tool was offered to all private-direct turns, and that the skill's
  argument mapping was ambiguous. All three findings were accepted and fixed at
  the existing notification, planning, and skill owners.
- Parent verification after remediation:
  - Six directly affected suites: 405 tests passed; the provider-shape
    regression plus card suites: 408 tests passed.
  - Full assistant-engine coverage: 181 files passed, 1 skipped; 2,833 tests
    passed, 8 skipped; statements 89.87%, branches 82.55%, functions 94.20%,
    lines 89.90%.
  - Diff-aware dependency/architecture/log guards, six affected-package
    typechecks, full assistant-engine, assistant CLI, assistant runtime, and
    assistant daemon lanes passed. The later CLI source subprocess lane hit
    repeated 60-second local harness timeouts without an assertion failure; the
    exact-tree remote acceptance had already passed that lane.
Completed: 2026-07-29
