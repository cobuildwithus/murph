# Replace Privy with Better Auth through staged rollout

Status: active
Created: 2026-09-09
Updated: 2026-09-09

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
