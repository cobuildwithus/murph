# Cloudflare hosted side-effects outbox

## Goal

Broaden the current hosted assistant-only post-commit outbox into a generic committed side-effect contract so hosted one-shot runs can durably record outbound actions with the committed bundles, then resume sending those actions without rerunning the compute stage.

## Scope

- Add a generic hosted side-effect type and committed-journal field, with assistant delivery as the first concrete effect kind.
- Collect due hosted side effects before the durable commit, then drain them after commit through a generic sender/journal path.
- Teach the Durable Object retry path to resume from the committed side-effect journal instead of re-executing the original hosted event when the compute stage already committed successfully.
- Update Cloudflare and assistant-runtime docs/tests so the broader hosted outbox rule is explicit and truthful.

## Constraints

- Keep the current hosted execution dispatch/event payloads stable.
- Preserve the existing assistant outbox files and local CLI behavior; this follow-up only changes the hosted post-commit contract.
- Preserve adjacent in-flight Cloudflare/assistant-runtime refactors in the dirty worktree.
- Do not claim that upstream transports are fully exactly-once; keep the residual “send succeeded but sent-marker write back failed” edge explicit.

## Risks and mitigations

1. Risk: post-commit retry logic could still rerun compute if the committed-vs-finalized distinction stays implicit.
   Mitigation: persist side effects directly on the committed journal record and add an explicit committed-resume path in the hosted runner.
2. Risk: assistant delivery could regress if the new generic sender loses the current dedupe reconciliation hooks.
   Mitigation: keep assistant delivery on the existing assistant outbox intent files and dispatch path, but route reconciliation through the new generic side-effect journal.
3. Risk: route and journal renames could break the in-flight Cloudflare container plumbing.
   Mitigation: keep the change additive where practical, preserve the current internal auth model, and add direct route-level tests for the new generic side-effect handler.

## Verification

- Direct Cloudflare/runtime tests for committed side-effect collection, journal reconciliation, and committed-resume retries.
- Required repo commands: `pnpm typecheck`, `pnpm test`, `pnpm test:coverage`
- Required completion workflow audit passes: `simplify`, `task-finish-review` (the final review also checks coverage/proof gaps)
