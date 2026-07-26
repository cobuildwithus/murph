# Privacy-preserving iOS contact discovery

Status: active
Created: 2026-07-26
Updated: 2026-07-26

## Goal

- Let an authenticated member optionally share phone contacts from the Murph
  iOS onboarding so Murph can render familiar names for otherwise-unregistered
  participants in that member's iMessage groups without making uploaded phone
  numbers recoverable from the hosted database.

## Success criteria

- The iOS app explains the benefit and privacy boundary before the native
  Contacts permission prompt, supports an explicit skip, uploads only selected
  normalized phone/name projections, caps each projection at 512 rows, and can
  revision-safely replace or delete the member's
  prior projection.
- `apps/web` owns a bounded authenticated companion contract, stores only
  member-scoped keyed phone lookups plus protected display-name content, and
  exposes no roster or cross-member contact-query API.
- Group participant rendering resolves a transient current-turn phone handle
  against only the callback member's uploaded projection and never grants
  membership, identity, consent, delivery, or health-sharing authority.
- A database snapshot plus ordinary application encryption material is
  insufficient to recover uploaded phone numbers.
- Both repos include focused success, retry, replacement, deletion, ambiguity,
  privacy, and permission-state tests plus durable architecture/product docs.
- Both repos complete their required verification, product review, pushed-head
  ReviewGPT gates, linked PRs, and deploy-order proof.

## Scope

- In scope:
  - Optional iOS onboarding and Settings contact-sharing controls.
  - A versioned companion contact-projection API in `apps/web`.
  - Member-scoped privacy-preserving contact storage and lifecycle.
  - Familiar-name projection for current unregistered group participants.
- Out of scope:
  - Messaging uploaded contacts, invitations, address-book search, social graph
    ranking, analytics, email/address/photo/birthday/note upload, and contact
    discovery across members.
  - Treating contact names or phone matches as verified identity, membership,
    consent, sharing authority, or canonical profile truth.
  - Signup-time name suggestions or any global reverse lookup across members.
  - Bespoke cryptographic services or new third-party dependencies.

## Constraints

- Technical constraints:
  - Reuse secure-box/private-field patterns, Privy companion authentication,
    group current-turn handles, and existing iOS Core
    boundary/composition-root patterns.
  - Phone-number lookup material must be domain-separated and server-keyed;
    display names must be bounded and protected before first durable write.
  - Upload and lookup work must be set-based, cardinality-bounded, replaceable,
    deletable, and excluded from assistant/runtime state and logs.
  - No new dependency, queue, cache, background sync owner, or generalized
    address-book service.
- Product/process constraints:
  - Explicit optional consent; skipping cannot block onboarding or health sync.
  - The permission step must explain the concrete group-name dividend and the
    smallest honest privacy claim.
  - Use isolated branches and linked PRs in `murph` and `murph-ios`.
  - ReviewGPT architecture guidance precedes schema/API implementation.

## Risks and mitigations

1. Risk: Low-entropy phone numbers remain vulnerable to offline dictionary
   attacks if stored with ordinary hashes or the existing application-global
   contact blind index.
   Mitigation: use a dedicated non-exportable Cloud KMS MAC key to derive
   request-local, member-scoped, domain-separated lookup keys; never persist
   reversible uploaded phone content or the derived member seed.
2. Risk: Contact labels are mistaken for verified identity or leak across
   members.
   Mitigation: treat them as member-scoped advisory display projections,
   resolve only through a bound viewer/current-turn context, and keep every
   authority decision on existing verified owners.
3. Risk: Full-address-book upload grows without bound or becomes stale.
   Mitigation: strict request/row/name/phone caps, whole-generation replacement,
   explicit deletion, and one current generation per member.
4. Risk: Cross-repo deployment skew breaks onboarding.
   Mitigation: additive backend first, iOS last, fail-soft skip/retry UX, and a
   linked counterpart contract in both PRs.

## Tasks

1. Inspect current owners and ask ReviewGPT for the smallest cross-repo design.
2. Record the accepted product, privacy, authority, lifecycle, and deploy
   contracts in both repos.
3. Implement and test the backend schema, private codecs, companion API, and
   bounded advisory group-name resolution.
4. Implement and test the optional native Contacts onboarding/Settings flow.
5. Run canonical verification and direct scenario evidence in both repos.
6. Complete product-experience, preliminary specialist, parent-final, and final
   ReviewGPT gates; open linked PRs and resolve findings/CI.

## Decisions

- Uploaded contact data is a hosted Web-owned member projection, never vault or
  assistant runtime state.
- Uploaded contact labels are advisory display data only. They cannot confer
  identity, membership, consent, routing, or delivery authority.
- The first release consults only the human group owner's projection, and only
  for current unregistered phone handles in an already-authorized live group
  roster. It performs no cross-member or signup lookup.
- Phone tokens use request-local per-member keys derived through a dedicated
  non-exportable Cloud KMS MAC key. Names use the existing hosted member
  private-field secure-box lane. This protects phone values from a database
  plus ordinary content-key compromise, but is not zero knowledge: a live
  application process or an actor with both database and MAC authority can
  still test guesses.
- Projection mutations use one revisioned full replacement or deletion with a
  replay-safe mutation ID. The server retains disabled tombstones, deletes
  child rows on stop-sharing, and expires enabled projections after 120 days.
- Existing provider/session/workspace retention can contain a current group
  handle paired with an advisory label after the label is used. Advisory output
  remains independently feature-gated pending the required privacy/retention
  review; projection replacement and deletion stay available.
- The current meal-photo setup screen is unavailable on deployment-target iOS
  versions below 26.1. Fresh onboarding therefore places optional contact
  sharing after Health and before meal-photo capture so the contact choice is
  reachable without changing the persisted step for existing users.

## Verification

- Commands to run:
  - `pnpm verify:acceptance`
  - Focused hosted-web route, privacy-codec, storage, deletion, group-resolution,
    and migration tests.
  - `xcodegen generate`
  - `swiftformat --lint .`
  - `xcodebuild test` on an available iOS simulator.
  - Physical-device Contacts permission/upload/replace/delete proof, or an
    explicit hardware gap if this environment cannot provide it.
- Expected outcomes:
  - All automated checks pass with no private contact values in logs, fixtures,
    generated artifacts, review packets, or screenshots.
  - The exact additive backend head is deployable before the linked iOS head.
