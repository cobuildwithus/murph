# Native iOS Hosted E2E Control Contract

Last verified: 2026-08-15

## Outcome and authority

This repository owns the Web/control-plane half of the native companion
acceptance lane. The private sibling iOS repository owns the normally compiled
native app, physical-device runner, Privy OTP interaction, Vital SDK calls, and
HealthKit system UI. The cross-repository seam is deliberately small: this repo
selects relevant PRs, creates or verifies one exact hosted Web deployment,
dispatches one exact approved private workflow revision, and accepts only that
workflow run's status/conclusion.

This is the acceptance lane for native companion auth/control/device-sync
changes. Hosted-local, hermetic, fixture, or mocked companion coverage remains
useful lower-level proof but is not a substitute for this lane. The required PR
journey uses a real hosted/minified Web build, real Privy OTP authority, the real
companion admission/legal-consent/sign-in-token routes and database contract,
real Junction/Vital SDK calls, and the real iOS HealthKit permission UI. It must
not add a production runtime test flag, auth bypass, fixture transport, fake
provider server, synthetic Privy token, or synthetic Junction/Vital behavior.

The checked-in owners are:

- `.github/workflows/native-ios-hosted-e2e.yml`: trusted dispatch/gate owner.
- `scripts/native-ios-hosted-e2e-control.mjs`: path selection, exact-deployment
  verification, contract-v1 dispatch, exact-private-run verification, and
  temporary deployment retirement.
- `apps/web/scripts/run-native-ios-hosted-e2e-migrations.ts`: custom-environment
  build admission for the existing real Prisma migration owner. It forces the
  direct-database guard and refuses canonical production.
- `apps/web/src/lib/hosted-web/public-url.ts`: binds the custom environment's
  public/device-sync URL to that exact deployment's Vercel URL so provider
  callbacks cannot drift to the E2E project's baseline deployment.
- `scripts/check-native-ios-hosted-e2e-ci.mjs`: source-level drift guard run by
  Repo Hygiene before any protected live authority is considered.
- The existing companion, hosted-onboarding, device-sync, privacy-deletion,
  legal/sensitive-action, Prisma, contracts, and `device-syncd` owners remain
  production behavior owners. This lane adds no alternate runtime route.

## Trusted PR flow

The secret-bearing workflow does **not** execute from `pull_request` or
`pull_request_target`. It runs from the default-branch definition after the
credential-free `Repo Hygiene` `workflow_run` completes. The controller reads
the live pull request through GitHub's API, requires the current head to equal
the PR-head SHA recorded on the triggering Repo Hygiene run, and selects the lane when the change can
reach companion auth/control/device-sync or its persisted contract.

Selected PRs fail closed unless all of these are true:

1. Repo Hygiene succeeded.
2. The head belongs to this repository and is human-authored. Fork and bot heads
   do not receive protected live authority. The trusted job re-reads the PR head
   immediately before any deployment/dispatch work and fails if it has moved.
3. A reviewer admits the run to GitHub Environment `native-ios-hosted-e2e`.
4. The controller resolves the protected custom-environment id and requires its
   slug/project to be exactly `native-ios-e2e` in the dedicated Vercel E2E
   project. Vercel then accepts the exact PR SHA/ref into that environment and
   reports a non-production deployment for the same custom-environment id,
   project, ref, and SHA. Its build applies ordinary Prisma migrations
   through the existing migration owner before compiling the Web app.
5. The configured private iOS ref is a repository-ruleset-protected immutable
   lightweight tag. Immediately before dispatch, the controller resolves that
   tag through GitHub and requires it to point directly at the approved iOS SHA.
   The workflow dispatch then returns an exact run receipt, and that run reports
   `workflow_dispatch` at the same approved iOS SHA.
6. The private workflow concludes `success`.
7. The temporary hosted deployment is retired. Cleanup failure fails the job.

