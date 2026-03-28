# Registry Entity Rollout

## Goal

Port Condition, Allergy, Family, and Genetics onto the shared registry entity definition seam already proven by Goal so contracts, core, query, and CLI stop re-describing the same per-family metadata and document semantics.

Success criteria:

- one shared definition per family owns the registry schema, patch/create payload schema where needed, storage directory, id and slug behavior, relation metadata, sort behavior, command metadata, and query projection metadata
- core read/write logic for these four families consumes the shared definitions instead of carrying hidden family-specific parser or serializer drift where the behavior is mechanical
- query registry projection logic and CLI descriptor/runtime wiring consume the same shared definitions for these families
- existing storage layout and intended write semantics stay intact; no new persistence model is introduced

## Scope

- `packages/contracts/src/{health-entities.ts,shares.ts,zod.ts,examples.ts,schemas.ts}` as needed
- `packages/core/src/{bank/{conditions,allergies,types}.ts,family/{api,types}.ts,genetics/{api,types}.ts,index.ts,public-mutations.ts}`
- targeted `packages/core/test/*`
- `packages/query/src/{canonical-entities.ts,health/{allergies,canonical-collector,conditions,family,genetics,registries}.ts,index.ts}`
- targeted `packages/query/test/*`
- `packages/cli/src/{health-cli-descriptors.ts,health-cli-method-types.ts,usecases/explicit-health-family-services.ts,assistant-cli-tools.ts}`
- targeted `packages/cli/test/*`
- docs only if the landed seam changes the documented ownership story

## Constraints

- Keep the existing markdown plus JSONL storage model.
- Follow the greenfield hard-cut posture for schema reads unless an explicit compatibility exception is chosen deliberately.
- Preserve exact partial-update semantics where the CLI/core write surfaces already behave like patch rather than replace.
- Limit shared abstractions to the four families plus immediately reusable helpers that earn their keep now.
- Run the required verification and mandatory completion-workflow audit passes before handoff.

## Risks

- Turning the shared abstraction into an over-generalized framework instead of a thin mechanical seam.
- Creating overlapping edits in central files (`health-entities.ts`, `registries.ts`, CLI descriptors/services) while multiple agents work in parallel.
- Missing family-specific quirks in core/write semantics and silently changing behavior under a shared definition.

## Verification

- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- focused family-specific package tests during iteration
- direct read/write scenarios proving descriptor-driven CLI/core paths for the migrated families

## Outcome

- Condition, Allergy, Family, and Genetics all now consume shared registry metadata across contracts, core, query, and CLI.
- Core now carries normalized internal links for all four families, while preserving the existing markdown plus JSONL storage model and patch-style upsert semantics.
- Focused verification is green for the rollout surface.
- Mandatory completion-workflow audit subagents were attempted, but the environment hit the active thread limit and then the wrapper behaved inconsistently after the stale workers were cleared. Those dedicated passes should be rerun from a clean worker pool if strict proof is required.
- Repo-wide checks remain partially red outside this lane:
  - `pnpm typecheck`: existing `packages/contracts/scripts/verify.ts` module-resolution and implicit-any failures
  - `pnpm --dir packages/cli typecheck`: existing assistant test typing failures
  - `pnpm test` / `pnpm test:coverage`: existing `apps/web/src/lib/hosted-execution/hydration.ts:267` type error after the web/app test stack
Status: completed
Updated: 2026-03-29
Completed: 2026-03-29
