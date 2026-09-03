# Simplify operator diagnostics to one direct read-only turn

Status: active
Created: 2026-09-02
Updated: 2026-09-02

## Goal

- Let an authenticated Ops diagnostic inspect the exact bound member/group
  workspace and hosted Codex session evidence in one read-only model turn, so
  it always returns a concrete diagnostic instead of inheriting the member
  disclosure path's generic `cannot_answer` outcome.
- Remove the operator-only mode, disclosure reviewer, and group-audience
  assumptions from the consented Assistant Ask path rather than adding another
  diagnostic export, queue, or state owner.

## Success criteria

- Operator diagnostics use one dedicated read-only execution path and one model
  call with an answered-only schema, with the existing authenticated admission, exact runtime binding,
  encrypted result, expiry, and mailbox ownership unchanged.
- The dedicated permission profile reads the bound workspace including
  `.runtime/**` plus only the hosted Codex `sessions` root, while denying env
  files, credentials/config, network, writes, delivery, dynamic tools, MCP,
  apps, plugins, memory, and multi-agent authority.
- Group and consented-member Assistant Ask behavior and its disclosure reviewer
  remain unchanged and still cannot read private runtime state.
- Deterministic tests prove the permission and runtime dispatch boundaries; a
  focused real-Codex synthetic journey proves runtime/session inspection and
  produces a useful answer.
- The production-source shape is simpler than the current operator overlay and
  the durable architecture/security/runtime docs describe the actual boundary.

## Scope

- In scope: Assistant Engine execution composition, hosted permission config,
  detached operator diagnostic dispatch, focused tests, and matching durable
  contracts.
- Out of scope: Ops UI changes, new persisted state, new queues/services,
  member-facing messages, changes to group/member consent, production data
  repair, and diagnosing the original workout turn before the operator read path
  can expose its evidence.

## Constraints

- Technical constraints: keep the native Codex one-shot child, approval policy
  `never`, no network or effect tools, exact host-bound read roots, and existing
  encrypted/expiring result path. Reuse current owners and package entrypoints.
- Product/process constraints: deletion and explicit data flow are the priority;
  no private incident evidence or identifiers may enter source, tests, docs, PR
  text, or ReviewGPT artifacts. ReviewGPT authors the initial patch; the parent
  independently reviews and may shrink it.

## Risks and mitigations

1. Risk: widening a consented group/member disclosure path to runtime-private
   data.
   Mitigation: separate operator execution at the authenticated operator target
   branch and leave every consented/group permission profile unchanged.
2. Risk: exposing Codex auth/config or hosted secrets while making diagnostics
   useful.
   Mitigation: add only the sessions directory as a second root, retain
   inherit-none/no-network/no-write execution, and deny env/config/credential
   paths with deterministic profile proof.
3. Risk: replacing the failed overlay with more architecture.
   Mitigation: no new state owner or protocol; delete the `workspaceInspection`
   mode and obsolete operator disclosure metadata, then use one narrow execution
   function.

## Tasks

1. Package the proven root cause and deletion-first boundary for ReviewGPT, then
   obtain an implementation patch against current `origin/main`.
2. Inspect and apply only the smallest patch that preserves the existing Ops
   admission, mailbox, encryption, expiry, and result contracts.
3. Update deterministic profile/dispatch/engine tests and the focused real-Codex
   diagnostic journey using synthetic workspace evidence.
4. Update the live architecture, security, runtime-protocol, and package docs to
   remove the obsolete operator/group-review assumptions.
5. Run focused tests, affected typechecks/builds, real-Codex proof, complexity
   check, parent review, commit/PR, exact-head CI, and final ReviewGPT.

## Decisions

- Product UX level: Patch.
- Outcome: an Ops user gets a definitive private diagnostic from already
  retained runtime evidence; the member and group receive nothing.
- Reaches: the existing private diagnostic task from authenticated Ops through
  the target runtime to the encrypted Ops-only result.
- Proof: synthetic operator task reads runtime and session evidence, reports the
  diagnosis, cannot mutate or read secrets, and never invokes the consented
  disclosure reviewer or delivery path.
- ReviewGPT authored the initial patch. Parent review removed duplicated docs,
  engine-supplied conversation evidence, the generic `cannot_answer` result,
  obsolete disclosure metadata, and a redundant runtime result-normalization
  branch. No new state owner, queue, persistence format, or dependency remains.

## Verification

- Passed: 16 focused Assistant Engine tests, 128 focused Assistant Runtime
  tests, 8 focused Hosted Execution tests, affected Web/Cloudflare/package
  typechecks, all three affected package builds, workspace-boundary and package
  cycle checks, `git diff --check`, and `pnpm complexity:diff`. The runtime
  router's existing complexity debt decreased by one.
- The focused real-Codex journey is authored and selected correctly, but the
  local subscription refresh token was revoked. It failed before a provider
  request or file access, so no live behavioral claim is made from that run.
- Remaining: exact-head PR CI and final ReviewGPT. Rerun the focused live
  journey after local Codex authentication is restored.