The PR protected runner always checks out `${{ github.sha }}` from the trusted
`workflow_run` control source, never the PR head. The production canary checks
out the repository default branch instead of the `deployment_status` SHA, then
proves the deployed SHA is reachable from `main` before any deployed-revision
logic could execute. The PR SHA is sent only to Vercel's deployment API.
The dedicated E2E Vercel project is the isolation boundary for PR code: it must
contain only test identities, an isolated real Postgres database, a dedicated
real Privy test application/OTP authority, and real Junction sandbox/provider
authority. It must not contain production member data or production provider
credentials. Its `native-ios-e2e` Custom Environment must expose a direct
`DIRECT_DATABASE_URL`; the committed E2E migration owner forces the existing
`MURPH_REQUIRE_DIRECT_DATABASE_URL_FOR_MIGRATIONS=1` contract before calling the
normal `runHostedWebPrismaMigrateDeploy` owner. Before migration, the build also
requires every successfully applied `_prisma_migrations` entry in that database
to match both the migration name and Prisma SHA-256 script checksum in the exact
PR source. Missing/pooled/mis-owned database authority or
residue from an abandoned migration-bearing PR therefore fails the hosted build
instead of silently testing a stale schema. Reprovisioning that dedicated test
database from protected `main` history is an infrastructure lifecycle action,
not a member reset route. Postdeploy contract-cleanup migrations keep their
separate production owner and are never pulled forward into this predeploy lane.

The exact deployment URL also owns the E2E public callback surface. Within only
`VERCEL_TARGET_ENV=native-ios-e2e`, the hosted public/device-sync URL resolver
uses Vercel's generated `VERCEL_URL` ahead of inherited configured/project URLs.
That keeps Junction webhook/callback and companion public-ingress authority on
the same exact PR deployment that the controller dispatches to native. Missing
or invalid exact Vercel URL fails closed. The deployment must be reachable by
the physical iPhone without a product auth bypass; Murph authentication itself
remains the normal Privy/companion flow. Vercel source/build output remains
private (`public: false` on deployment creation); do not replace product auth
with a Vercel test-auth shim.

The canonical production Web project remains main-only in
`apps/web/vercel.json`. Do not enable arbitrary branch auto-deployments there to
make this lane work. The controller creates the separate E2E project deployment
explicitly and names its `native-ios-e2e` Custom Environment, while the same
checked-in build command still produces the normal minified Next.js app. That
build command first calls the E2E migration owner, which is a no-op outside the
exact custom environment, then preserves the existing production migration/build
chain. Canonical production behavior is unchanged and the E2E migration owner
explicitly rejects `VERCEL_ENV=production`. The dedicated project must use the
same repository/build-root shape that causes this checked-in `vercel.json` to
govern the deployment; a project-level build override that bypasses the
committed contract is invalid E2E authority.

## Selected main-repo changes

The selector intentionally errs toward running the live lane. It includes:

- `apps/web/app/api/device-sync/**`, `apps/web/app/api/internal/device-sync/**`, and
  `apps/web/app/api/settings/device-sync/**`;
- `apps/web/app/api/hosted-onboarding/**` and `apps/web/app/api/legal/**`;
- `apps/web/app/api/settings/privacy/delete/**` and the Settings sensitive-action
  challenge route used by that user-owned deletion boundary;
- `apps/web/src/lib/device-sync/**`, `hosted-onboarding/**`,
  `hosted-privacy/**`, `legal/**`, and `sensitive-actions/**`;
- Prisma schema and ordinary predeploy migrations, plus their migration-owner
  scripts; postdeploy `apps/web/prisma/contract-migrations/**` cleanup alone does
  not select this predeploy lane because the existing production contract-
  migration workflow is its truthful owner;
- `packages/contracts/**` and `packages/device-syncd/**`;
- shared Prisma/HTTP/hosted-Web plumbing used directly by the companion routes;
- Web build/proxy/Vercel configuration, Repo Hygiene/root command authority, and
  the native E2E workflow/control sources themselves.

