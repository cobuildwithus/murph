# Hosted automation default enablement

Status: completed
Created: 2026-03-31
Updated: 2026-03-31

## Goal

Make hosted assistant automation run by default instead of requiring the explicit `HOSTED_EXECUTION_ENABLE_ASSISTANT_AUTOMATION` gate, while preserving the existing hosted execution boundaries and deterministic hosted work.

## Scope

- remove or invert the explicit hosted automation enablement gate in the hosted runtime path
- keep hosted activation bootstrap and hosted maintenance behavior aligned with the new default
- update focused tests and docs so the hosted behavior is explicit and truthful

## Non-goals

- changing hosted provider/model selection beyond whatever the existing assistant resolution already does
- changing the broader Cloudflare worker/container trust boundary or per-user env model
- introducing a new hosted assistant configuration bootstrap path unless the existing behavior forces it

## Files

- `packages/assistant-runtime/src/hosted-runtime/{context,environment,maintenance}.ts`
- `packages/assistant-runtime/test/*.test.ts` as needed for direct hosted runtime proof
- `apps/cloudflare/test/node-runner.test.ts`
- hosted runtime/Cloudflare docs touched by the behavior change

## Verification

- focused hosted runtime and Cloudflare tests while iterating
- required repo checks before handoff:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm test:coverage`
- required completion-workflow audits after functional verification:
  - `simplify`
  - `task-finish-review`

## Notes

- Preserve unrelated dirty work already present in `.gitignore`, `pnpm-lock.yaml`, `apps/cloudflare/wrangler.jsonc`, and the `packages/cli/src/gateway/**` lane.
- Keep the change proportional: prefer flipping the hosted default and updating truthfulness/tests over adding a second hosted config bootstrap mechanism.
Completed: 2026-03-31
