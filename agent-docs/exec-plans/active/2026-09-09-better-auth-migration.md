# Replace Privy with Better Auth through staged rollout

Status: active
Created: 2026-09-09
Updated: 2026-09-10

## Goal

Prepare mergeable implementation PRs and an executable rollout document that remove Privy completely, retain canonical member ownership, and minimize downtime and repeated login, especially in the native apps. Maintainability takes precedence over elaborate continuity machinery.

## Success criteria

- Four staged Murph integration PRs cover approval migration, Better Auth/login compatibility, web/native adoption, and final retirement; coordinated native PRs cover their actual implementations.
- Existing valid browser sessions continue through their local verifier until normal expiry/revocation. Native migration/renewal is proved against actual SDK storage and app behavior.
- Member IDs, billing, vaults, consent, grants, devices, routing, deletion and protected-action authority remain intact.
- Focused checks, required exact-head CI, candidate review and routed ReviewGPT are complete for mergeable candidates.
- The rollout document names activation, reader/writer compatibility, import, recovery and destructive-retirement gates. No live Privy dependency is omitted from final scope.

## Scope and authority

Implementation, tests, owner docs, isolated task branches, scoped commits and draft/ready PRs are authorized. Merge, production operations and vendor destruction are separate events; none is performed by this implementation task.

The first branch owns the approvals integration. Subsequent branches will be stacked or based on the accepted predecessor. Preserve unrelated work and native repository guidance.

## Product UX

Outcome: protected actions can use a Murph passkey without a Privy wallet dependency, followed by Better Auth login without account loss.
Entry and promise: existing Settings/passkey and approval surfaces, existing login and native restoration. Preserve cancellation and retry; security recovery never silently weakens protection.
Affected people: protected and unconfigured members, existing browser sessions, new and dormant logins, legacy/updated/offline native clients, pending/text-first/invited members, suspended/deleting members.
Proof: complete user journeys plus real WebAuthn fixtures, Postgres concurrency, cross-format revocation, actual native restoration and explicit deployment compatibility.
Done when: intended actions succeed with the same member and original authorization, failures preserve valid state, and supported old clients have a tested transition.
Current verdict: PR 1 has a resolved ReviewGPT PASS and green exact-head CI at bc9f3728b12bcb54ab941505e34ff32cecde9c68. Later stages remain Hold.

## Tasks

1. Implement PR 1 approval migration and its additive storage/rollout contract.
2. Implement PR 2 Better Auth login, encrypted login projection, adapter proof, importer and session/native compatibility.
3. Implement PR 3 web/native adoption and monotonic identity-writer handoff.
4. Implement PR 4 gated retirement and final dependency/schema/config cleanup.
5. For each candidate, run relevant focused checks/typecheck, inspect the diff, publish draft PR, then complete eligible final review and CI before claiming mergeability.
6. Audit full outcome across all repositories and retain explicit activation/retirement facts still requiring hosted evidence.

## Decisions

- Preserve canonical contacts; update the login projection atomically through their owner. No generic bidirectional synchronization.
- Preserve valid old browser sessions by natural drain. Better Auth issues new sessions and is the final session owner.
- Keep approval WebAuthn in the existing sensitive-action owner using a maintained verifier. Do not add passkey primary login or introduce Better Auth session hooks solely for approvals.
- Keep temporary compatibility mechanisms narrowly scoped with concrete removal conditions. Do not add a general-purpose authentication flow framework.
- Cross-member phone-transfer containment belongs to PR 2 with identity handoff, keeping PR 1 limited to approval authority. PR 1 does add the new credential relation to the existing disposable-scaffold guard so phone transfer cannot delete a migrated factor.
- Native source repositories are accessible; inspect their exact auth storage/refresh contracts before choosing an exchange implementation.
- Reviewed source was 34022b5ef5780471af500c2f656f1632080e62b0; implementation branch starts at ab54b60248. Intervening affected-owner changes were inspected and do not change the approval/session migration premise.