GitHub's pull-request files endpoint is bounded. If the controller reaches its
3,000-file inspection ceiling, it selects the live lane rather than silently
classifying the PR as irrelevant.

## Dispatch contract v1

The private workflow must expose `workflow_dispatch` at the configured
`NATIVE_IOS_E2E_IOS_REF` and accept exactly the following stable inputs. Adding
native implementation details here is a contract change; keep them private to
the sibling repository.

| Input | Allowed/meaning |
| --- | --- |
| `contract_version` | Literal `1`. |
| `mode` | `pr` or `production_canary`. |
| `correlation_id` | Privacy-safe run identifier; no member/provider values. |
| `web_sha` | Exact 40-character Web commit SHA. |
| `web_base_url` | HTTPS origin only. |
| `web_deployment_ref` | Vercel deployment id for PR, or exact production-alias proof ref. |
| `web_environment` | `native-ios-e2e` for PR, `production` for canary. |
| `account_lifecycle` | `user_owned_delete` for PR, `existing_identity_non_destructive` for production. |

The main repo mints a repository-scoped GitHub App installation token only long
enough to resolve the approved lightweight tag, dispatch, and read the returned
run. The tag must be protected against mutation by the private repository's
ruleset; code cannot create that external policy. The controller requires the
tag's Git object to be the exact approved commit before dispatch. It then
requires the current GitHub workflow-dispatch response's `workflow_run_id`,
polls only that run's status/conclusion, and verifies its `event` and `head_sha`.
It does not read
private job logs, job lists, artifacts, or native output payloads. A successful
conclusion is therefore the only cross-repository result datum used by the
gate.

`NATIVE_IOS_E2E_IOS_EXPECTED_SHA` is separate from the workflow ref on purpose:
the ref is dispatch syntax, while the SHA is the exact approved native revision
that must be reported by the returned run. Update both in the protected
configuration as a reviewed private/main-repo compatibility change.

## Private iOS obligations

The sibling workflow implementation is not copied into this repository. For
`mode=pr`, it must, using a normally compiled app on a real physical iPhone:

1. Prepare a clean test-device lifecycle in which Murph's HealthKit grant is not
   already present, using device/CI-farm lifecycle rather than an app test hook.
2. Use a dedicated test login identifier and retrieve the **real Privy OTP**
   from its protected test inbox/SMS authority. No synthetic token or direct
   member insertion is allowed.
3. Complete real companion admission and legal-consent calls against
   `web_base_url`, then consume the real one-time companion sign-in-token route.
4. Execute the real Junction/Vital SDK boundary (`VitalClient`/Vital HealthKit
   owner in the native repo), present and accept the real iOS HealthKit
   permission UI, and exercise the real configured Junction sandbox path.
5. Observe backend status through the normal companion status contract until
   the run has production-shaped evidence that the member/provider lane is
   established. Do not infer success solely from local SDK optimism.
6. In an always-run cleanup phase, use the same dedicated identity and the
   normal hosted Web Settings **user-owned account deletion** boundary. If a
   previous run stranded that identity, the next run may first authenticate as
   that user and use the same deletion boundary before starting fresh signup.
   There is no admin/internal reset fallback, and cleanup failure is failure.

The user-owned deletion route, its same-origin/sensitive-action checks, canonical
privacy deletion service, and Privy deletion behavior remain the only reset
mechanism used by this lane. The native workflow must not reproduce those
owners or add a companion-only deletion route.

For `mode=production_canary`, the native workflow uses a persistent dedicated
production canary identity with an established real provider lane and
`account_lifecycle=existing_identity_non_destructive`. It may sign in through
real Privy OTP and must call the normal real SDK/control surfaces, but it must
not delete the account, disconnect/recreate the provider, inject synthetic
health data, or mutate ordinary production users. HealthKit authorization is
real OS state on the dedicated canary device; ongoing canaries must not reset it
through a product bypass merely to force the sheet to reappear. Initial canary
device enrollment must itself have passed the real HealthKit permission UI.

## Privacy-safe result boundary

