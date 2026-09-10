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
| 2. Better Auth and compatibility | Complete email/SMS/Telegram login for reconciled cohorts; new native protocol accepts requests | Adapter/privacy proof, same-member completion, delivery qualification, import reconciliation | Per-member monotonic handoff, local old-session reader, exact-route native bridge |
| 3. Client adoption | New web defaults and native releases use Better Auth | New backend protocol works before any dependent app is distributed | Valid old browser sessions drain; supported old native clients retain bounded admission |
| 4. Retirement | No supported client, live service or cleanup job needs Privy | All retirement gates below met | Remove temporary code, mappings, vendor configuration and obsolete schema |

Four Murph PRs are integration boundaries. iOS and Android changes are reviewed in their own repositories and pinned to the corresponding backend protocol; native store publication is a separate event from merging code.

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

Old settings code can mutate Privy before its Murph request succeeds. Database timestamps alone cannot detect this. Refresh exact provider evidence before handoff and reconcile remaining legacy-owned principals. If provider mutation cannot be reliably fenced, disputed credentials need account-bound proof before activation. Other users and existing sessions continue.

Canonical deletion writes its migration tombstone atomically and removes authentication records. Tombstones refer to the old identity/import generation, not a permanent prohibition on future legitimate contact registration.

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
