# Route estimate privacy, hiking coverage, and ownership cleanup

Status: completed
Created: 2026-04-10
Updated: 2026-04-10

## Goal

- Make `vault-cli route estimate` more accurate for hills and hiking POIs, prevent route arguments from leaking through assistant `vault.cli.run` argv echoes, and move the Mapbox routing implementation onto the CLI-owned surface the assistant already calls.

## Success criteria

- Elevation queries inspect all returned contour `ele` values and use the highest numeric elevation at each sample point.
- Assistant `vault.cli.run` argv output redacts `route estimate` origin, destination, and repeated `--waypoint` values while preserving non-sensitive flags.
- Route estimation supports a clean temporary-use POI fallback for hiking-style trailhead and hut queries without persisting lookup payloads.
- Walking profile geocoding prefers an entrance routable point when Mapbox returns one.
- Focused tests cover coordinate-literal bypass, contour max selection, default geometry omission, route argv redaction, and no-result lookup failures.
- Architecture/help/docs stay aligned with CLI ownership and the temporary non-persistent privacy posture.

## Scope

- In scope:
- `packages/cli` route-estimation owner code, command wiring, and focused tests
- assistant CLI argv redaction for `vault.cli.run`
- small doc/help/architecture updates required by the ownership or lookup-shape change
- Out of scope:
- unrelated hosted-web worktree edits already present in the branch
- broader search-provider abstractions beyond the Mapbox-specific route-estimation path
- live network/manual Mapbox validation beyond mocked direct-proof checks

## Constraints

- Technical constraints:
- Keep route inputs/outputs non-persistent and token-in-env only.
- Do not introduce a generic routing abstraction without a real second backend.
- Preserve clean workspace package boundaries; the assistant should shell into the CLI rather than own route logic directly.
- Product/process constraints:
- Follow the high-risk repo workflow: focused implementation, required verification, coverage-write audit, final review, and scoped commit.
- Preserve overlapping edits in assistant/CLI/shared packages.

## Risks and mitigations

1. Risk: moving the route helper across package ownership can break imports or tests outside the route command.
   Mitigation: search for all current imports first, keep the surface narrow, and re-run CLI and assistant-owner coverage after the move.
2. Risk: hiking fallback broadens the external lookup surface and could blur the privacy posture.
   Mitigation: keep both Geocoding and Search Box requests temporary-use only, avoid persistence, and reflect the temporary posture in the result metadata/help text.
3. Risk: argv redaction could over-redact unrelated CLI commands.
   Mitigation: use a command-specific rule keyed to `route estimate` tokens and add focused unit coverage for positional args plus repeated `--waypoint`.

## Tasks

1. Move Mapbox route-estimation ownership into `packages/cli` and rewire the route command to the new owner module.
2. Improve point resolution for hiking and walking: Search Box fallback for POI-like misses, entrance preference for walking, and contour max-elevation sampling.
3. Harden assistant CLI argv redaction specifically for `route estimate`.
4. Add focused route/redaction tests and align docs/help/architecture text.
5. Run required verification, audit passes, and finish with a scoped commit.

## Decisions

- Keep one Mapbox-specific implementation owned by the CLI package; no generic routing abstraction in this change.
- Use Mapbox Search Box only for the narrow walking + POI-like lane; do not broaden it into a general second-pass resolver for all text misses.
- Assistant-side argv redaction must survive leading global CLI flags such as `--verbose` and `--schema`.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test:diff packages/cli packages/assistant-engine`
- If diff coverage is not truthful enough after the ownership move, fall back to `pnpm --dir packages/cli verify:coverage` and `pnpm --dir packages/assistant-engine test:coverage`
- Expected outcomes:
- Green typecheck and coverage-bearing route/redaction tests for the touched owners, plus direct mocked scenario proof through the new unit tests.

## Outcome

- `pnpm typecheck` passed after implementation and after post-audit fixes.
- `pnpm test:diff packages/cli packages/assistant-engine` passed once after the main implementation landed.
- After the audit-driven route/redaction follow-up fixes, targeted proof passed again:
  - `pnpm exec vitest run packages/cli/test/mapbox-route.test.ts --config packages/cli/vitest.workspace.ts`
  - `pnpm --dir packages/assistant-engine exec vitest run test/assistant-cli-policy-wrappers.test.ts --config vitest.config.ts`
- A later rerun of `pnpm test:diff packages/cli packages/assistant-engine` was blocked by an unrelated overlapping dirty change in `packages/cli/src/vault-cli.ts`, which now fails `packages/cli/test/runner-vault-cli.test.ts`. That file is outside this route-estimation change set.
Completed: 2026-04-10