Auth, OTP, legal consent, HealthKit consent, and provider-token stages must not upload screenshots, videos, raw xcresult bundles, traces, response bodies, or log tails. The main workflow never downloads private artifacts. If the private
repository retains a diagnostic stage summary for its own operators, only a
privacy-safe structured record may cross its artifact boundary, for example:

```json
{
  "contractVersion": 1,
  "mode": "pr",
  "stages": [
    { "name": "privy_otp", "status": "passed" },
    { "name": "companion_admission", "status": "passed" },
    { "name": "healthkit_consent", "status": "passed" },
    { "name": "junction_sdk", "status": "passed" },
    { "name": "user_owned_delete", "status": "passed" }
  ]
}
```

Stage data must contain no login identifier, OTP, bearer/sign-in token, member
id, provider account id, health value, URL query, HTTP body, screenshot, trace,
or copied log text. The authoritative cross-repo result remains the exact run's
GitHub conclusion.

## Protected configuration

Configuration is intentionally not encoded as secret values. Missing values
fail preflight; do not convert them into skips.

Main repository Environment `native-ios-hosted-e2e`:

| Kind | Name | Contract |
| --- | --- | --- |
| secret | `NATIVE_IOS_E2E_GITHUB_APP_PRIVATE_KEY` | Private key for the narrowly installed cross-repo dispatcher App. |
| secret | `NATIVE_IOS_E2E_VERCEL_TOKEN` | Can create/read/delete deployments only in the dedicated E2E scope. |
| variable | `NATIVE_IOS_E2E_GITHUB_APP_ID` | GitHub App id. |
| variable | `NATIVE_IOS_E2E_IOS_REPOSITORY_OWNER` | Private iOS repository owner. |
| variable | `NATIVE_IOS_E2E_IOS_REPOSITORY_NAME` | Private iOS repository name. |
| variable | `NATIVE_IOS_E2E_IOS_WORKFLOW` | Private workflow file/id. |
| variable | `NATIVE_IOS_E2E_IOS_REF` | Ruleset-protected immutable lightweight tag for the approved private workflow revision. |
| variable | `NATIVE_IOS_E2E_IOS_EXPECTED_SHA` | Exact approved private workflow SHA. |
| variable | `NATIVE_IOS_E2E_VERCEL_PROJECT_ID` | Dedicated E2E Vercel project id. |
| variable | `NATIVE_IOS_E2E_VERCEL_PROJECT_NAME` | Dedicated E2E Vercel project name. |
| variable | `NATIVE_IOS_E2E_VERCEL_CUSTOM_ENVIRONMENT_ID` | Exact id of the dedicated Custom Environment whose slug is `native-ios-e2e`. |
| variable | `NATIVE_IOS_E2E_VERCEL_GITHUB_REPOSITORY_ID` | Numeric GitHub repo id used by Vercel gitSource. |
| variable | `NATIVE_IOS_E2E_VERCEL_TEAM_ID` | Optional Vercel team/scope id. |

The dedicated Vercel project must provision a Custom Environment with the exact
slug **`native-ios-e2e`**. That environment uses the app's existing production
configuration names, but every value is dedicated test/sandbox authority. At a
minimum, the live companion path needs the normal Web database/auth/provider
configuration, including `DATABASE_URL`, `DIRECT_DATABASE_URL`,
`NEXT_PUBLIC_PRIVY_APP_ID`, `NEXT_PUBLIC_PRIVY_CLIENT_ID`, `PRIVY_APP_SECRET`,
`PRIVY_VERIFICATION_KEY`, `JUNCTION_API_KEY`, `JUNCTION_CLIENT_USER_ID_SECRET`,
`JUNCTION_ENV` (sandbox), and `JUNCTION_REGION`, plus the other ordinary hosted
Web crypto/session variables already required by those production owners. Do
not introduce parallel E2E-only provider secret names into application code.
The private native app must be configured for the same dedicated real Privy
authority as this Web environment. Values stay in Vercel/private-repo protected
configuration and are never echoed by the controller.

