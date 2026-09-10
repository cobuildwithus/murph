# Hosted authentication migration

Status: implementation prepared across the staged PRs below. This document owns the rollout from Privy to Better Auth. Final pushed-head CI remains a merge gate; source review and local proof do not establish deployment or activation.

## Target and boundaries

Better Auth owns supported primary authentication and product sessions. Murph keeps canonical member IDs, authorization, contact/linking policy, consent, billing, vaults, groups, devices, and deletion. Approval passkeys belong to the existing sensitive-action owner. They approve one bound action; they are not an alternative primary-login system.

Retain existing encrypted canonical contact fields. Better Auth's login projection changes atomically through the same owner. A routing phone, billing email, or provider orphan does not authorize claiming a member. No cross-member automatic merge or retirement is part of the replacement.

Use no planned service outage. Prefer natural compatibility drain over elaborate session translation. Original valid browser sessions remain valid until their existing expiry or explicit revocation. Recovery, logout, suspension and deletion remain effective; an old session is not fresh proof.

## Delivery sequence

| PR | Usable result | Activation prerequisite | Temporary ownership |
| --- | --- | --- | --- |
| 1. Approval migration | Protected members enroll Murph passkeys and approve actions without wallet signatures | Real WebAuthn, storage, concurrency and enrollment proof; production RP qualified; compatible readers deployed before enrollment is enabled | Existing approved factor authorizes transition; old proof reader remains for unmigrated members |
| 2. Better Auth and compatibility | Email/SMS login and same-member session compatibility; new native protocol accepts requests | Adapter/privacy and same-member proof; deploy readers with issuance off until PR 3 is ready | Per-member monotonic handoff, local old-session reader, exact-route native bridge |
| 3. Client adoption | Web/native clients, Telegram login and credential controls use Better Auth | All login methods and credential controls qualified; new backend works before dependent apps are distributed | Valid old browser sessions drain; supported old native clients retain bounded admission |
| 4. Retirement | No supported client, live service or cleanup job needs Privy | All retirement gates below met | Remove temporary code, mappings, vendor configuration and obsolete schema |

Four Murph PRs are integration boundaries. iOS and Android changes are reviewed in their own repositories and pinned to the corresponding backend protocol; native store publication is a separate event from merging code.

Current candidates and code qualification:

