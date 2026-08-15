# Native companion end-to-end harness

Status: active
Created: 2026-08-14
Updated: 2026-08-14

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
  Junction `resolve 404 -> create user -> sign-in token` sequence.
- The first journey clicks through signup, canonical consent/onboarding,
  Apple Health connection, sign-out, and login for the same synthetic member.
- Test-only auth and HealthKit/Junction UI boundaries are selected only in a
  Debug simulator process; no production auth, runtime, or environment
  invariant is weakened.
- A protected live profile can reuse the same journey against an isolated
  deployed target with a Privy test account and Junction sandbox, while the
  required hermetic profile remains secret-free and deterministic.
- Path routing runs the required lane for companion/auth/onboarding,
  device-sync/Junction, build/minification, schema, or deployment-control
  changes, and a contract test prevents route drift.
- Logs and retained artifacts contain only step names, status codes, provider
  request kinds, screenshots, and sanitized tails; no identity token, OTP,
  member identifier, email/phone, health value, secret, or request body is
  persisted.
- Focused tests, typechecks, the exact native journey, exact-head CI, and the
  requested ReviewGPT gates pass on the coordinated repository heads.

## Scope

- In scope: the public hosted-local scenario contract and production Web
  fixture, the iOS Debug simulator composition and declarative UI journey, the
  private cross-repository macOS orchestration lane, path routing, artifact
  redaction, focused contract tests, and testing/operations documentation.
- Out of scope: using production member or health data; production Privy or
  Junction credentials in pull requests; weakening auth for test requests;
  claiming simulator proof of physical HealthKit ingestion; enabling ordinary
  Vercel previews against production databases or crypto authority; and a
  generic mobile-device lab before a second platform journey needs it.

## Constraints

- Technical constraints: reuse the existing hosted-local scenario registry,
  production Web dist, isolated database lifecycle, Junction HTTP fixture, and
  cross-repository integration owner. Generate an ephemeral ES256 identity
  authority per run and keep its synthetic bearer token in process memory and
  step-scoped environment only. Keep scenario definitions declarative; the
  harness owns simulator lifecycle, backend selection, fixtures, cleanup,
  routing, timeouts, and artifact sanitation.
- Product/process constraints: the real app owns all visible signup,
  onboarding, recovery, and connection interactions. The hermetic profile may
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
   ephemeral identity token with its ordinary verification path.
4. Risk: a broad harness abstraction becomes harder to maintain than the
   journey.
   Mitigation: add only the current backend profiles and one journey; expose a
   small registry contract so future journeys add data plus focused boundary
   implementations instead of another workflow.
5. Risk: green simulator proof is mistaken for HealthKit data ingestion.
   Mitigation: name the milestone `health-access-requested`, document the
   hosted-system boundary, and retain a separate signed physical-device release
   checklist/canary for actual permission and source-receipt evidence.

## Tasks

1. Confirm the resolved incident path, native composition seams, existing
   hosted-local production build, and cross-repository workflow owner.
2. Ask ReviewGPT to challenge the two-profile architecture, trust boundaries,
   path routing, and smallest extensible contract against an exact draft head.
3. Add the public native-journey scenario contract, ephemeral identity helper,
   production Web/Junction scenario, and focused tests/docs.
4. Add the iOS Debug-simulator journey composition and declarative signup,
   consent/onboarding, connect, sign-out, and sign-in UI test.
5. Add the private macOS orchestration job with immutable public/iOS refs,
   path routing, isolated PostgreSQL, redacted artifacts, and the protected live
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
  ephemeral synthetic identity token, and the native Junction/HealthKit
  boundary records the token handoff and health-access request. The real Web
  route, auth verification, member creation, consent, device-sync service,
  minified provider implementation, database, and HTTP fixture stay in path.
- Route by owned path groups from one manifest, not by duplicating glob lists
  across workflow YAML files.

## Verification

- Commands to run: focused hosted-local harness tests/typecheck, the named
  native journey against the production Web dist, iOS SwiftFormat/Xcode build
  and focused UI test, workflow contract tests, `git diff --check`, exact-head
  CI, and the applicable ReviewGPT preliminary/final rounds in each changed
  repository.
- Expected outcomes: the synthetic first-time member reaches the canonical
  connect UI; Junction observes one not-found resolve, one user creation, and
  one sign-in-token request; sign-out removes local authority; returning login
  reuses the same backend member; no sensitive value reaches logs/artifacts;
  and path-routing mutations fail focused tests.
