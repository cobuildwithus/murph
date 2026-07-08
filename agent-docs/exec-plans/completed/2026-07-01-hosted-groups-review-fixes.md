# hosted-groups-review-fixes

Status: completed
Created: 2026-07-01
Updated: 2026-07-01

## Goal

- Land the two accepted deep-review findings against merged PR #356 (hosted groups join flow):
  1. `murph.group` gains a `create_join_link` action so a hosted thread-container runtime can actually mint the group join link the PR promised, and the dead app-session join-link route is deleted.
  2. `acceptHostedGroupJoinCodeTx` revalidates the durable group-runtime authority before creating membership, independent of whether the joiner selected any vault-share permissions.

## Success criteria

- A hosted runtime can call `murph.group` with `action="create_join_link"` and receive a public join URL plus bounded group summary; authority binds runtime member -> `HostedThreadContainer` row -> `ownerMemberId`, with active runtime access revalidated.
- Joining with an empty `selectedVaultShareProjectionKinds` list against a group whose runtime is missing or inactive fails closed instead of creating membership.
- The unused app-session route `POST /api/groups/thread-containers/[containerMemberId]/join-link` and its test are removed.
- Focused tests cover the new tool action (parser, web handler, dynamic-tool schema) and the accept-path regression.

## Scope

- In scope: `packages/hosted-execution` runtime-control contract + parsers, `packages/assistant-engine` dynamic tool schema/prompt guidance, `apps/web` hosted-groups group-tool handler and group-store accept guard, matching tests.
- Out of scope: join page UI changes, vault-share delivery flow, family-plan tool, PR #354 preemption work.

## Constraints

- Technical constraints: keep one join-link write path (`createHostedGroupJoinLinkForOwnedThreadContainerTx`); no new state owners; expected non-success states return typed `unavailable` results instead of thrown transport errors.
- Product/process constraints: group membership stays separate from health sharing; join links expose only bounded group metadata.

## Risks and mitigations

1. Risk: always-asserting runtime authority on join could block a legitimate join flow for groups without runtimes.
   Mitigation: join codes are only minted through the thread-container path, which guarantees a runtime-bound group; regression tests prove both the fail-closed and happy paths.

## Tasks

1. Extend `HostedRuntimeGroupTool*` contract types and parsers with `create_join_link`.
2. Implement `create_join_link` in `handleHostedRuntimeGroupTool`; delete the app-session route + test.
3. Extend `MURPH_GROUP_TOOL` schema, `parseGroupArguments`, and hosted-group prompt guidance.
4. Always-assert runtime destination in `acceptHostedGroupJoinCodeTx` before membership creation.
5. Add/extend focused tests; run scoped verification.

## Decisions

- Reuse the existing owned Tx primitive for minting; actor is derived server-side from the durable container row, not from tool input.
- Delete rather than keep the app-session join-link route: no UI calls it, and the tool path is now the owner.

## Verification

- Commands to run: `pnpm test:diff <touched paths>`; fallback owner lanes: `pnpm --dir packages/hosted-execution test`, `pnpm --dir packages/assistant-engine test:coverage`, `apps/web` bucket tests for hosted-group files.
- Expected outcomes: green focused suites; typecheck clean.
Completed: 2026-07-01
