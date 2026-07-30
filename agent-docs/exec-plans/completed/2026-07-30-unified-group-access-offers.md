# Unify group access offers across iMessage and SMS

Status: completed
Created: 2026-07-30
Updated: 2026-07-30

## Goal

- Give the assistant one semantic way to offer group access while the trusted
  hosted runtime chooses the presentation supported by the current channel.
- Preserve native iMessage Like-to-consent offers and use existing first-party
  permission links for SMS, Telegram, scheduled delivery, and explicit
  standalone-link requests.

## Success criteria

- Current interactive iMessage routes keep the native consent offer.
- SMS and Telegram routes receive a usable first-party link without exposing
  unsupported iMessage reactions, attachments, or chat customization.
- Scheduled group turns use the existing link path because their durable route
  does not encode the Linq service subtype.
- Ambiguous or mismatched route evidence fails closed.
- SMS sender handles remain available for route-authorized group attribution.
- Focused assistant-engine and assistant-runtime tests and typechecks pass.
- Required product, preliminary specialist, final ReviewGPT, and exact-head CI
  gates complete with no unresolved accepted findings.

## Scope

- In scope: assistant tool schema/parsing, hosted channel adapter, group skills,
  direct regression tests, and live architecture/product documentation.
- Out of scope: database or API changes, new persisted state, new queues or
  services, provider delivery rewrites, and changes to Web-owned group access
  semantics.

## Constraints

- Technical constraints: keep existing `create_join_link` and
  `post_join_offer` wire actions as the Web-owned implementation surface; add
  no compatibility path that makes assistant-engine depend on runtime.
- Product/process constraints: sharing stays explicit, scoped, route-bound,
  and fail-closed; no additional automatic message is introduced; use an
  isolated worktree and the PR completion workflow.

## Risks and mitigations

1. Risk: channel selection could weaken route or consent authority.
   Mitigation: derive presentation only from trusted runtime route context and
   keep all existing Web-side authorization and effect ownership unchanged.
2. Risk: SMS fallback could accidentally expose iMessage-only effects.
   Mitigation: return typed unsupported responses and cover each service branch
   with deterministic tests.
3. Risk: the old embedded patch no longer matches current owner code.
   Mitigation: port behavior manually onto current `main`, inspect the full
   affected call paths, and fix types at the owning boundary rather than
   replaying the stale patch mechanically.

## Tasks

1. Reconstruct the intended behavior from PR #1064 and compare it with current
   owners on `main`.
2. Implement the semantic assistant action and trusted channel adapter using
   existing wire effects.
3. Update group skill guidance, durable owner docs, and focused tests.
4. Run focused verification and direct route-matrix proof.
5. Publish a review candidate, complete the required review/CI gates, close the
   plan through the scoped commit path, and replace PR #1064.

## Decisions

- Keep one model-facing `offer_access` action while retaining the two existing
  internal Web actions. This is an adapter/facade change, not a new service or
  state owner.
- Treat scheduled execution as link presentation until the durable scheduled
  route records a trustworthy Linq service subtype.
- Treat every authoritative non-direct Linq candidate as part of one route
  proof. Any unsupported service, malformed authority, or disagreement makes
  the whole operation unbound instead of allowing a valid neighboring event to
  supply provider capabilities.
- Treat `presentation="native"` as an opaque handled native path. It does not
  prove that consent UI was newly posted or is currently visible; scheduled
  offers are explicitly link-only.

## Review dispositions

- The preliminary completion-specialist review returned findings. Accepted and
  corrected:
  - mixed supported/unsupported or missing-service Linq contexts now fail
    closed as one authoritative set;
  - prompt and skill guidance no longer equates a native result with visible or
    newly posted UI, and the scheduled tool contract is link-only;
  - the engine now has a regression seam proving that its default native wire
    request can receive a host-selected link response and return the exact link
    to the model;
  - a production-operation-scope scenario now proves current accepted iMessage,
    SMS, Telegram, and mixed SMS/RCS routing through the Web port boundary.
- The specialist's stale-test finding was already resolved on the prior pushed
  head. Its optional coverage patch was not applied: the stale assertions were
  corrected independently, and the missing seams were implemented directly
  against the corrected current head.
- Parent product-experience revalidation after the behavior corrections:
  `NO FINDINGS`. The irreducible purpose is one explicit group-access request
  that reaches the safest supported consent surface without provider-specific
  model branching. The implementation keeps that experience to one semantic
  action, the existing native or link surface, no extra confirmation, and a
  truthful unavailable result when route proof is incomplete.
- Parent final review after preliminary remediation: `NO FINDINGS`. The full
  diff and model parser -> engine adapter -> operation-scoped route selector ->
  existing Web port call paths were re-read. The final route resolver admits a
  supported route only when every authoritative non-direct candidate is
  complete and agrees; direct candidates remain outside group authority.
  Scheduled execution has one link-only branch, and the engine accepts either
  existing internal response while exposing only the semantic result.
- Residual validation is deliberately operational rather than architectural:
  exact-head CI and final ReviewGPT remain PR gates after this plan-closing
  commit, followed by provider spot checks after deployment. No live-provider
  credential or production mutation is required for the local direct scenario.

## Verification

- Commands to run: focused Vitest files for assistant-engine and
  assistant-runtime, package typechecks, `pnpm docs:drift`, required PR CI,
  preliminary `completion-specialists`, product-experience review, and final
  ReviewGPT.
- Expected outcomes: the route matrix and unsupported-effect matrix pass,
  package types remain sound, durable docs stay indexed, CI is green, and all
  accepted audit findings are resolved.
- Focused local proof before and after reconciling with `origin/main`:
  - `pnpm --dir packages/assistant-engine typecheck`
  - focused assistant-engine Vitest files: 125 tests passed
  - `pnpm --dir packages/assistant-runtime typecheck`
  - focused assistant-runtime Vitest files: 287 tests passed
  - `pnpm docs:drift`
  - `git diff --check`
- Preliminary-remediation proof:
  - assistant-engine typecheck passed;
  - five focused assistant-engine files passed, 212 tests total;
  - assistant-runtime typecheck passed;
  - the focused Linq context file passed, 25 tests total;
  - the production operation-scope route scenario passed;
  - corrected route cases include iMessage+SMS, iMessage+RCS, SMS+RCS,
    SMS+missing-service, and SMS+unknown-direction authority sets.
- Complete initial provider-input measurement used the pinned Codex App Server,
  the repository's scripted Responses endpoint, model `gpt-5.6-terra` with low
  reasoning in code mode, identical synthetic direct/group Linq turns, and the
  `o200k_harmony` tokenizer. It counted the serialized `input`, `tool_choice`,
  `parallel_tool_calls`, `include`, and `text` fields after normalizing local
  paths, and excluded transport/cache/account metadata identically on both
  heads.
  - Direct: 108,141 bytes / 23,503 tokens on base; 108,510 bytes / 23,566
    tokens on the candidate; delta +369 bytes (+0.34%) / +63 tokens (+0.27%).
  - Group: 94,850 bytes / 20,634 tokens on base; 95,219 bytes / 20,697 tokens
    on the candidate; delta +369 bytes (+0.39%) / +63 tokens (+0.31%).
Completed: 2026-07-30
