# Fix hosted email ingress key scope and greenfield scoped decrypt fallback

Status: completed
Created: 2026-04-05
Updated: 2026-04-05

## Goal

- Align hosted email ingress, raw email persistence, and verified-sender route lookup with the post-hardening key split so public-sender ingress still works while user env and raw `.eml` stay under the per-user root key.
- Remove the hosted-web device-sync scoped-decrypt fallback to the unscoped root key for the greenfield path.

## Success criteria

- `RunnerUserEnvService` reads and writes hosted user env with the per-user root key but reconciles the verified-sender routing index with the worker route key used by public ingress lookup.
- Hosted email ingress resolves the route with the worker route key, unwraps the user crypto context before authorization, reads verified-email env with the per-user root key, and writes raw hosted email bodies with that same per-user root key.
- Runner-side raw email readback also uses the per-user root key so the stored payload remains readable after the ingress change.
- Hosted web device-sync secret decrypt no longer falls back from scoped decrypt to the unscoped root key, and focused tests match that hard cut.

## Scope

- In scope:
- `apps/cloudflare/src/{index.ts,user-runner.ts,runner-outbound.ts,user-runner/runner-user-env.ts}`
- `apps/web/src/lib/device-sync/crypto.ts`
- focused tests in `apps/cloudflare/test/{index,hosted-email}.test.ts` and `apps/web/test/device-sync-crypto.test.ts`
- coordination/plan artifacts for this lane
- Out of scope:
- broader hosted email architecture changes beyond the supplied patch intent
- new replay protection or zero-access design work
- durable-doc updates unless the implementation forces a durable rule change

## Constraints

- Technical constraints:
- Treat the supplied patch as behavioral intent and port it onto the live code without overwriting unrelated dirty-tree edits.
- Keep the worker route index on worker-key encryption so public sender lookup still works before user-key unwrap.
- Preserve current per-user root-key storage for hosted user env and raw email bodies.
- Product/process constraints:
- Follow the repo high-risk change workflow: required verification, direct proof from focused tests, one mandatory final review audit pass, and a scoped commit helper flow.

## Risks and mitigations

1. Risk: splitting route-index and user-env keys in the wrong direction could make ingress authorization or reply routing unreadable.
   Mitigation: keep the split explicit in constructor parameters and add focused tests for public-sender ingress plus raw email readback.

2. Risk: hosted-web scoped-decrypt hard cut could break legacy ciphertext fixtures.
   Mitigation: update the focused crypto regression to assert rejection of unscoped ciphertext when a scope is now required.

## Tasks

1. Register the lane in the coordination ledger and keep this plan aligned with the implemented patch.
2. Port the hosted-email key-scope split into the runner env service and worker ingress/outbound paths.
3. Hard-cut the hosted-web scoped decrypt fallback.
4. Update the focused regressions that prove the new behavior.
5. Run required verification, complete the required final review audit, and commit the scoped paths.

## Decisions

- Keep public sender route resolution on the worker route key, because direct public ingress must resolve before the worker unwraps the per-user root key.
- Treat the scoped-decrypt fallback as removed for greenfield hosted-web secrets; callers must provide the correct scope for scoped ciphertext.

## Verification

- Commands to run:
- `pnpm --dir apps/cloudflare exec vitest run --config vitest.node.workspace.ts test/index.test.ts test/hosted-email.test.ts --coverage.enabled=false --maxWorkers 1`
- `pnpm --dir apps/web exec vitest run --config vitest.config.ts test/device-sync-crypto.test.ts --coverage.enabled=false --maxWorkers 1`
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Expected outcomes:
- Focused hosted-email ingress tests prove route resolution still works with the worker route key while authorization and raw-message storage use the per-user root key.
- Hosted-web crypto tests prove scoped ciphertext still decrypts with the right scope and legacy unscoped ciphertext no longer decrypts when a scope is required.
Completed: 2026-04-05
