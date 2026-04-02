# Land Garmin first-class OAuth patch from ChatGPT Pro

Status: completed
Created: 2026-04-03
Updated: 2026-04-03

## Goal

- Pull the returned ChatGPT Pro Garmin patch, port the valid deltas onto the live dirty tree, and finish with Garmin wired as a first-class wearable across setup, hosted web, and `device-syncd`.

## Success criteria

- The returned `garmin-first-class-oauth.patch` artifact is downloaded, inspected, and either applied or manually ported without overwriting unrelated dirty-tree edits.
- Setup surfaces treat Garmin as a selectable wearable with the right environment guidance and public URL review language.
- Hosted `apps/web` can read Garmin provider config and register Garmin in the hosted device-sync registry.
- `packages/device-syncd` exposes a Garmin provider, the shared callback context supports the required OAuth state seam, and focused Garmin/device-sync tests cover the new behavior.
- Required verification and final review pass, or any unrelated baseline failures are documented explicitly.

## Scope

- In scope:
- Manual landing of the returned Pro Garmin patch intent across setup, hosted web, `device-syncd`, docs, and focused tests.
- Small boundary-aware adjustments required because the current live tree drifted from the snapshot the patch targeted.
- Out of scope:
- Reworking unrelated active hosted device-sync runtime contract changes.
- Broad hosted onboarding/auth changes unrelated to Garmin wearable/device-sync behavior.

## Constraints

- Preserve all unrelated dirty-tree edits already in the worktree.
- Treat the returned patch as behavioral intent, not overwrite authority.
- Keep identifiers and secrets redacted in any written artifacts.
- Follow the repo high-risk workflow: plan, ledger, focused proof, required verification, final audit, and scoped commit.

## Risks and mitigations

1. Risk: The returned patch targeted older package surfaces and no longer applies cleanly.
   Mitigation: Port changes manually on top of the current package entrypoints and test coverage.
2. Risk: Garmin endpoint or OAuth assumptions in the Pro patch may not be fully provable from public Garmin docs.
   Mitigation: Limit claims in docs, call out inference where needed, and keep the provider implementation behind the existing configurable provider seam with focused tests.
3. Risk: Active device-sync/runtime lanes overlap some files.
   Mitigation: Keep the touch set narrow, read current file state first, and avoid widening into the exclusive hosted runtime contract files.

## Tasks

1. Compare the returned patch against the live repo and decide the minimal safe Garmin delta.
2. Port the setup, hosted web, and `device-syncd` changes onto current package boundaries.
3. Add or update focused tests for setup, hosted config, shared OAuth callback state, and Garmin provider behavior.
4. Run required verification and any focused scenario proof needed for the device-sync trust boundary.
5. Run the required final completion review, address findings, and finish with a scoped commit.

## Decisions

- Use a plan-bearing workflow because this is a high-risk, multi-file external patch landing with manual conflict resolution.
- Keep the landing scoped to Garmin wearable/device-sync behavior instead of broadening into adjacent active device-sync runtime refactors.
- Treat the returned Pro patch as stale intent only: land Garmin as first-class OAuth plus polling/reconcile support, but do not ship speculative Garmin webhook handling that could not be validated from public Garmin documentation.
- Align stale hosted-web test suites to the current request-auth/sessionless onboarding boundary instead of reverting the newer route structure.
- Fix repo-green blockers uncovered during verification as part of the same lane: the hosted-web and Cloudflare `verify-fast.sh` empty-array cleanup bug, and the Cloudflare worker-secrets script harness so deploy automation tests do not depend on prebuilt workspace `dist/` artifacts.

## Verification

- Required:
- `pnpm typecheck`
- `pnpm test`
- `pnpm test:coverage`
- Focused:
- Garmin/setup/device-sync focused tests as the implementation surface becomes concrete.
- Completed:
- `pnpm exec vitest run --config apps/web/vitest.workspace.ts apps/web/test/hosted-onboarding-routes.test.ts apps/web/test/hosted-execution-routes.test.ts apps/web/test/hosted-onboarding-privy-service.test.ts apps/web/test/settings-email-sync-route.test.ts apps/web/test/settings-telegram-sync-route.test.ts apps/web/test/hosted-device-sync-internal-routes.test.ts apps/web/test/join-page.test.ts --no-coverage`
- `pnpm exec vitest run --config apps/cloudflare/vitest.node.workspace.ts apps/cloudflare/test/deploy-automation.test.ts --no-coverage`
Completed: 2026-04-03
