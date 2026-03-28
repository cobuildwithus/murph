# Hosted share links for foods + attached supplements

Status: completed
Created: 2026-03-26
Updated: 2026-03-28

## Goal

- Add a clean hosted share-link flow that can copy a remembered food plus its attached supplement/protocol entities into another hosted vault, optionally through the existing invite/onboarding lane.

## Success criteria

- A typed portable share-pack contract exists in `packages/contracts` and is reused by the new share flow.
- Food records can explicitly reference attached protocol records so a smoothie can carry its supplement powders as a first-class bundle.
- `packages/core` can export a share pack from existing food/recipe/protocol records and import that pack into another vault while remapping local ids.
- `apps/web` can mint one-time opaque share links, optionally create/reuse a hosted invite for a recipient phone number, preview the bundle, and accept it for an active hosted member.
- `apps/cloudflare` can apply accepted share packs during hosted execution.
- The assistant tool surface can issue a hosted share link so the flow can be driven from assistant/iMessage contexts when the hosted control-plane env is configured.

## Scope

- In scope:
  - shared contracts and generated schemas for share payloads/share packs
  - food attached-protocol linkage
  - core export/import helpers for share packs
  - hosted share-link persistence plus preview/accept/internal-create routes in `apps/web`
  - hosted execution support for share acceptance
  - assistant tool support for issuing links
  - focused tests/docs for the new flow
- Out of scope:
  - real-time shared mutable objects across vaults
  - browser UI for composing share packs by clicking through a catalog of saved entities

## Constraints

- Keep links opaque and one-time use; do not place raw share payload JSON in URLs.
- Preserve local-first semantics by copying records into the recipient vault instead of creating live shared ownership.
- Preserve the existing hosted invite -> passkey -> checkout path.
- Make the food -> supplement bundle explicit through first-class linkage rather than ingredient-text guessing.

## Tasks

1. Add shared share-pack/portable payload contracts and wire them into the contracts schema catalog.
2. Add explicit attached protocol ids on foods and reuse that linkage in the share export/import helpers.
3. Add hosted share-link persistence plus preview/accept/internal-create routes in `apps/web`.
4. Thread `share` through the join/checkout flow and add a public `/share/[shareCode]` landing page.
5. Add `vault.share.accepted` hosted execution handling in Cloudflare and the assistant tool for issuing links.
6. Add focused tests and update docs for the new share flow.

## Verification

- Focused package/app tests for contracts/core/apps-web/apps-cloudflare/assistant-tooling where practical.
- Required repo checks remain `pnpm typecheck`, `pnpm test`, and `pnpm test:coverage` when the full workspace is available.
- Implemented in this turn with passing focused share-path tests for core and hosted web, including the invited-share URL regression, share-pack ref-kind validation, copy-safe import collision coverage, and retry-safe hosted share acceptance coverage.
- `pnpm typecheck` is currently blocked by an unrelated pre-existing `packages/core/src/vault-metadata.ts` mismatch (`workoutFormatsRoot` missing from the tracked metadata shape) outside this hosted-share slice.
- `pnpm test` and `pnpm test:coverage` are currently blocked before the workspace test suites by an unrelated pre-existing `packages/contracts/generated/audit-record.schema.json` drift (`workout_format_upsert` missing from the generated enum) outside this hosted-share slice.
Completed: 2026-03-28
