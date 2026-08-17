# Native companion end-to-end acceptance

Status: completed
Created: 2026-08-14
Updated: 2026-08-15

## Goal

Keep one production-faithful native iOS acceptance lane that exercises the real
compiled app against real hosted Web, Privy test authentication, and Junction
sandbox Apple Health without giving pull-request code CI credentials.

## Contract v3

- `.github/workflows/native-ios-hosted-e2e.yml` is the only public orchestration
  workflow. Secret-bearing jobs always check out the trusted default branch.
- PR mode deploys the exact PR SHA to the dedicated public Vercel project and
  custom environment `native-ios-e2e`. Vercel performs the PR's real Prisma
  migration owner and ordinary minified production Web build. The controller
  proves project, custom-environment, Git ref, and Git SHA provenance, then
  makes a bounded unauthenticated request to the exact candidate origin and
  rejects redirects, deployment protection, or non-success before dispatching
  native iOS.
- The cross-repository input contract is only `contract_version`,
  `correlation_id`, `identity_lifecycle`, `mode`, `web_base_url`, and `web_sha`.
  PR runs use `identity_lifecycle=orchestrator_owned_reset`; production canaries
  use `non_destructive_existing_identity`.
- A narrowly scoped GitHub App token can read the private iOS tag and dispatch
  and read Actions runs. The configured immutable lightweight tag must resolve
  to the separately configured reviewed 40-character iOS SHA before dispatch.
- Native success is not the backend postcondition. Before candidate retirement,
  the controller re-reads the fixed Privy principal, requires its creation time
  to follow the clean run boundary, derives the real Junction client user from
  the created hosted member, and requires a connected `apple_health_kit`
  provider from Junction's sandbox API.

## Destructive ownership

PR mode serializes one dedicated identity and uses this order:

1. Enumerate active deployments in the dedicated Vercel project. Refuse any
   production, wrong-custom-environment, or non-lane deployment; delete only
   lane-marked custom-environment deployments.
2. Use a Junction sandbox API key and team dedicated exclusively to this lane.
   Enumerate that team before reset and reject more than one user or any user
   from another team. If the database member exists, a sole Junction user must
   match the production client-user derivation before deletion; if the member is
   already absent, delete the sole dedicated-team orphan if present. Prove the
   team is empty, then reset/migrate only the isolated PostgreSQL database after
   both parsed database-name segments prove the same E2E/test-named database,
   then delete at most the fixed Privy test principal. Never invoke product
   account deletion.
3. Record the clean boundary, create the exact-SHA candidate, run native iOS,
   and prove the Privy/Junction postconditions above.
4. Retire candidate/stale lane deployments first, then repeat Junction → Prisma
   database reset → Privy cleanup. Any cleanup uncertainty fails the run.

`production_canary` never executes destructive owners. It uses the persistent
production-canary identity only after the triggering production deployment is
proved to remain the current production alias.

## Configuration and privacy

The Vercel custom environment owns runtime configuration for the candidate,
including `DATABASE_URL`, `DIRECT_DATABASE_URL`, Privy, Junction/Vital, crypto,
routing, and worker authorities. Do not create a JSON environment mirror. The
trusted cleanup command uses individually named, step-scoped GitHub Environment
secrets for the same DB/Junction/Privy management values because Vercel
Sensitive values cannot be read back through the REST API, `vercel env run -e`
only accepts the three built-in environments, and custom-environment `vercel
pull` writes a local env cache. The Junction API key and configured team ID are
lane-exclusive sandbox authority and must never point at a shared team. Keep the dedicated database and every matching
external worker isolated from production.

Logs expose stage names/status only. Do not retain screenshots, video, raw
`xcresult`, traces, provider bodies, OTPs, tokens, principal IDs, phone numbers,
or health data in public CI logs/artifacts. The private workflow owns the real
OTP credential and simulator/native runner authority.

## Scope and decisions

- Reuse Prisma's existing migration owner; no E2E migration ledger, migration
  checksums, compatibility wrapper, or schema parser.
- Keep one small Web-side lifecycle controller composed from narrow Vercel,
  native-dispatch, and test-identity owners plus focused behavior tests. Do not
  parse workflow source to prove YAML behavior and do not keep legacy contract
  shims.
- Preserve production authentication and runtime branches exactly; test-only
  authority is environmental and external to production request handling.
- Production canary is non-destructive and requires the current production
  alias check immediately before native dispatch.

## Verification

- `node --test scripts/native-ios-hosted-e2e.test.mjs`
- `node --check scripts/native-ios-hosted-e2e*.mjs`
- `pnpm --dir apps/web exec tsc --noEmit --pretty false` when dependencies for
  the exact head are available.
- Parse `.github/workflows/native-ios-hosted-e2e.yml` as YAML and run
  `git diff --check` on the final patch.
- Provision the protected environments, immutable private iOS tag/SHA, public
  custom environment, isolated data plane, and branch-protection status before
  making `Native iOS hosted E2E` required.
Completed: 2026-08-15
