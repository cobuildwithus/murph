# Canonical iMessage card origin

Status: active
Created: 2026-08-09
Updated: 2026-08-09

## Goal

- Generate every new nutrition and compact-table iMessage card on Murph's
  canonical `https://www.withmurph.ai` origin.
- Preserve offline fragment decoding and existing outbox, provider fallback,
  and size-bound behavior.
- Coordinate with the companion app so cards already sent on the former origin
  remain readable.

## Root cause

- The card URL origin was a fixed operator-config constant rather than a
  runtime setting.
- The initial HTTPS card implementation used a non-product domain and pinned it
  into cross-platform fixtures and the companion decoder.

## Scope

- Operator-config URL generation and exact fixtures.
- Hosted-local provider handoff assertion.
- Current response-card architecture documentation.
- A counterpart companion-app PR that accepts both the canonical origin and the
  former origin retained for existing transcript cards.

## Constraints

- Add no card service, lookup, state owner, environment variable, or dependency.
- Keep the payload entirely in the URL fragment and below the existing limit.
- Do not deploy the backend origin switch before the companion compatibility
  release is available to intended recipients.

## Tasks

1. [ ] Land the companion compatibility decoder and focused tests.
2. [ ] Switch new backend card URLs and cross-platform fixtures.
3. [ ] Run focused TypeScript, Swift, typecheck, and diff/privacy proof.
4. [ ] Open linked PRs and complete their required review and CI gates.
