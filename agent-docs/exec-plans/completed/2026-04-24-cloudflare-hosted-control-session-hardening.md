# Harden Cloudflare hosted control browser-vault session seam

Status: completed
Created: 2026-04-24
Updated: 2026-04-24

## Goal

- Harden the private Cloudflare hosted-control seam so browser-vault session and status callers fail closed on route drift, blank user ids, and mismatched user/replica response payloads.

## Success criteria

- Real missing browser-vault replicas return and map through a stable structured worker error code.
- Generic HTTP 404s remain control-plane HTTP failures instead of becoming benign empty browser-vault sessions.
- Browser-vault ready responses are bound back to the requested `userId` and parsed `replicaRef`.
- Status responses are rejected when the returned `userId` does not match the requested user.
- Blank hosted-control user ids are rejected before path/header construction.
- Route-shape drift is covered by focused package/worker tests.

## Scope

- In scope:
  - `packages/cloudflare-hosted-control/src/{client,routes,user-id}.ts` and direct tests.
  - The worker browser-vault missing-replica response shape and direct worker matcher regression tests.
  - The web browser-vault route only if the package error contract changes in a way that requires direct handling changes.
- Out of scope:
  - Broad hosted wake, runner lifecycle, assistant runtime, or hosted web UI behavior.
  - Package export widening.
  - Live Cloudflare deploy changes.

## Constraints

- Technical constraints:
  - Keep the public package surface limited to the existing `./client` and `./routes` subpaths.
  - Keep invalid control responses rejected as `TypeError` where current callers depend on that 502 mapping.
  - Do not echo arbitrary worker response bodies when mapping generic HTTP failures.
- Product/process constraints:
  - Preserve unrelated dirty work in the shared checkout.
  - Coordinate around the active hosted typing lane that also names `apps/cloudflare/src/index.ts`.

## Risks and mitigations

1. Risk: Route/spec centralization grows the tiny package into a broader framework.
   Mitigation: Keep route specs minimal and private to the existing routes subpath.
2. Risk: Worker-side edits collide with an active `apps/cloudflare/src/index.ts` lane.
   Mitigation: Limit edits to the browser-vault route error body and focused route tests.
3. Risk: Tight parser checks reject an existing valid response.
   Mitigation: Derive checks from the request body and current response contract, with focused positive and negative tests.

## Tasks

1. Inspect current client parser, route builders, worker route matching, and existing tests.
2. Add package-local user id validation and shared route spec helpers.
3. Change worker replica-missing response to a stable code and update client mapping.
4. Bind browser-vault response parsing to expected user and replica references.
5. Add status user binding validation.
6. Add focused package and worker regression tests.
7. Run required verification and completion audits.

## Decisions

- Classify as high-risk scoped trust-boundary work because it changes private control-plane validation.
- Do not create a scoped commit from this checkout because `apps/cloudflare/src/index.ts` carries an overlapping same-file hunk for `ownsInternalWorkerProxyToken({ token, userId })` that belongs to another active Cloudflare boundary lane, and the shared ledger already contains unrelated concurrent churn.

## Verification

- Commands to run:
  - `pnpm typecheck`
  - `bash scripts/workspace-verify.sh test:diff packages/cloudflare-hosted-control/src/client.ts packages/cloudflare-hosted-control/src/routes.ts packages/cloudflare-hosted-control/test/client.test.ts packages/cloudflare-hosted-control/test/routes.test.ts apps/cloudflare/src/index.ts apps/cloudflare/test/index.test.ts`
  - Focused direct tests if needed for fast iteration.
- Expected outcomes:
  - Hosted-control package regressions pass.
  - Worker route regressions pass.
  - Any broader red checks are either fixed or documented as unrelated pre-existing failures with exact targets.

## Outcome

- Implemented stable structured browser-vault missing-replica mapping, contextual browser-vault session validation, status user binding, blank user-id rejection, and shared route matcher/specs.
- Added focused package and worker route regression coverage.
- `pnpm --dir packages/cloudflare-hosted-control typecheck` passed.
- `pnpm --dir packages/cloudflare-hosted-control test -- --runInBand` passed.
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts --no-coverage apps/cloudflare/test/index.test.ts` passed.
- `pnpm --dir packages/cloudflare-hosted-control test:coverage` passed.
- `git diff --check -- <touched paths>` passed.
- `pnpm --dir apps/cloudflare typecheck`, root `pnpm typecheck`, and scoped `test:diff` are blocked by unrelated active hosted-runner/assistant-runtime type drift.
- Required `simplify`, `coverage-write`, and `task-finish-review` audits completed; no remaining code findings.
Completed: 2026-04-24
