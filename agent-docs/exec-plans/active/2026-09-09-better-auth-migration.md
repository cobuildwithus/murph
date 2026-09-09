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
Current verdict: PR 1 local journeys Ready; external candidate review and CI pending. Later stages remain Hold.

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

Remaining verification: focused Web tests/typecheck, real cryptographic assertions and Postgres races, rendered approval journeys, actual native tests/device qualification, dependency guards, complexity review, exact-head CI and final ReviewGPT. No passing runtime proof is claimed yet.

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