| Stage | Candidate | Reviewed source and remaining preparation |
| --- | --- | --- |
| 1 | [Murph #3127](https://github.com/cobuildwithus/murph/pull/3127) | Round 2 PASS and green CI at `bc9f3728b12bcb54ab941505e34ff32cecde9c68` |
| 2 | [Murph #3128](https://github.com/cobuildwithus/murph/pull/3128) | Round 3 PASS and green CI at `ca1c6a115aaf050df78a939c77f0590f0737e995` |
| 3 | [Murph #3132](https://github.com/cobuildwithus/murph/pull/3132) | [Round 3 PASS](https://chatgpt.com/c/6aa27f48-2834-83ea-8988-d5c4ca137932) and green CI at `540a4ac11863970587139579edc9d5e19b2040bc` |
| 3 | [iOS #150](https://github.com/cobuildwithus/murph-ios/pull/150) | Round 2 PASS and green CI at `c46430d6dfbf93a1805f50ace6c9599b0c3f0c9e` |
| 3 | [Android #39](https://github.com/cobuildwithus/murph-android/pull/39) | [Round 3 PASS](https://chatgpt.com/c/6aa27f77-4630-83ea-9bbd-fd92c0d39a01) and green CI at `a589e0072bbcfc9efcce36471e0d4dce099bb4f7` |
| 4 | [Murph #3134](https://github.com/cobuildwithus/murph/pull/3134) | [Round 2 PASS](https://chatgpt.com/c/6aa26b77-4f88-83ea-83c6-b8d752026677) and green CI on runtime source `87786eda0b935ac32614fc843665e0aadefa971c`; later base reconciliation and handoff change only docs. Check final-head CI on the PR |
| 4 | [iOS #151](https://github.com/cobuildwithus/murph-ios/pull/151) | Round 1 PASS and green CI at `4380c93cca8bd47fc4b8ddee0c41e1de58de1b72` |
| 4 | [Android #40](https://github.com/cobuildwithus/murph-android/pull/40) | [Round 2 PASS](https://chatgpt.com/c/6aa28183-b694-83ea-92c1-a430aebc4552) and green CI at `ffc5d97752b6c2c99ae73f9002201dfbbe4c562c` |

Android [#38](https://github.com/cobuildwithus/murph-android/pull/38) at `614cbc6cc05d2229c76148a3dd5bea1ed1c18bb5` is the independently reviewed tooling prerequisite before #39. After #40, [#41](https://github.com/cobuildwithus/murph-android/pull/41) at `bf346f57a1f8aaef5d620bd359dc57a1bdad59dc` removes two unused CI placeholders. Its refreshed trusted review passes against #40, including 13 contract tests and unchanged control-policy proof; check the PR for final CI. These control changes are isolated from product review and add no rollout stage.

Web adoption now invalidates the previous decrypted vault at successful replacement-response headers and orders cookie writes across tabs. Its actual Next TypeScript 5 and Web TypeScript 7 checks and four real Chromium/HttpOnly-cookie OTP/Telegram scenarios pass. The first round-3 attempt produced only a preliminary note without a completed verdict or model evidence; it is invalid and does not count as a substantive round. The completed fresh full round 3 retains the original first-reviewed and previous valid heads; exact-turn, response hash and actual gpt-6-pro metadata validate its PASS.

Android adoption uses the existing AndroidX Core AtomicFile to stage first writes consistently on supported platforms. Both empty and partial initial-write interruptions reproduce the old failure on API 29; all nine actual Keystore/storage/HTTP/composed recovery cases pass with the fix on API 28, 29 and 36. CI also passes all 44 synthetic cases on each of API 28/29/30. There is no new storage format, dependency or platform branch. The SDK-free release preserves this same secure-record owner, encryption key and local member binding. iOS retirement passes 601 unit tests and Debug/Release simulator builds.

These are code candidates, not deployed versions. Do not merge retirement candidates or distribute SDK-free apps until every retirement gate passes. Keep the transition app available while eligible installed sessions still need its one-time bridge. Real delivery, installed/signed-device upgrades and dormant/skipped-version recovery remain release qualification work.

## Backend configuration and deployment

The following flags and import commands apply to the additive transition
releases. The retirement release removes the native bridge, importer and legacy
configuration after their obligations converge; do not run transition commands
against the contracted deployment.

PR 2 is an additive compatibility release. Apply both additive schema migrations
before its Web build reaches requests; old builds tolerate the new tables. Keep
new issuance off while all current routes, historical executable deployments and
recovery builds acquire the new readers and per-member writer guards. Do not
activate PR 2 alone: PR 3 supplies the new login/settings clients, Telegram login,
and credential-change/recovery journeys. Those must be usable before importing
members or distributing a dependent native release.

PR 3 changes the main Web dialog and invite entry to first-party authentication
unconditionally. Deploy that client with issuance enabled only after the complete
PR 3 qualification below; do not ship its new login UI with issuance still off.
After cutover, pausing issuance keeps the new UI and both session readers in
place. It must not reload Privy login or restore legacy credential writers.

| Configuration | Purpose | Pause behavior |
| --- | --- | --- |
| `HOSTED_BETTER_AUTH_ENABLED=true` | Enable OTP send/verify, native exchange and importer apply; stop old full Privy completion | Unset/false pauses new issuance. Existing Better Auth sessions still read, renew and sign out. Handed-off members retain legacy-write guards. |
| `HOSTED_PRIVY_NATIVE_ENABLED` | Default allows verified, already-bound legacy native principals | Exact `false` rejects old native tokens with an upgrade response; replacement tokens still work. Disable only after native recovery/adoption gates. |
| `HOSTED_BETTER_AUTH_SECRET` | Independent canonical 32-byte base64url Better Auth signing secret | Retain while any replacement session exists. |
| `HOSTED_AUTH_STORAGE_KEY` | Independent canonical 32-byte base64url pre-auth encryption and separated blind-lookup/rate-limit domains | Retain while auth records exist. Rotation needs a reviewed reindex/re-encryption procedure; do not replace it as a rollout toggle. |
| `HOSTED_AUTH_EMAIL_FROM`, existing `RESEND_API_KEY` | OTP email delivery through the existing email owner | Qualify sender/delivery in hosted staging. |
| `HOSTED_AUTH_TELEGRAM_CLIENT_ID` | Numeric Telegram login client ID; verified token audience and browser popup configuration | Qualify the registered Web origin, profile ID and bot messaging scopes before Telegram login is exposed. |
| `HOSTED_AUTH_TWILIO_ACCOUNT_SID`, `HOSTED_AUTH_TWILIO_API_KEY_SID`, `HOSTED_AUTH_TWILIO_API_KEY_SECRET`, `HOSTED_AUTH_TWILIO_MESSAGING_SERVICE_SID` | Dedicated SMS sender credentials/configuration | Qualify service, destination coverage and fraud controls before exposing phone login. |

All secret provisioning occurs through the reviewed hosted configuration path.
Use the same stable values across compatible builds in one environment. The
existing public base URL owns the auth origin. Production serves HTTPS and uses
host-only Secure/HttpOnly/SameSite=Lax cookies; native endpoints reject Cookie
headers. Vercel ingress supplies the client address for authentication budgets.
No production secret is downloaded for local tests or previews.

The closed route surface is `/api/auth/otp/send`, `/api/auth/otp/verify`,
`/api/auth/telegram/start`, `/api/auth/telegram/verify`, `/api/auth/session`,
`/api/auth/logout` and `/api/auth/complete`. Native OTP/session equivalents
live below `/api/device-sync/companion/auth`, with an additional `/exchange` and
existing companion admission for product bootstrap. No Better Auth catch-all
handler is exposed. A successful browser OTP response sets only its cookie;
native completion returns the prefixed bearer and sets no cookies. Session GET
reads; POST renews. Renewal preserves the token and primary-auth time. Login
commits before retryable product bootstrap, so billing/runtime projection errors
do not lose a completed login. Logout authenticates and deletes the session
through the protected adapter, retries bounded renewal conflicts, and propagates
storage failures. Better Auth's best-effort sign-out response is not evidence of
durable revocation.

Before widening, prove hosted email/SMS delivery, same-member login, consent and
billing continuations, settings recovery, cross-format logout and background
native renewal. Issuance pause and legacy-admission disable have separate tests.
These local proofs do not qualify actual KMS, provider deliverability, app-store
upgrades or dormant devices.

## Approval migration

PR 1 is an additive reader-first deployment. Apply its credential-table migration before deploying the new Web build. Leave `HOSTED_APPROVAL_PASSKEY_ENROLLMENT_ENABLED` unset (disabled) through mixed-version deployment. Verify every production route and reachable historical deployment enforces replacement credentials, then enable enrollment with the exact value `true`. The switch gates both registration options and final registration; it does not gate verification of already enrolled keys.

After the first enrollment, the rollback floor is a build with this credential reader and commit guard. Disabling the switch pauses further enrollment but never restores wallet approval for migrated members. Old pages may need a refresh before approving after migration; existing browser sessions continue. No Worker or native change is required for PR 1.

Use the same action challenge and member/session binding for both proof formats. WebAuthn options and server verification require user verification and the canonical origin/RP. The verifier signs the complete action challenge, including expiry. Do not infer freshness from session renewal.

Enrollment must be authorized by the member's existing approved factor, or by a separately defined independent recovery operation. A normal authenticated session alone cannot replace established protection. Verify authorization at options generation and final registration, then consume it with the credential write. Do not issue a login session from enrollment.

New Better Auth accounts without any legacy identity or established approval credential can enroll their first passkey after primary authentication within five minutes. Silent exchange and session renewal do not count as primary proof. The fixed initial-options route creates an ordinary member/session-bound enrollment challenge; registration verifies WebAuthn, rechecks the current session and absent legacy binding, then atomically consumes the challenge and writes the first credential. Concurrent setup has one winner. An imported or protected member must use the existing-factor or independent-recovery path.

Credential state is bounded and encrypted under the existing member crypto owner. Verify and prepare crypto before the transaction; recheck the exact state and current session under member locks. Commit signature-counter changes, one-use challenge acceptance and the protected mutation together. Counterless synced passkeys still depend on challenge consumption for replay protection.

Once replacement protection is established, do not try a legacy wallet after a failed passkey assertion. Corrupt credential state fails closed. The legacy proof reader is temporary and cannot become a recovery mechanism that ignores newer revocations.

First-party approval hooks do not load the legacy SDK. Account settings omit its
provider for initial or established Murph passkeys. For an unmigrated factor,
the action endpoint selects the expected legacy principal from the current
member; the temporary client restores that principal with its existing passkey,
checks the same principal before and after wallet loading, and signs the bound
action. It never creates a missing factor during approval or changes the Murph
session. Legacy factor setup uses a separate provider dialog and checks the
current member before provider mutations. Qualify passkey login in the existing
provider configuration and real-device restoration before enabling migration.

### Independent recovery

PR 3 adds one nullable encrypted recovery-hash column to the existing approval
aggregate. Apply `20260910040000_approval_recovery_key` before deploying its
generated client; no backfill is needed. Existing readers tolerate this column.

After migrating or setting up a Murph passkey, use **Save a recovery key** in
Security. A current passkey approval authorizes generating one random 32-byte
key, shown once. Only its SHA-256 digest, encrypted and bound to the member and
field, is stored. Generation preserves sessions and replaces any prior recovery
key. If delivery is lost, the current passkey can authorize a new key; no key
retrieval endpoint exists. Keep the saved key separate from the passkey.

**Use a recovery key** requires first-party primary authentication within five
minutes and the previously saved key. A five-minute challenge binds the current
member, browser session and exact recovery-key generation. Final registration
requires a new user-verified WebAuthn credential. One transaction replaces all
previous approval credentials, consumes the challenge/key, revokes other
first-party and legacy browser sessions, and fences legacy native credentials.
The authorizing browser stays signed in. The newly approved passkey can then
authorize a fresh recovery key. Recovery does not change primary sign-in methods
or contacts. Member/IP limits bound attempts; primary login
alone, silent native exchange, and a provider wallet cannot redeem or provision
this recovery path for an already protected member.

Both issuance and enrollment switches gate recovery mutations. A pause preserves
existing protection; the UI never falls back to provider login or a weaker
reset. Local proof must include a failed database commit followed by retry,
simultaneous redemption, another member/session, changed keys, revoked sessions,
and provider-independent completion. Qualify storage/copying and WebAuthn on
supported browsers before widening.

A member who lost every legacy factor before enrolling cannot create a recovery
key from an OTP. Keep that case unresolved in the retirement inventory until
existing independent proof can restore protection through a separately reviewed
operation. Support has no email/SMS-only override. Do not retire the provider
while those accounts still depend on its factor; the deployment plan must not
represent an unresolved account as migrated. Saved-key recovery follows the
options described in [OWASP's MFA recovery guidance](https://cheatsheetseries.owasp.org/cheatsheets/Multifactor_Authentication_Cheat_Sheet.html#resetting-mfa).

## Credential settings

The fixed `/api/settings/login-methods` reader and challenge, OTP send/verify,
Telegram start/prepare/verify, and remove routes own first-party credential
changes. They require the current browser session and canonical member, reject
other members' contacts, and preserve the last usable sign-in. Existing approval
covers the exact operation and old/new identity. Email changes use the pinned
private Better Auth change-email API; phone proof uses its server-only consume
API. Telegram verification binds numeric identity and nonce to this member and
session, with a distinct purpose from login. No library catch-all is exposed.

Proof, canonical contact/routing writes, encrypted login records, approval
acceptance and the durable channel wake commit together. Delivery, crypto
preparation and runtime signaling occur outside the transaction. Wrong-code
budgets commit; later database failures roll back the proof for a safe retry.
Email replacement also removes old routing authority and rotates its reply alias.

Adding a method keeps existing sessions, including imported native sessions.
Replacing/removing one preserves the authorizing first-party browser but revokes
other sessions and blocks native legacy credentials. This security action may
require those devices to sign in again. A later import cannot restore the old
method. These routes remain gated by issuance activation; the settings clients
and recovery journeys must be qualified before enabling them.

## Browser and native continuity

Browser renewal and primary sign-in/logout serialize cookie-writing requests with one origin-wide Web Lock. An older renewal must settle before another login is dispatched, including across tabs; no valid server session is revoked merely to change accounts. Renewal requests have a ten-second deadline and verification/logout have thirty-second deadlines. Browsers without the lock API retain their existing cookie lifetime and can still sign in; native bearer renewal is unchanged. This uses the browser's [Web Locks contract](https://developer.mozilla.org/en-US/docs/Web/API/Web_Locks_API), with no persistent coordinator.


Existing browser cookies are first-party Murph credentials and verify locally. Keep their reader and rows until old issuance has stopped and every valid old session has expired or been security-revoked. Preserve outstanding callback/handoff bindings and metadata. New authentication issues Better Auth sessions. No unconditional session purge occurs at activation.

Visible authenticated Web pages make at most one renewal check per hour per
mounted document and retry on later focus/visibility changes. The server keeps
the daily renewal threshold and primary-proof timestamp. Hidden/offline tabs do
not sign out or fall back to another provider. A legacy renewal request only
reads its existing record and never sets a replacement cookie or extends expiry.

Browser sign-out waits for durable server revocation, then refreshes canonical
state without loading the legacy SDK. Confirmed deletion navigates immediately
to the public farewell and preserves its pending-cleanup status. Leftover SDK
browser state is never primary-login authority after cutover; old completion and
credential writers remain fenced. The temporary approval port independently
checks the current member before using any restored SDK principal.

`/settings/accounts` shares the dashboard's credential and passkey controls but
uses identity admission before subscription setup. Email-only onboarding links
there to add a messaging method, then returns through `/join` to the canonical
onboarding owner. Targeted invites retain their member binding; phone invites
show their existing masked hint and request the full number for first-party OTP.
The server rejects proof for another member even if the entered contact changes.

The native ephemeral settings browser opens `/settings/accounts?companion=ios`
or `ios-dev`. Login resumes that page. Its explicit return link uses the fixed
app/environment callback scheme with host `account-settings`, no query, token or
member ID. Duplicate or unknown companion parameters produce only the local
`/join` link. A callback only asks native admission to reread canonical setup;
it never proves successful account linking or changes the stored app principal.

Both native transition auth services call the SDK's access-token refresh before reading a Privy identity token. The transition release must retain that restore/refresh ability long enough to exchange a valid token for a same-member Better Auth session. Store new credentials through native secure storage; prove lost-response recovery, account switching, offline restoration and renewable background use. Never accept an expired token as fresh authority or fall back after failed new-token verification.

Ship the usable backend first. Release native transition builds independently and measure supported-version adoption. Remove SDK restoration only after the migration journey and dormant-client recovery are qualified. Installed users who skip transition releases require a tested route; zero recent legacy traffic is not sufficient evidence. Expired or revoked credentials may require reauthentication.

Legacy native admission is credential-read-only: it resolves an already-bound principal, does not create members, synchronize contacts, issue grants or transfer ownership. Authorized device writes continue. Keep identity-only recovery/revocation endpoints distinct from paid-active endpoints. Extension/capture enrollment credentials and health-provider sessions remain separate from product sessions.

## Import and writer handoff

Use a bounded, resumable hosted importer with keyset pagination and explicit per-member outcomes. Reconcile local records and current provider evidence independently, including dormant, pending, text-first, invited, conflicting, protected, suspended and deleting cohorts. Provider-only accounts belong in retirement inventory, not automatic signup.

Prepare provider reads and crypto outside transactions. Under existing contact/member locks, recheck the source fingerprints, current member and migration generation; atomically write the login projection and handoff outcome. The handoff is monotonic. No stale importer, completion handler, old settings route or operational helper may overwrite new credentials.

The authenticated Ops endpoint `POST /api/ops/auth-migration` defaults to
`{"mode":"dry-run"}`. It requires the existing operator allowlist, active
browser session and mutation origin. Each request inspects at most five
canonical members using one six-row keyset probe. Send the returned `next` as
`after` for the next page; `{"mode":"apply"}` uses the same bounded scan and
requires issuance enabled. Provider evidence and crypto preparation happen
outside each short member/contact transaction. Applying twice is safe.

Responses are private operator data: member IDs, a continuation and closed
outcomes, never contacts or provider messages. `ready` is an inspection result;
`imported` and `already_owned` are committed ownership. `conflict`, `unbound`,
`suspended` and `unavailable` remain unresolved. A null continuation means only
that this scan ended. Aggregate every page and repeat inspection after repairs;
zero unresolved retained members and separately inventoried provider orphans
are retirement gates. Do not copy response rows into PRs, docs or logs.

Old settings code can mutate Privy before its Murph request succeeds. Database timestamps alone cannot detect this. Refresh exact provider evidence before handoff and reconcile remaining legacy-owned principals. If provider mutation cannot be reliably fenced, disputed credentials need account-bound proof before activation. Other users and existing sessions continue.

Canonical deletion already establishes the FK-free encrypted provider-cleanup
receipt before removing the member. Reuse that owner as the legacy-principal
deletion fence; do not add another tombstone table. Auth user/account/session
rows cascade with the canonical member. Import and native exchange recheck the
receipt and member under commit locks, so a stale preparation cannot recreate
a deleted member. Expired pre-auth OTP/rate-limit records drain through bounded
hourly retention. A later independently verified new signup receives a new
canonical member; it cannot resurrect the deleted one.

## Recovery and observation

Widen cohorts only after method success, identity conflicts, integrity failures, native rejection causes and cleanup backlog are understood against the baseline. Cross-member authority, restored removed credentials, ignored revocation or deletion resurrection stops widening immediately.

Before every stage, identify the minimum compatibility-aware recovery build. After new credential or factor mutations, an old Privy-only build is not a safe rollback target. Pause affected issuance/mutations while preserving valid sessions, then repair forward or use a build that preserves all committed state. Database snapshot restoration can resurrect deleted/revoked authority and is not routine rollback.

No provider/KMS calls occur under commit locks. Use bounded backfills and rehearsed online schema expansion. Review contraction separately; short lock timeouts and retry prevent contested DDL from blocking live requests. Checked-in drops must not execute automatically before old readers drain.

## Retirement gates and order

Retirement requires all of the following:

- No valid old browser session needs its verifier, and no supported callback or recovery build needs the old format.
- Supported native clients can migrate, renew, recover and handle upgrade requirements; dormant users have an explicit path.
- Every retained member/provider principal has a terminal import/conflict/recovery disposition. No live lookup needs Privy.
- Previously protected members have replacement protection or operational independent recovery; no silent primary-OTP downgrade exists.
- Wallet/export obligations are resolved and destructive vendor retirement has its explicit authorization.
- Encrypted durable receipts preserve every provider target before detaching unused bindings. Provider calls happen outside transactions, with rebound checks and retries.
- Cleanup readers support the next payload before writers emit it. Remaining Stripe, Cloudflare, runtime-log and Temporal work keeps its leases, cursors, attempts and outcomes. Missing configuration never means successful deletion.
- Old deployed writers/readers/workers and generated clients are drained. Historical executable deployments cannot remain alternative mutation paths.

Disable drained legacy admission; finish authorized vendor obligations while credentials/receipts remain; deploy code independent of old schema; drain incompatible workers; apply reviewed drops; then revoke residual vendor configuration. Retained Murph members are never deleted just to retire their provider accounts.

Remove live Privy SDKs, verifiers, hooks, wallet code, native dependencies, CSP/configuration, obsolete sessions/bindings, import/runtime migration branches, harnesses, canaries and current documentation. Keep canonical contacts and unrelated key consumers. In particular, the session-named HMAC key also authenticates billing quotes, referrals, device callbacks and recovery witnesses; it is not exclusively a Privy/session dependency.

## Retirement execution

PR 4 removes the old verifiers, exchange/import routes, provider contact writers,
wallet approvals, SDK UI, native admission fallback and provider configuration.
It retains the first-party credential format, secure storage contract, canonical
member IDs and session signing/storage keys. Updated mobile installations read
the same durable credential after the SDK is removed. Installed upgrades and
skipped-version recovery still require device qualification before distribution.

Do not merge or deploy PR 4 merely because code review and CI pass. First complete
the inventory above, including protected accounts, dormant clients and vendor
exports/deletions. Confirm no valid legacy browser session remains, no retained
provider-bound identity lacks its first-party user, and no pending deletion
receipt still targets the provider. For receipts, the relevant pending condition
is a non-null provider lookup key with no provider completion timestamp; a new
receipt with neither field is not an outstanding provider obligation. This SQL
check supplements the hosted encrypted-record/provider inventory; it cannot
prove passkey availability, payload integrity or native adoption.

Deploy the code that does not reference the old schema, drain incompatible Web
functions and cleanup workers, then run the existing postdeploy contract lane.
`20260910070000_retire_legacy_auth` refuses to drop the old table/columns while
those database obligations remain. The existing runner's current-deployment
check and short transaction timeouts still apply. The new reader works both
before and after contraction. After contraction, use a compatible forward fix;
older schema-dependent builds are below the rollback floor.

Cleanup payloads keep their existing v1 schema. The previous parser accepts an
omitted optional provider identifier, so both versions can read newly written
receipts during drain. Stripe, Cloudflare, runtime-log and Temporal cleanup keep
their current leases, cursors and retry owner. The deletion response retains
`vendorAccounts.privyUser` as a fixed `skipped_no_record` result for already-open
browser tabs that read that key after deletion commits. This compatibility field
is valid only after actual provider obligations are resolved; it never turns
missing provider configuration into a successful deletion. Historical migrations,
changelogs and secret-deny rules remain as evidence and privacy protection.

The App Review helper prepares product access for an existing first-party
account. The reviewer must first use ordinary authentication; it neither creates
provider test users nor issues fixed codes. Qualify a usable reviewer code-delivery
process before store submission. Finally revoke the obsolete provider secrets,
custom auth-domain configuration and service account access through the approved
hosted path after the last reader and obligation are gone.

## Completion evidence

Each PR needs focused tests/typecheck, candidate review, applicable ReviewGPT and green required exact-head CI. Auth proof covers actual enabled adapter operations, atomic OTP completion, same-member linking/unlinking, signed transport classification, current-session/factor checks and deletion races. Approval proof includes real signatures, missing UV, wrong origin/action/session, replay, counters and enrollment races. Native proof uses actual apps/devices, including skipped-version upgrades.

Final completion also inspects dependency graphs/bundles, schema/catalog, deployed configuration, operational jobs and durable cleanup outcomes. Startup without Privy configuration and cold/warm login must work. Static source review or a grep result alone does not establish vendor retirement.

The final Web adoption response SHA-256 is `19433a8fcfb65fd2f446cfb3404db3a14cd1e72994400871db6d08163c5797a9`; Android adoption is `dfa8cd36fe214ed58930ae1efa6da0f58fdc987a0fd2183ea200168a3cdd27c0`. Android retirement response SHA-256 is `ba3ca1fb5839f18c6412ce9d23bec5bd216edb043cb54faa2fd8869b8b1d375c`; its exact-thread response, context digest, checked head and actual gpt-6-pro model metadata were validated. Native review bodies retain their reviewed context; this rollout owner records current cross-repository status.

### Local browser proof limitation

The composed `pnpm hosted-local e2e hosted-web-browser-smoke --profile e2e:stub` journey reaches authenticated Connect but reports the same invalid-element server-render failure on retirement source `87786eda0b935ac32614fc843665e0aadefa971c` and the earlier compatibility source `ca1c6a115aaf050df78a939c77f0590f0737e995`. Both pages recover through client rendering. This is an existing rendering defect, not a clean full-stack pass. The existing Frog entry `20260910003445-public-auth-smoke` owns the diagnostic gap. Focused real-browser auth/cookie proof, canonical PostgreSQL proof and native boundary tests pass independently; none substitutes for hosted delivery and installed-device qualification.

## Source contracts

The implementation is pinned to Better Auth 1.7.3 and exercises its installed
adapter, OTP and session code. Public contracts: [adapter factory](https://better-auth.com/docs/guides/create-a-db-adapter),
[email OTP](https://better-auth.com/docs/plugins/email-otp),
[phone OTP](https://better-auth.com/docs/plugins/phone-number), and
[sessions](https://better-auth.com/docs/concepts/session-management).
SMS transport follows the [Twilio Message resource](https://www.twilio.com/docs/messaging/api/message-resource):
bounded validity, discarded message content, obfuscated retained addresses and
fraud checking. IP admission uses [Vercel request headers](https://vercel.com/docs/headers/request-headers).
PR 3 must qualify [Telegram's current login contract](https://core.telegram.org/bots/telegram-login),
including verified numeric user identity, nonce binding and one-use completion;
the OIDC subject must not be assumed to equal the existing numeric bot user ID.
