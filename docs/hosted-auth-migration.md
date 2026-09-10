# Hosted authentication migration

Status: implementation in progress. This document is the rollout owner for removing Privy in favor of Better Auth. It is not evidence that any stage is deployed or ready to activate.

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

## Backend configuration and deployment

PR 2 is an additive compatibility release. Apply both additive schema migrations
before its Web build reaches requests; old builds tolerate the new tables. Keep
new issuance off while all current routes, historical executable deployments and
recovery builds acquire the new readers and per-member writer guards. Do not
activate PR 2 alone: PR 3 supplies the new login/settings clients, Telegram login,
and credential-change/recovery journeys. Those must be usable before importing
members or distributing a dependent native release.

| Configuration | Purpose | Pause behavior |
| --- | --- | --- |
| `HOSTED_BETTER_AUTH_ENABLED=true` | Enable OTP send/verify, native exchange and importer apply; stop old full Privy completion | Unset/false pauses new issuance. Existing Better Auth sessions still read, renew and sign out. Handed-off members retain legacy-write guards. |
| `HOSTED_PRIVY_NATIVE_ENABLED` | Default allows verified, already-bound legacy native principals | Exact `false` rejects old native tokens with an upgrade response; replacement tokens still work. Disable only after native recovery/adoption gates. |
| `HOSTED_BETTER_AUTH_SECRET` | Independent canonical 32-byte base64url Better Auth signing secret | Retain while any replacement session exists. |
| `HOSTED_AUTH_STORAGE_KEY` | Independent canonical 32-byte base64url pre-auth encryption and separated blind-lookup/rate-limit domains | Retain while auth records exist. Rotation needs a reviewed reindex/re-encryption procedure; do not replace it as a rollout toggle. |
| `HOSTED_AUTH_EMAIL_FROM`, existing `RESEND_API_KEY` | OTP email delivery through the existing email owner | Qualify sender/delivery in hosted staging. |
| `HOSTED_AUTH_TWILIO_ACCOUNT_SID`, `HOSTED_AUTH_TWILIO_API_KEY_SID`, `HOSTED_AUTH_TWILIO_API_KEY_SECRET`, `HOSTED_AUTH_TWILIO_VERIFY_SERVICE_SID` | Dedicated Twilio Verify SMS service and API key | Qualify six-digit codes, destination coverage and fraud controls before exposing phone login. |

All secret provisioning occurs through the reviewed hosted configuration path.
Use the same stable values across compatible builds in one environment. The
existing public base URL owns the auth origin. Production serves HTTPS and uses
host-only Secure/HttpOnly/SameSite=Lax cookies; native endpoints reject Cookie
headers. Vercel ingress supplies the client address for authentication budgets.
No production secret is downloaded for local tests or previews.

The closed route surface is `/api/auth/otp/send`, `/api/auth/otp/verify`,
`/api/auth/session`, `/api/auth/logout` and `/api/auth/complete`. Native equivalents
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

## SMS verification owner