## Risks and mitigations

- Forged auth records: authenticate authority-bearing records, use member-bound encryption, fail closed before lookup/mutation, and prove actual adapter operations.
- Stale Privy mutations/import: independent provider evidence plus short member-locked monotonic handoff; no global service pause.
- Factor downgrade: existing approved proof or independent recovery authorizes replacement; UV/action/session binding and atomic consumption required.
- Native lockout: usable backend before distribution, same-member migration/renewal proof, supported-version and dormant-client recovery gates.
- Retirement data loss: compatible cleanup readers and completed provider obligations precede schema/config removal; retain unrelated key consumers.

## Verification

PR 1 implementation now includes real WebAuthn verification, bounded encrypted
credential storage, action-commit session/factor guards and disabled-by-default
enrollment. Ten isolated PostgreSQL proofs pass, including concurrent first
enrollment, counterless replay, rollback, cross-session options, CSRF, suspension
and deletion. Existing browser-session issuance remains unchanged. Web typecheck and changed-file lint pass. The focused suite passes 244 tests,
and the separate action-approval database suite passes nine tests. Phone and
desktop rendered states pass at 390 and 1280 pixels; the additive SQL migration
also applies successfully in the isolated task database. These
tests use real PostgreSQL and WebAuthn signatures with the repository's synthetic
member-crypto codec; they are not a hosted KMS or real-device qualification.

Remaining verification covers later PRs' focused tests/typechecks, real native restoration and device qualification, dependency guards, complexity review, exact-head CI and final ReviewGPT. Local and CI proof does not establish production activation.

## PR 1 candidate review

The existing member, crypto, session, challenge, action-approval and deletion
owners remain authoritative. New verification code carries mandatory credential
state through commit, and the browser challenge consumer requires current-session
proof. Removed the unused verification/consumption wrapper that could bypass
that session check. Provider/KMS work remains outside transactions; credential
collections are capped at eight and all new persistence reads are point lookups.
The changed source passes the complexity guard; existing Settings/export
hotspots retain their prior debt. No primary-login or native behavior is changed
in this PR. Enrollment is off by default and release notes accompany activation.

Recorded task-owned Frog friction: the ordinary Web runner silently excludes an
explicitly requested database test, so database proof used its correct dedicated
configuration. Required hosted/device qualification remains an activation gate,
not a claim made by local synthetic evidence.


PR 1 review round 1 found a WebAuthn challenge encoding mismatch. The parent
confirmed SimpleWebAuthn encodes string inputs as UTF-8 bytes, corrected both
options builders to pass digest bytes, and changed proof fixtures to use the
actual generated registration/authentication challenges. The privacy schema
inventory now explicitly includes the encrypted approval aggregate. Focused
cryptographic/schema tests, PostgreSQL journeys, typecheck and lint pass; the
remediated candidate still requires resolved final review and exact-head CI.

PR 1 review round 2 passed on bc9f3728b12bcb54ab941505e34ff32cecde9c68.
Required CI subsequently passed on that exact head, including all four Web
test shards and the final release gate. PR 3127 is Ready; enrollment remains off.

## PR 2 implementation progress

The private Better Auth 1.7.3 owner now has a closed encrypted adapter, bounded
retention, atomic rate-limit storage, explicit transport classification and
credential-read-only legacy principal resolution. Auth-user presence is the
monotonic handoff marker; imported credentials retain a null credential-change
date until a new authority mutation, avoiding another migration-state table.

OTP completion uses one database-only transaction for consumption, canonical
member/contact writes and session creation. Wrong-code attempts commit their
budget; failures after proof roll back consumption and all writes. Signup pins
the auth-user ID to the prepared canonical member. Imported users require
independent provider/canonical agreement and exact source revalidation.
Previously handed-off users never refresh credentials from Privy.

