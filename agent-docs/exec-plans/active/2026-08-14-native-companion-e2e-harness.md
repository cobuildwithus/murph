# Native companion end-to-end harness

Status: active
Created: 2026-08-14
Updated: 2026-08-15

## Goal

- Catch native companion authentication and Apple Health connection regressions
  before a Web release by driving the compiled iOS app through first-time
  signup, consent/onboarding, explicit Apple Health connection, sign-out, and
  returning sign-in against the production-built hosted Web control plane.
- Make this the first scenario in a reusable native-journey lane rather than a
  one-off XCTest or provider-specific canary.

## Success criteria

- One command selects a named native journey and a backend target without
  embedding provider credentials, repository locations, ports, or identities
  in the journey test.
- The required pull-request proof runs a production/minified Next build, a
  fresh local database, synthetic Privy identity authority, a local Junction
  HTTP fixture, and the real iOS simulator app. It proves the expected
  Junction `resolve 404 -> create user -> sign-in token #1 ->
  sign-out/relaunch/login -> sign-in token #2` sequence, with the second token
  minted through passive resume of the existing Junction account.
- The first journey clicks through signup, canonical consent/onboarding,
  Apple Health connection, sign-out, app termination/relaunch, and login for
  the same synthetic member. It proves Login is the first post-relaunch state,
  no Junction request occurs before renewed Privy authentication, and returning
  login reuses the same backend member and Junction external account.
- Test-only auth and HealthKit/Junction UI boundaries are selected only in a
  Debug simulator process; no production auth, runtime, or environment
  invariant is weakened.
- A protected live profile can reuse the same journey against an isolated
  deployed target with a Privy test account and Junction sandbox, while the
  required hermetic profile remains secret-free and deterministic.
- Path routing runs the required lane for companion/auth/onboarding,
  device-sync/Junction, build/minification, schema, or deployment-control
  changes, and a contract test prevents route drift.
- Retained artifacts are fail-closed: both profiles use one artifact writer that
  keeps only structured step names, status codes, and provider request kinds by
  default. It prohibits screenshots, videos, traces, and raw output tails during
  identity, OTP, token-handoff, and consent stages; screenshots are permitted
  only for explicitly named post-auth states known not to render direct
  identifiers. No identity token, OTP, member identifier, email/phone, health
  value, secret, request body, or raw provider output is persisted.
- Focused tests, typechecks, the exact native journey, exact-head CI, and the
  requested ReviewGPT gates pass on the coordinated repository heads.

## Scope

- In scope: the public hosted-local scenario contract and production Web
  fixture, the iOS Debug simulator composition and declarative UI journey, the
  private cross-repository macOS orchestration lane, path routing, the artifact
  allowlist, focused contract tests, and testing/operations documentation.
- Out of scope: using production member or health data; production Privy or
  Junction credentials in pull requests; weakening auth for test requests;
  claiming simulator proof of physical HealthKit ingestion; enabling ordinary
  Vercel previews against production databases or crypto authority; and a
  generic mobile-device lab before a second platform journey needs it.

## Constraints

- Technical constraints: reuse the existing hosted-local scenario registry,
  production Web dist, isolated database lifecycle, Junction HTTP fixture, and
  cross-repository integration owner. Generate an ephemeral ES256 identity
  authority per run that supplies both operations the existing hosted Web owner
  requires: identity-token verification and authoritative user lookup for the
  same synthetic principal. Keep its synthetic bearer token in process memory
  and step-scoped environment only. Keep scenario definitions declarative; the
  harness owns simulator lifecycle, backend selection, fixtures, cleanup,
  routing, timeouts, and artifact sanitation.
- Product/process constraints: the real app owns all visible signup,
  onboarding, recovery, and connection interactions. The journey asserts member
  visible state transitions, including one in-place retry after a deterministic
  external-boundary failure and the post-sheet `Access requested · waiting for
  first data` state when no backend receipt exists. The hermetic profile may
  substitute only external SDK/system boundaries that hosted CI cannot make
  deterministic. A signed physical-iPhone release check remains the owner of
  actual HealthKit permission and ingestion evidence. ReviewGPT must inspect
  every auth/HealthKit/cross-repository candidate head, and the two product
  repositories retain independently reviewable commits and deployment order.

## Risks and mitigations

1. Risk: a Vercel preview with real provider credentials exposes secrets to
   pull-request code or accidentally touches production state.
   Mitigation: make the required PR gate a secret-free local production build;
   keep the live deployed profile isolated, protected, and non-authoritative.