Use a dedicated [Twilio Verify service](https://www.twilio.com/docs/verify/api/service)
with the friendly name Murph, SMS enabled and six-digit codes. Verify manages
sending numbers; do not provision a Programmable Messaging sender pool for login.
The restricted API key needs `twilio/verify/verification/create` and
`twilio/verify/verification-check/create`; operational service qualification also
needs `twilio/verify/service/read`. Keep Verify fraud protection enabled and
qualify the intended destination countries before activation. See the
[restricted-key permissions](https://www.twilio.com/docs/iam/api-keys/restricted-api-keys).

The private SMS owner replaces the existing encrypted verification record under
the OTP contact lock, then starts Verify outside the transaction. A late send
response may attach its verification SID only to that exact, unexpired record.
Verification reserves at most three attempts per local generation before the
external check. An approved response persists a keyed digest bound to the code
and generation, never the plaintext code. Final completion rechecks that proof,
expiry and generation, then consumes it with canonical member/contact writes and
session issuance in one database-only transaction. A failed canonical commit can
retry the same approved code without calling the already-consumed provider again.

The local challenge expires five minutes after each send request. Twilio can
reuse its code and verification SID within its own validity window; a resend
replaces the local generation even when the displayed code stays the same.
Twilio expiry can therefore precede the local deadline. A lost provider approval
response or a failure before its local save requires a new code request; it
cannot be treated as approved. Start/check calls have a ten-second deadline,
propagate request cancellation and do not retry automatically. Missing service
configuration, rejected provider authority and malformed responses fail closed.

Keep issuance off while deploying this owner. Old raw SMS records and new Verify
records are mutually incompatible; users would need a fresh code if switching
formats during active issuance. Existing sessions and email codes retain their
readers and formats. There is no database migration. Before the held client
adoption release, update its phone credential-change owner to prepare Verify
approval outside locks and revalidate it inside the credential transaction, then
qualify send/check, same-member login, credential changes and real-device receipt.
A deployed backend alone is not activation approval. Once Verify issuance is
active, recovery builds must include this challenge reader; pausing issuance
preserves existing sessions.

## Approval migration

PR 1 is an additive reader-first deployment. Apply its credential-table migration before deploying the new Web build. Leave `HOSTED_APPROVAL_PASSKEY_ENROLLMENT_ENABLED` unset (disabled) through mixed-version deployment. Verify every production route and reachable historical deployment enforces replacement credentials, then enable enrollment with the exact value `true`. The switch gates both registration options and final registration; it does not gate verification of already enrolled keys.

After the first enrollment, the rollback floor is a build with this credential reader and commit guard. Disabling the switch pauses further enrollment but never restores wallet approval for migrated members. Old pages may need a refresh before approving after migration; existing browser sessions continue. No Worker or native change is required for PR 1.

Use the same action challenge and member/session binding for both proof formats. WebAuthn options and server verification require user verification and the canonical origin/RP. The verifier signs the complete action challenge, including expiry. Do not infer freshness from session renewal.

Enrollment must be authorized by the member's existing approved factor, or by a separately defined independent recovery operation. A normal authenticated session alone cannot replace established protection. Verify authorization at options generation and final registration, then consume it with the credential write. Do not issue a login session from enrollment.

Credential state is bounded and encrypted under the existing member crypto owner. Verify and prepare crypto before the transaction; recheck the exact state and current session under member locks. Commit signature-counter changes, one-use challenge acceptance and the protected mutation together. Counterless synced passkeys still depend on challenge consumption for replay protection.

Once replacement protection is established, do not try a legacy wallet after a failed passkey assertion. Corrupt credential state fails closed. The legacy proof reader is temporary and cannot become a recovery mechanism that ignores newer revocations.

## Browser and native continuity

Existing browser cookies are first-party Murph credentials and verify locally. Keep their reader and rows until old issuance has stopped and every valid old session has expired or been security-revoked. Preserve outstanding callback/handoff bindings and metadata. New authentication issues Better Auth sessions. No unconditional session purge occurs at activation.

Both current native auth services call the SDK's access-token refresh before reading a Privy identity token. The transition release must retain that restore/refresh ability long enough to exchange a valid token for a same-member Better Auth session. Store new credentials through native secure storage; prove lost-response recovery, account switching, offline restoration and renewable background use. Never accept an expired token as fresh authority or fall back after failed new-token verification.

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

## Completion evidence

Each PR needs focused tests/typecheck, candidate review, applicable ReviewGPT and green required exact-head CI. Auth proof covers actual enabled adapter operations, atomic OTP completion, same-member linking/unlinking, signed transport classification, current-session/factor checks and deletion races. Approval proof includes real signatures, missing UV, wrong origin/action/session, replay, counters and enrollment races. Native proof uses actual apps/devices, including skipped-version upgrades.

Final completion also inspects dependency graphs/bundles, schema/catalog, deployed configuration, operational jobs and durable cleanup outcomes. Startup without Privy configuration and cold/warm login must work. Static source review or a grep result alone does not establish vendor retirement.

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