Resend and verification share an OTP-identifier lock. The route owner stages
generation in a short transaction, keeps one current code, then delivers after
commit. This accommodates the pinned phone plugin's duplicate-identifier insert
behavior without weakening storage uniqueness or doing delivery under locks.
Session primary-auth time is independent from renewal and silent migration.

The composed proofs now include the actual public browser/native OTP routes,
canonical signup metadata, pending text-first email claims, mismatched/expired
invites, same-member native exchange using real signed JWTs, and native session
read/renew/logout during an issuance pause. Mixed browser-cookie proof shows
that old sessions continue, the replacement selects its verifier exclusively,
and logout revokes both. Protected commit guards reject stale or revoked auth
snapshots without provider calls under locks. Old Privy session issuance is
fenced after handoff; cross-member phone retirement was removed.

All native product routes now use the shared member-auth boundary. New native
admission reuses product bootstrap, consent and Starter owners. Legacy native
admission stays read-only after global activation or per-member handoff; pausing
issuance cannot restore old writers. The Ops importer is bounded to five members
per keyset page, defaults to dry-run and reports closed private outcomes.

PR 2 is the deployable backend compatibility boundary with issuance off.
Telegram primary login, new credential controls and web/native activation move
together in PR 3 so no member is handed off before the replacement UI is usable.
The importer already reconciles numeric Telegram bindings for same-member native
exchange; it does not expose Telegram login. Actual native SDK replacement,
app-store/device qualification, credential mutations/recovery and full retirement
remain unfinished goal scope. The rollout owner names these activation gates.

PR 2 focused proof passes: 34 real-PostgreSQL adapter/member cases, 641
regular regression cases across the final affected-file reruns, and the separate
nine-case action-approval database suite. Web typecheck, changed-file lint,
complexity, documentation drift and added-line privacy checks pass. Parent
candidate review confirms the backend stays inactive until PR 3. PR 3128 is
open, stacked on PR 3127. A local HTTPS public-route fixture reproduced a cookie
namespace mismatch; writer and readers now share the environment naming rule,
with production secure-cookie proof retained. Final exact-head CI and ReviewGPT
remain. No PR 2 deployment or production import
has occurred. Local member crypto/KMS ports are synthetic; actual installed Better
Auth, PostgreSQL, pre-auth AEAD and signed JWT/WebAuthn fixtures provide boundary
proof, not hosted delivery or real-device qualification.


## PR 2 review remediation

The valid first substantive review at dd276e29cd708954f0d8c8ab31d804a8d2695440
identified three high-impact bugs. All were independently reproduced and accepted:
new email signup lacked the canonical identity required by product completion;
pristine referral targets were omitted from OTP member selection; and concurrent
session renewal or a storage deletion failure could produce false-success logout.

The email owner now creates the missing identity scaffold through the existing
writer. Invite selection retains claimability, expiry, contact conflicts and
member-locked revalidation. The logout owner verifies the signed credential and
uses authenticated adapter deletion with three bounded attempts for ciphertext
conflicts; other failures propagate. No new persisted state or weaker guard was
introduced. Tests exercise actual product completion, real referral allocation,
and both public logout routes. The prior logout implementation fails all four
race/storage regressions.

Two composed native-auth fixture suites now follow the shared verifier and
preserve the original identity-verification/member-lookup stage boundaries. The prior OpenAI peer resolution was restored, but CI proved that it was not
the bundle-size cause. The second substantive review passed on
`ae758d69d46cc680f88fb86ebdc25126cd505236`; all application checks passed on that
head, while the independent runner budget remained failing. Focused checks pass:
40 PostgreSQL cases, 119 affected native-route regressions, Web typecheck,
changed-file lint, documentation drift and complexity.

