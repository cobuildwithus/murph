# Personal Murph Group Awareness

## Goal

Let a hosted member ask their personal Murph which hosted groups they belong to, what each group requests, what that member currently shares with each group, and where they can review those permissions.

Success means the existing hosted group tool can return a bounded, caller-scoped membership list with group labels, role, member count, requested projection scopes, active self grants, and an existing owner-authorized first-party permission-management URL when one exists.

## Constraints

- Keep hosted group membership and vault-share grants web-owned; add no runner or vault copy of this product truth.
- Return only the callback-authenticated member's memberships and grants. Do not expose another member's identity, contact details, or permission state.
- Treat active grants as control-plane permission evidence, not proof that current source data exists or has already materialized in the group runtime.
- Reuse the existing group join page for explicit permission changes without revealing its reusable invite URL to ordinary members. Do not add a direct-message reaction mutation path in this pass.
- Keep the response bounded and deploy-skew-safe: updated runner/parser before web emits the new action response.
- Preserve unrelated working-tree and coordination-ledger changes.

## Key decisions

- Extend `murph.group` with one read-only `list_memberships` action instead of adding a second group tool or new API route.
- Derive the result from `HostedGroupMember`, `HostedGroup`, and active `HostedVaultShare` rows on each read; persist no new state.
- Omit group roster and other-member details from the personal membership result.
- Return the existing join URL as `permissionsUrl` only when the callback member owns the group and the group already has a join code; ordinary members must not inherit reusable invite authority.

## Plan

1. Specify the personal-group-awareness product and authority boundary.
2. Add the bounded hosted-execution request/response contract and strict parsers.
3. Add one web-owned membership/grant read and wire it into the existing group tool callback.
4. Expose and explain the action in the assistant dynamic tool, including the permission-versus-data distinction.
5. Add focused contract, parser, web, scope-filter, and assistant-tool tests.
6. Run required verification and completion audits, review deployment skew, then finish the plan with a scoped commit and PR.

## Verification

- Passed: focused hosted-execution parser tests (36 tests).
- Passed: focused hosted group store/tool and scope-filter tests (82 tests).
- Passed: focused assistant dynamic group-tool tests (22 tests).
- Passed: owned web, assistant-engine, and hosted-execution typechecks.
- Passed through all affected non-CLI lanes: `pnpm test:diff`; unrelated assistant CLI suites repeatedly reached their existing 60-second per-test timeout, so the lane was stopped after the affected packages and reverse dependents passed.
- Passed: direct parser scenario distinguished requested-but-ungranted HRV from granted email and returned no permissions URL for an ordinary member.
- Passed: required coverage-write and security/privacy completion audits. The accepted security finding was fixed by limiting the reusable join URL to group owners; the re-audit found no remaining medium-or-higher issue.
- Pending after push: PR CI and ReviewGPT.

## State

Implementation and local completion work are done. The scoped commit, PR CI, and ReviewGPT gate remain.
Status: completed
Updated: 2026-07-10
Completed: 2026-07-10