Main repository Environment `native-ios-production-canary` uses the same GitHub
App/iOS variables and private key plus the existing production Web authority:
`HOSTED_WEB_PRODUCTION_BASE_URL`, `HOSTED_WEB_VERCEL_PROJECT_ID`, optional
`HOSTED_WEB_VERCEL_TEAM_ID`, and secret `HOSTED_WEB_VERCEL_TOKEN`.

The GitHub App must be installed only where needed and have repository Actions
read/write plus Contents read authority: Actions dispatches/reads the single
private workflow run, while Contents read resolves the protected lightweight tag
before dispatch. Do not give the main workflow a reusable personal token.

The private repository should keep its real identity/device authority behind
its own protected environments. Neutral names for the sibling implementation
are:

- PR secret `NATIVE_IOS_E2E_PRIVY_LOGIN_IDENTIFIER`;
- PR secret `NATIVE_IOS_E2E_PRIVY_OTP_READER_TOKEN` (credential for the real
  inbox/SMS test authority, not a Privy auth token);
- PR variable `NATIVE_IOS_E2E_DEVICE_UDID`;
- production secret `NATIVE_IOS_PRODUCTION_CANARY_PRIVY_LOGIN_IDENTIFIER`;
- production secret `NATIVE_IOS_PRODUCTION_CANARY_PRIVY_OTP_READER_TOKEN`;
- production variable `NATIVE_IOS_PRODUCTION_CANARY_DEVICE_UDID`.

The native repo does not need a Junction API secret for this contract: the app
obtains the real one-time SDK sign-in token from Web. Provider/backend authority
belongs to the dedicated hosted Web E2E project for PRs and the normal
production deployment for the production canary.

## Required gate and rollout

The stable commit-status context is **`Native iOS hosted E2E`**. Once the
workflow and protected configuration are installed on default branch, branch
protection should require that context for merges. Irrelevant PRs receive a
success status from the trusted selector; relevant PRs receive success only
after the exact live lane succeeds. Selected forks/bot heads fail closed rather
than receiving protected provider authority.

Repository code cannot create GitHub Environments, their reviewers, GitHub App
installation/permissions, Vercel project secrets, the private physical-device
runner, or branch-protection rules. Bootstrap in this order:

1. Merge the trusted workflow/control/guard and private contract owners.
2. Provision the dedicated Vercel E2E project and its `native-ios-e2e` Custom
   Environment with an isolated real database (including a direct migration
   endpoint), real test Privy/Junction authority, no production data, and
   network reachability from the physical iPhone. The database lifecycle must
   support reprovisioning from protected `main` if a failed/unmerged PR leaves
   migration history whose name or Prisma SHA-256 script checksum is not present
   in the next exact source; the checked-in migration guard detects and blocks
   that drift rather than resetting it.
3. Create/protect both main-repo Environments and the private-repo environments;
   populate only the names above.
4. Install the narrow GitHub App on the private iOS repository; create a
   lightweight tag for the reviewed private workflow SHA, protect that tag from
   update/deletion with a repository ruleset, and configure the exact tag/SHA.
5. Prove one selected PR end to end, including user-owned deletion cleanup.
6. Add `Native iOS hosted E2E` as a required branch-protection status.

Until steps 2-5 are complete, selected live runs fail rather than skip. The
production canary separately triggers only from a successful Vercel production
deployment event, verifies the deployed SHA belongs to `main`, re-resolves the
canonical production alias to that exact SHA, and dispatches the non-destructive
private mode. A production canary failure is a deployment signal; it does not
run an automatic destructive recovery action.

## Plan authority

This snapshot contains no `agent-docs/exec-plans/**` tree to edit in place. The
current executable contract is therefore this reference plus
`agent-docs/product-specs/companion-app-mvp.md` and the CI guard. Any active or
future execution plan that still describes mocked/hermetic native acceptance is
stale and must point here instead; the mock/hermetic path cannot satisfy the
required native acceptance gate.