The standalone runner seed included registry versions used only by the Web app.
Adding Better Auth therefore moved its existing Zod resolution from 4.4.3 to
4.5.4 and grew the CLI by 153704 bytes. The installer now asks the pinned pnpm
CLI for the runner's production lockfile graph and limits seed package records
to that closure. Source manifests, dependency versions and size budgets stay
unchanged. Real assembly reproduces the original CLI size of 10053128 bytes,
passes both absolute budgets and all eight command-parity probes. Focused
installer tests and Cloudflare typecheck pass. This tooling correction requires
a third exact-head review and CI before PR 2 is mergeable.

Tooling retries did not advance the review counter. The invalid first capture
requested missing installed dependency source. A plaintext-source staging retry
failed before send. The successful retry included the complete compressed,
hash-verified Better Auth 1.7.3 dependency source and the guarded repository ZIP.
The completed response came from the requested Pro model and inspected both
repository and decoded dependency contracts. No deployment or activation occurred.

## PR 3 implementation progress

The Telegram login owner now verifies the numeric profile ID, issuer, audience,
nonce, signature and expiry. A five-minute browser-bound nonce is consumed with
canonical member selection and private Better Auth session issuance in one
database-only transaction. Existing imported accounts cannot be resurrected
from messaging routing after removal. New and referral members retain canonical
identity and onboarding owners. Six PostgreSQL journeys pass, including a
forced session-write failure followed by retry of the same proof; ten signed
token cases and Web typecheck also pass. The new native OTP response carries
the issued session expiry so apps can durably store it without a second read.

Web client adoption, credential controls, first-factor setup/recovery, and
native implementations remain in progress. Native work uses isolated checkouts;
the transition must preserve the installation's existing member key only after
same-member server exchange, store the first-party session in platform secure
storage, retain SDK restoration until that write succeeds, and never fall back
to SDK credentials after first-party rejection. No PR 3 deployment or activation
has occurred. PR 2 review remediation remains owned by its earlier checkout.


The iOS transition now uses one host-private Keychain record for the first-party
credential and its retirement marker, preserving the existing local member key
after same-member exchange. The temporary SDK adapter only restores, refreshes
and signs out existing sessions. Fixed native HTTP routes replace new SDK login.
Lost exchange responses, unavailable secure storage, expired/offline sessions,
rejected replacement credentials and late renewal after sign-out have focused
proof. The initial continuity run passes 344 tests; the subsequent HTTP,
Keychain, configuration and diagnostics run passes 73 tests. These include real
Simulator Keychain persistence and exclusion of Messages-group lookalikes.
Xcode build and SwiftFormat checks pass. Physical-device/provider qualification
and native exact-head UI evidence remain release/review work.

Infrequent phone/Telegram changes reuse secure web account settings through an
ephemeral browser session. No credential enters the callback URL, and returning
only triggers canonical admission. The web counterpart and first-factor setup,
credential controls, recovery and full web adoption are still being implemented.
Android adoption remains outstanding. Three closed first-party diagnostic codes
are accepted by the existing backend owner; all 115 companion route cases and
Web typecheck pass. Native and backend PR 3 remain uncommitted and unactivated.
The adoption checkout now includes PR 2's runner correction at
ca1c6a115aaf050df78a939c77f0590f0737e995. Its verified gpt-6-pro round 3 review passed with no qualifying findings (response SHA-256 d48d9a2295d210e492327ff351e99801552f203df61929e074ae4f2ebf83a306), and all required exact-head CI checks are green. PRs #3127 and #3128 merge cleanly with their declared bases; #3128 is Ready with issuance off.


Initial approval enrollment now has a bounded first-party path for newly
unprotected accounts only. It reuses the existing challenge and encrypted
credential owners and requires primary proof within five minutes, no legacy
identity and no established factor. Silent exchange, stale/future primary proof,
other sessions, revocation and concurrent first enrollment are covered through
actual OTP/public routes and real PostgreSQL/WebAuthn fixtures. The final
38-case PostgreSQL run passes, including the existing ten-case approval boundary
suite and explicit legacy-binding rejection. The client now selects initial
setup from a server hint, keeps existing-factor enrollment, and opens login when
primary proof is stale. Focused client tests and Web typecheck pass; rendered
evidence and credential-control/recovery flows remain outstanding.

