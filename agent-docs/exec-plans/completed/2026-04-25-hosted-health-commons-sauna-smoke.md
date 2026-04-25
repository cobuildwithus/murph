# Add hosted Health Commons sauna smoke diagnostics

Status: completed
Created: 2026-04-25
Updated: 2026-04-25

## Goal

- Make Health Commons sauna lookup failures diagnosable across the hosted runner runtime import path, the hosted runner CLI path, and assistant-bound Health Commons tools.

## Success criteria

- Hosted runner smoke asserts Finnish Dry Sauna is present through `@murphai/health-commons/runtime`, `reader.search`, `reader.listProtocolVariants`, `vault-cli commons search`, and `vault-cli commons protocol list`.
- Health Commons assistant-bound tool results include compact catalog diagnostics, including catalog hash and Finnish Dry Sauna presence.
- Assistant-bound tool regression coverage proves `healthCommons.search` and `healthCommons.listProtocols` find Finnish Dry Sauna.
- The active `includeBody` search parity lane is left untouched.

## Scope

- In scope:
  - `apps/cloudflare` hosted runner smoke child/result contract coverage for the sauna sentinel.
  - `packages/assistant-engine` Health Commons tool diagnostics and direct bound-tool tests.
  - A workspace dependency declaration for the hosted runner app's direct Health Commons runtime import.
- Out of scope:
  - Adding `includeBody: true` to bound Health Commons search/list behavior.
  - Health Commons content or generated catalog changes.
  - Live Cloudflare deploy verification.

## Constraints

- Technical constraints:
  - Do not expose local account names, home paths, secrets, raw identifiers, or private vault data in new diagnostics.
  - Preserve existing runner environment rebinding and parser smoke behavior.
  - Keep diagnostics read-only and derived from the public Health Commons catalog reader.
- Product/process constraints:
  - Coordinate around the active Health Commons search parity ledger row by avoiding its `includeBody` edit.
  - Run focused tests/typecheck where possible, plus required review/audit passes before handoff.

## Risks and mitigations

1. Risk: Assistant diagnostics grow tool payloads too much.
   Mitigation: Return only compact counts, catalog hash, and the sauna sentinel title/null.
2. Risk: Hosted runner smoke starts leaking restored local paths beyond existing smoke fields.
   Mitigation: Add only catalog/hash/count/byte-count proof; do not add workspace path diagnostics.
3. Risk: Overlap with the active `includeBody` parity lane.
   Mitigation: Keep this change additive and avoid reader search option changes owned by that lane.

## Tasks

1. Inspect existing hosted runner smoke and assistant-bound Health Commons tool seams.
2. Add runner runtime/CLI sauna smoke checks and result contract fields.
3. Add assistant Health Commons diagnostics to all tool result shapes.
4. Add direct assistant-bound regression tests for the Finnish Dry Sauna sentinel.
5. Run focused verification and mandatory completion audits.

## Decisions

- Use Finnish Dry Sauna as the sentinel key: `protocol_variant:dry-sauna/murph-finnish-standard-3x-week`.
- Do not implement the `includeBody` parity patch in this task because another active lane owns it.

## Verification

- Commands to run:
  - Focused assistant-engine Health Commons bound-tool test.
  - Focused Cloudflare hosted runner smoke contract/test lane if available, otherwise app-local Cloudflare test slice.
  - `pnpm typecheck` unless blocked by unrelated dirty-tree failures.
- Expected outcomes:
  - Bound tools and hosted smoke contract compile and tests pass, or blockers are recorded with ownership.
Completed: 2026-04-25
