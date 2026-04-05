# 2026-04-05 Hosted Email Header Hardening

## Goal

Close the outbound hosted-email header-injection seam by rejecting header-break input in shared hosted-email normalizers, assembling MIME headers only from safe values, and dropping the unnecessary outbound `X-Murph-Route` alias leak.

## Scope

- `packages/runtime-state/src/hosted-email.ts`
- `packages/runtime-state/test/hosted-email.test.ts`
- `apps/cloudflare/src/hosted-email/transport.ts`
- `apps/cloudflare/test/hosted-email.test.ts`
- `apps/cloudflare/test/index.test.ts`

## Constraints

- Treat this as a high-risk hosted trust-boundary change.
- Preserve unrelated dirty-tree work already in flight.
- Keep inbound routing support intact unless a narrower safe alternative is required by the outbound fix.
- Prefer shared normalization/validation over ad hoc transport-only escaping so serialized thread targets and explicit recipients both lose header-break payloads.

## Plan

1. Register the hosted-email hardening lane and inspect the existing transport plus normalization behavior.
2. Tighten shared hosted-email normalization so CR/LF header breaks are rejected before thread targets or explicit send inputs can flow into MIME headers.
3. Update the Cloudflare outbound transport to build headers only from safe normalized values and stop emitting `X-Murph-Route`.
4. Add focused regression coverage for injected recipients/subjects/message ids and the outbound alias-leak removal.
5. Run required verification, complete the mandatory final review audit, then close the plan with a scoped commit.

## Progress

- Done: classified the task as a high-risk hosted-email trust-boundary fix, read the required repo workflow/security docs, and inspected the current transport/normalizer/test surfaces.
- Done: tightened shared hosted-email normalization so CR/LF header-break payloads no longer survive into normalized addresses, subjects, route keys, or message ids.
- Done: hardened outbound MIME assembly with explicit line-break guards, normalized sender/subject handling, and removal of the outbound `X-Murph-Route` alias leak.
- Done: per explicit user direction, hard-cut the legacy inbound `X-Murph-Route` fallback instead of preserving it; greenfield inbound routing now requires the actual stable alias address or the fixed public sender path.
- Done: updated focused runtime-state and Cloudflare regression coverage for header-break rejection, outbound alias-leak removal, and the greenfield route-header hard cut.
- Verification:
  - `pnpm --dir packages/runtime-state exec vitest run test/hosted-email.test.ts --no-coverage`
  - `pnpm --dir . exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/hosted-email.test.ts apps/cloudflare/test/index.test.ts --no-coverage`
  - `pnpm typecheck` fails on pre-existing unrelated workspace build/type issues in packages such as `core`, `device-syncd`, `gateway-local`, `assistantd`, and `cli`, not in the touched hosted-email files.
  - `pnpm test` fails on pre-existing unrelated `apps/web/test/device-sync-settings-routes.test.ts` and `packages/cli/test/incur-smoke.test.ts` expectation drift.
  - `pnpm test:coverage` fails on the same pre-existing `apps/web`/CLI failures plus pre-existing hosted-execution coverage threshold misses and a pre-existing `apps/cloudflare/test/workers/runtime.test.ts` failure.
- Final review:
  - Required `task-finish-review` returned no findings.
  - Residual proof gap noted by audit: the live provider boundary is still exercised only through the worker harness, not a real Cloudflare Email Worker delivery path.
  - Residual hardening note from audit: this patch explicitly rejects CR/LF header breaks; other malformed control characters still rely on existing parsers and normalizers.
- Next: close the plan and create the scoped commit.

Status: completed
Updated: 2026-04-05
Completed: 2026-04-05