Credential controls use the existing canonical contact/routing writers and
sensitive-action challenge owner. Each approval binds the exact method, old
identity, new identity, operation, member and browser session. New contact proof
is consumed with canonical/projection writes and approval acceptance. Adding a
method preserves existing sessions; replacing/removing one revokes other
sessions and fences legacy native credentials, while keeping the authorizing
first-party browser session. This is a security change, distinct from migration.
The last usable sign-in cannot be removed. No automatic account merging or
provider-token retention is introduced. Code delivery and crypto preparation
remain outside transactions. Tests must prove matching canonical readback,
rollback/retry, stale approval, competing owners and revocation races.


Credential verification now passes 43 canonical-member PostgreSQL cases and ten
Telegram PostgreSQL cases, plus the existing ten approval PostgreSQL cases and
ten real signed Telegram-token cases. These cover target/session binding,
competing owners, last-method preservation, email alias rotation, concurrent
completion, failed commit rollback/retry, cross-purpose Telegram proof, imported
native continuity, cross-format revocation and durable channel wakes despite
signaling failure. A mixed-case canonical email initially rejected its normalized
login projection; normalization at the agreement check fixes that reproduced
case without relaxing ownership. Web typecheck passes.

The main dialog and invite entry now share first-party phone/email/Telegram
login. Code preloading does not start authentication. Confirmed login moves to
retryable product completion, preserving consent/checkout behavior without
repeating OTP. Telegram opens synchronously from its click with a prepared nonce;
blocked/canceled popups and late callbacks are bounded. Credential changes use
explicit approval and refresh canonical state after uncertain commit responses.
The old homepage runtime wrappers and join provider bootstrap were removed.
Settings and invite models no longer wait for provider account display hints.

The independent `/settings/accounts` route reuses connection and passkey controls
without the dashboard's subscription redirect. This is the native browser
counterpart and unfinished-signup messaging entry. Its fixed iOS/development
return links carry no credential; login resumes the page and native admission
remains the only completion authority. The shared code form preserves normalized
contact/code ownership through autofill, resend, duplicate actions and unmount.
Hourly visible-browser renewal calls the existing fixed endpoint; a PostgreSQL
regression proves the legacy session row and response cookies remain unchanged.

The focused Web client/invite/settings run passes 160 tests. Account-page and
AuthProvider continuation proof passes 42 further tests; the canonical-member
43-case PostgreSQL suite and Web typecheck pass after the renewal regression.
The earlier combined backend/client suite passed 155 tests. These runs overlap
and must not be added as a distinct-test total. Complexity passes all 55 changed
source files, reducing existing dialog, invite-model and Settings debt. Full
rendered journeys and candidate review remain outstanding.

PR 3 remains Hold and is not activated. Required follow-up includes legacy-factor
reauthentication independent of the new primary-login dialog, operational
independent recovery without a primary-OTP downgrade, removal of legacy logout
and remaining production entry dependencies, native qualification/Android work,
and exact-head UI/CI/ReviewGPT evidence. First-party passkey controls still share
legacy SDK hooks pending that separation. Deploy the completed PR 3 UI together
with enabled issuance after reader/recovery qualification; an issuance pause
keeps the first-party UI and compatible session readers. Do not import or widen
while these user journeys are incomplete. This is an intermediate checkpoint,
not the final candidate or a claim of production continuity.

First-party approval now has no SDK hooks, and account settings omit the legacy
provider for initial or established Murph passkeys. The temporary wallet port
restores an existing factor for the server-selected legacy principal, checks it
again after wallet loading, and refuses missing-factor creation during approval.
Legacy setup has a separate provider dialog and canonical member checks before
provider changes; neither operation completes primary login or replaces the
Murph session. Missing or invalid server-selected approval methods fail closed.

