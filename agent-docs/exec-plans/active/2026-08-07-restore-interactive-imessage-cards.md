# restore-interactive-imessage-cards

Status: active
Created: 2026-08-07
Updated: 2026-08-07

## Goal

- Restore the shipping Messages extension as the transcript renderer for Murph
  nutrition and compact-table cards so installed recipients see the designed
  SwiftUI cards instead of Linq's generic static caption layout.

## Success criteria

- Linq app-card requests explicitly select interactive rendering.
- Every current card kind carries its immutable presentation snapshot in the
  existing bounded HTTPS fragment understood by the shipping iOS decoder.
- The provider-owned static layout remains a truthful fallback for recipients
  without the Messages extension.
- Focused tests prove the exact Linq payload, nutrition V1/V2 envelope, compact
  table envelope, URL bound, and hosted egress handoff.
- Physical-device proof confirms one nutrition card and one compact table are
  visible in the transcript without a compensating text send.

## Scope

- In scope: operator-config app-card URL/presentation construction, focused
  provider and hosted-runtime tests, and current architecture/reliability docs.
- Out of scope: changing the iOS card views, adding remote card state, or
  changing outbox, capability, retry, fallback, or message authority ownership.

## Constraints

- Technical constraints: preserve the existing HTTPS-only Linq contract,
  2,048-character URL ceiling, offline decoder, and authority-free fragments.
- Product/process constraints: treat the prior invisible interactive balloon
  as a release risk and require real Messages proof before production rollout.

## Risks and mitigations

1. Risk: Interactive mode can reproduce the previously observed invisible
   transcript balloon.
   Mitigation: keep the static layout fallback, prove exact provider identity
   and URL shape locally, and gate rollout on a shipping physical-device send.
2. Risk: A URL without the nutrition snapshot would open the extension's
   unavailable view.
   Mitigation: encode V1 and V2 in the same strict HTTPS fragment family the
   shipping combined decoder already accepts for V3.

## Tasks

1. [x] Restore interactive Linq app-card requests and bounded nutrition URLs.
2. [x] Align exact request, cross-card, hosted egress, and journey coverage.
3. [x] Update current response-card ownership and rollout docs.
4. [x] Run focused verification and inspect the complete diff.
5. [ ] Push a PR candidate, complete required ReviewGPT/CI gates, and resolve
   every accepted finding.
6. [ ] Capture physical-device transcript proof and close the task plan.

## Decisions

- Keep explicit `interactive: true` rather than relying on Linq's default so
  the intended presentation cannot change through an omitted field.
- Reuse the existing HTTPS fragment decoder and envelope versions; do not add
  an iOS release or another payload format.

## Verification

- Passing local proof: the complete 284-test operator-config suite, eight
  hosted provider-egress tests, operator-config and Cloudflare typechecks, docs
  drift, and diff/privacy inspection. Exact V1/V2 TypeScript fixtures also pass
  31 focused shipping Swift decoder tests in the companion repository.
- Hosted-local journey gap: runner preparation cannot start the scenario. The
  final-head retry timed out after 60 seconds while generating the unrelated
  Assistant CLI surface manifest. A prior candidate reached the next gate,
  where the runner entrypoint was 12,937 bytes over its existing bundle-size
  budget; its exact base also failed and attributed only 476 bytes to this
  change. The exact-head CI run therefore remains the broad journey owner.
- Remaining proof: exact-head CI, both required ReviewGPT stages, and physical
  Messages sends showing the real custom transcript cards.

## Review disposition

- Both ReviewGPT stages accepted the already-declared physical-device rollout
  gate; no compensating text path or additional delivery machinery is valid.
- The specialist coverage finding was accepted and resolved with matching exact
  TypeScript fixtures plus shipping Swift V1/V2 decoder assertions in companion
  PR #56. No runtime iOS change was required.