2. Risk: a simulator-only fake proves screenshots but misses the minified Web
   failure that caused the incident.
   Mitigation: keep only Privy OTP and the native Junction/HealthKit system
   boundary deterministic; send every companion API request through the
   production-built Next server and real device-sync provider implementation
   to an HTTP-level Junction fixture.
3. Risk: launch arguments become a hidden auth bypass in shipped code.
   Mitigation: compile the native-journey composition under `DEBUG` and
   `targetEnvironment(simulator)`, require an explicit scenario, and test that
   Release composition cannot reference it. Web verifies a normally signed
   ephemeral identity token with its ordinary verification path and uses the
   same local-only synthetic authority for authoritative Privy user lookup.
4. Risk: a broad harness abstraction becomes harder to maintain than the
   journey.
   Mitigation: add only the current backend profiles and one journey; expose a
   small registry contract so future journeys add data plus focused boundary
   implementations instead of another workflow.
5. Risk: green simulator proof is mistaken for HealthKit data ingestion.
   Mitigation: name the milestone `health-access-requested`, document the
   hosted-system boundary, and retain a separate signed physical-device release
   checklist/canary for actual permission and source-receipt evidence.
6. Risk: retained failure artifacts leak protected-live authentication details
   even when textual redaction tests pass.
   Mitigation: use a stage-aware artifact allowlist shared by both profiles and
   test it with sentinel email, phone, OTP, member id, and token values. Images,
   videos, traces, and raw tails are absent for sensitive stages rather than
   redacted after capture.

## Tasks

1. Confirm the resolved incident path, native composition seams, existing
   hosted-local production build, and cross-repository workflow owner.
2. Ask ReviewGPT to challenge the two-profile architecture, trust boundaries,
   path routing, and smallest extensible contract against an exact draft head.
3. Add the public native-journey scenario contract, local synthetic Privy
   authority boundary, production Web/Junction scenario, and focused tests/docs.
4. Add the iOS Debug-simulator journey composition and declarative signup,
   consent/onboarding, connect failure/retry, post-permission waiting state,
   sign-out, relaunch, and returning sign-in UI test.
5. Add the private macOS orchestration job with immutable public/iOS refs,
   path routing, isolated PostgreSQL, allowed artifacts, and the protected live
   profile entry point.
6. Run focused proof, push coordinated candidates, start ReviewGPT with CI,
   resolve accepted findings, perform the parent final review, and record the
   remaining physical-device and hosted-environment evidence gaps.

## Decisions

- Use two profiles: required hermetic local-production proof on pull requests,
  plus a protected deployed integration canary. A Vercel preview is a target
  profile, not the harness owner or the only gate.
- Reuse `@murphai/hosted-local-harness` and the private Public Murph
  Integration workflow. Do not create another top-level service or duplicate
  Web stack lifecycle code.
- Keep provider/system substitutions at the edge: native OTP returns an
  ephemeral synthetic identity token, the local synthetic Privy authority
  supplies the matching authoritative user lookup, and the native
  Junction/HealthKit boundary records the token handoff and health-access
  request. The real Web route, hosted auth completion owner, member creation,
  consent, device-sync service, minified provider implementation, database, and
  HTTP fixture stay in path.
- Keep the hermetic and protected-live auth authorities mutually exclusive. The
  hermetic profile rejects unknown synthetic users through the normal auth
  owner while blocking outbound Privy traffic; the protected-live profile uses
  the real Privy test authority and rejects synthetic keys or test-control
  fields.
- Route by owned path groups from one manifest, not by duplicating glob lists
  across workflow YAML files.

## Verification

- Commands to run: focused hosted-local harness tests/typecheck, a
  profile/authority contract test, the forced-failure artifact test, the named
  native journey against the production Web dist, iOS SwiftFormat/Xcode build
  and focused UI test, workflow contract tests, `git diff --check`, exact-head
  CI, and the applicable ReviewGPT preliminary/final rounds in each changed
  repository.
- Expected outcomes: the synthetic first-time member reaches the canonical
  connect UI; the first connect attempt shows an in-place retry without
  resetting member or app state; the successful HealthKit handoff reaches
  `Access requested · waiting for first data` when no backend receipt exists;
  only an injected backend receipt can advance the UI to `Synced`; Junction
  observes one not-found resolve, one user creation, sign-in token #1,
  sign-out/relaunch/login, and sign-in token #2 through passive resume; no
  second member, external account, connection creation, or pre-auth relaunch
  provider request occurs; no sensitive value reaches logs/artifacts; sensitive
  stages retain no screenshots, videos, traces, or raw tails; and path-routing
  mutations fail focused tests.