The final focused follow-up passes 154 cases across eight client and real
PostgreSQL suites. These include wrong restored accounts, changed accounts
during wallet loading, first-party ownership blocking legacy setup, no fallback
after passkey rejection, and server-owned principal selection. Web typecheck,
changed-file lint and complexity pass. Real-device provider restoration,
independent recovery, remaining legacy entry/logout cleanup, native work and
candidate UI/CI/ReviewGPT remain Hold. The earlier hook-separation and legacy
reauthentication implementation gaps are closed; this is still an intermediate
checkpoint and no deployment or import has occurred.

Production sign-out now waits only for confirmed server revocation and refreshes
the canonical page; the legacy SDK cleanup component is deleted. Canonical
account deletion navigates directly to the farewell, retaining the durable
cleanup status. Approval and data-privacy pages omit the SDK for migrated
factors; an optional factor-read outage leaves the decision/deletion surface
available, while the action endpoints retain authorization authority.

The focused sign-out/privacy run passes 57 tests, and the approval/Settings page
run passes 79 tests. Web typecheck, changed-file lint and the five-source-file
complexity check pass. The cleanup adds no persisted state or dependencies.

Independent saved-key recovery now reuses the approval aggregate and one-use
challenge owner. One nullable column holds a member/field-bound encrypted
SHA-256 digest of a random 32-byte key. A current Murph passkey authorizes
generation; fresh first-party primary proof plus the previously saved key
authorizes a new user-verified passkey. The short commit replaces all old
approval credentials, consumes the key/challenge, revokes other sessions and
fences legacy native admission. Generation preserves sessions. This adds no
service, session format, permit ledger, or contact-only support override.

Settings exposes explicit create/save and recover controls. Keys remain in
dialog memory, closing aborts further submission, late WebAuthn results cannot
commit after dismissal, and uncertain commits refresh canonical state without
automatic replay. The nullable-column migration was applied only to the
isolated local task database. Existing members who lost every legacy factor
before migrating remain an explicit retirement exception; no OTP downgrade is
introduced to make that inventory appear complete.

Recovery proof passes all 54 canonical-member PostgreSQL cases, including real
WebAuthn, wrong/moved/rotated proof, simultaneous redemption, failed database
commit with safe retry, stale/silent/suspended primary authority, and imported
native/browser revocation. Seventeen focused client/enrollment cases pass. The
ten-case existing approval PostgreSQL suite and ten schema/privacy checks pass.
These totals overlap earlier runs. Web typecheck, changed-file lint and the ten
changed-source complexity check pass. Full rendered journeys, final candidate
review, Android/native qualification and retirement work remain outstanding;
PR 3 is still unactivated.

## PR 3 browser proof

Six Chromium journeys pass across phone and desktop widths. Real login controls
accept phone/email codes, focus OTP input, and preserve a confirmed login when
product loading fails; an explicit retry repeats completion without another
code. Public navigation and opening login load no Privy SDK. API responses in
this browser lane are synthetic; PostgreSQL tests own authentication proof.
The inert design study uses the production settings presenter with a static
referral action, so it makes no account request. Stacking connection actions on
phones keeps addresses readable. Selected synthetic images were inspected at
native resolution. Web typecheck, the verified-contact/last-method regression,
changed-file lint and full PR complexity guard pass; no new hotspot exceeds 20.

The broader public-loading run also reported a recoverable server-render error
on the unchanged experiment library. The same error reproduces on the clean
parent branch in its existing public-auth smoke test, which still passes.
Recorded this existing diagnostic gap through Frog. No authentication failure
appeared in the six journeys. Final review, exact-head CI, native qualification
and retirement remain outstanding.

The Web adoption candidate is PR #3132, stacked on #3128. Its release note uses
the existing archive renderer; all ten fragment/page cases and Web typecheck
pass. Public preview and final review are being prepared on the stable candidate.
