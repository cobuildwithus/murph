# Hardening hosted email reply routing

Status: completed
Created: 2026-04-03
Updated: 2026-04-03

## Goal

- Land the returned hosted-email hardening patch intent in the live repo so Cloudflare-hosted email aliases are routing hints rather than authority, new outbound sends reuse one stable per-user reply alias, legacy per-thread aliases remain readable during cutover, and hosted runtime preserves the matched self-address for reply correlation.

## Success criteria

- Hosted email ingress authorizes only the verified owner by default unless a lower-sensitivity route explicitly opts into thread participants.
- New outbound hosted email sends no longer mint fresh per-thread route records and emit the stable reply alias in both `Reply-To` and the signed routing header.
- Legacy per-thread alias records still resolve for inbound mail during the transition.
- Hosted execution dispatch and hosted runtime ingestion preserve the matched self-address so normalized email captures retain the routed alias as self context.
- Repo-required verification is attempted; environment-specific blockers are recorded separately only when they are demonstrably unrelated to the landed diff.

## Scope

- In scope:
- `apps/cloudflare` hosted email routing, transport, worker ingress, targeted tests, and surfaced docs
- `packages/runtime-state`, `packages/hosted-execution`, and `packages/assistant-runtime` hosted-email contract/runtime changes needed by the patch
- Durable docs that describe the hosted email trust-boundary change
- Out of scope:
- Reintroducing participant replies by default
- Broader hosted email product redesign beyond the returned patch
- Unrelated dirty-tree work such as `apps/web/app/page.tsx`

## Constraints

- Technical constraints:
- Preserve legacy thread-route reads during cutover even though new sends stop writing them.
- Keep the change scoped to the returned patch intent and avoid unrelated refactors.
- Do not disturb unrelated dirty worktree edits.
- Product/process constraints:
- Follow the repo completion workflow for a high-risk multi-file trust-boundary change.
- Keep docs aligned with the changed hosted-email security posture.

## Risks and mitigations

1. Risk: owner-only authorization could break reply flows if the stable alias or verified-email lookup is wrong.
   Mitigation: add focused routing/transport tests plus targeted worker ingress tests and preserve legacy alias reads.
2. Risk: dispatch/runtime changes could regress email normalization by losing self-address context.
   Mitigation: extend the hosted execution dispatch contract and add focused dispatch/runtime-state tests.
3. Risk: repo-wide verification can be blocked by sandbox restrictions unrelated to the diff.
   Mitigation: rerun required commands after plan creation, record exact blockers, and add focused package/app proofs on the touched surface.

## Tasks

1. Port the returned hosted-email patch intent into the current repo state without overwriting unrelated edits.
2. Update focused tests and durable docs to reflect the new alias and authorization behavior.
3. Run repo-required verification plus focused hosted-email proofs, then resolve any code issues or document unrelated blockers.
4. Complete the required final review/commit workflow for the plan-bearing task.

## Decisions

- New outbound hosted email sends now reuse the stable per-user reply alias created by `createHostedEmailUserAddress` instead of minting new per-thread aliases.
- Inbound routing now accepts either the visible recipient address or the `X-Murph-Route` header so replies keep working when MTAs rewrite the delivered `To` address.
- Owner-only authorization is the default. Thread participants remain available only as an explicit future opt-in path rather than the current default.
- Legacy thread-route records remain readable so previously issued aliases still work during cutover.

## Verification

- Commands to run:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused fallback proof when repo-wide commands are sandbox-blocked:
- `pnpm --dir packages/runtime-state typecheck`
- `pnpm --dir packages/runtime-state test`
- `pnpm --dir packages/hosted-execution typecheck`
- `pnpm --dir packages/hosted-execution test`
- `pnpm --dir packages/assistant-runtime typecheck`
- `pnpm --dir apps/cloudflare typecheck`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/hosted-email.test.ts apps/cloudflare/test/index.test.ts --no-coverage`
- Expected outcomes:
- Repo-wide commands pass, or any failures are clearly unrelated environment blockers.
- Focused hosted-email package/app proofs pass on the touched surface.
Completed: 2026-04-03
