# Hosted assistant late conversation input adoption

Status: completed
Created: 2026-04-23
Updated: 2026-04-23

## Goal

- Hosted Cloudflare assistant replies should be able to incorporate same-conversation messages that arrive while the active hosted run is still thinking, using the existing `AssistantTurnInputPort` revision primitive rather than adding hosted conversation state.

## Success criteria

- Web exposes narrow active-run turn-input peek/adopt callbacks for pending contiguous hosted `conversation.message` ingress.
- Cloudflare can decrypt, validate, and adopt only the contiguous late conversation prefix for the active run.
- Hosted assistant runtime imports adopted late conversation wakes into the local inbox before assistant-engine checks for late same-conversation captures.
- Hosted run commit uses the web-owned run projection after late adoption so commit validation accepts newly adopted event ids.
- Focused contract, web-store, Cloudflare, and assistant-runtime tests cover the new seams.

## Scope

- In scope:
- Shared hosted run turn-input contracts and parsers.
- `apps/web` internal hosted-run turn-input routes and store helpers.
- Cloudflare runner outbound/results/runtime-platform bridge for late conversation input.
- `packages/assistant-runtime` hosted turn-input adapter and automation wiring.
- Focused tests for contracts/store/adapter/commit merge behavior.
- Out of scope:
- New hosted conversation tables, debounce queues, or database-level same-conversation logic.
- Moving turn semantics out of `packages/assistant-engine`.
- Broad hosted-run protocol rewrites or changing non-conversation ingress ordering semantics.

## Constraints

- Technical constraints:
- `apps/web` remains the canonical owner of hosted ingress rows and hosted run state.
- Cloudflare may only adopt/decrypt/import late input; it must not decide same-conversation revision.
- Adopted ingress must stay contiguous and active-run-scoped.
- Product/process constraints:
- Preserve unrelated dirty-tree work, especially the active Cloudflare deploy workflow lane.
- Do not print or persist secrets, local usernames, home paths, or raw personal identifiers.

## Risks and mitigations

1. Risk: Adopt cursor advances past a non-conversation event and starves the next run.
   Mitigation: Cloudflare adopts only the validated contiguous conversation prefix; if the first candidate is not adoptable, no adopt call is made.
2. Risk: Commit fails because active-run projections are stale after late adoption.
   Mitigation: Cloudflare re-reads hosted run status before commit and merges adopted ids/seq into the commit payload.
3. Risk: Hosted runtime duplicates inbox captures on repeated refresh.
   Mitigation: Imported captures remain idempotent through the existing inbox external-id dedupe path; the adapter tracks imported ingress ids for the current process.

## Tasks

1. Add shared turn-input peek/adopt contracts and parsers.
2. Add web store helpers/routes for active-run late input peek/adopt.
3. Add Cloudflare runner late-input bridge and web-control-plane helpers.
4. Add hosted runtime turn-input adapter and pass it into assistant automation.
5. Adjust commit payload construction after late adoption.
6. Add focused tests and run required verification/audits.

## Decisions

- Keep `AssistantTurnInputPort` as the one real turn-steering primitive.
- Keep hosted late input as a thin adopt/decrypt/import adapter; no hosted conversation model or debounce layer.

## Verification

- Passed:
- `pnpm --dir packages/hosted-execution run --if-present typecheck`
- `pnpm --dir packages/assistant-runtime run --if-present typecheck`
- `pnpm --dir apps/cloudflare run --if-present typecheck`
- `pnpm --dir apps/web run --if-present typecheck`
- Focused Vitest coverage for hosted-execution parsers, web hosted-run store, Cloudflare runtime platform, assistant-runtime maintenance, and Cloudflare resume-finalize commit refresh behavior.
- `bash scripts/workspace-verify.sh test:diff <touched paths>` passed end to end, including `apps/cloudflare verify` and `apps/web verify`.
- Required `coverage-write` audit completed with no required changes.
- Required `task-finish-review` found two fail-open paths; both were fixed, regression-tested, and the follow-up review had no blocking findings.
Completed: 2026-04-23
