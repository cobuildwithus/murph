# Frog #2493 ReviewGPT Owner Delivery

Status: completed
Created: 2026-08-29
Updated: 2026-08-29

## Goal

- Return a recovered ReviewGPT response to the exact currently running Codex
  owner without launching a competing nested Codex child.

## Success criteria

- A deterministic regression proves a synchronous wake returns to the exact
  originating session and never selects that route for another session.
- Detached wakes retain their existing fresh-child handoff behavior.
- Direct waited response capture remains the primary completion path and keeps
  its existing atomic response persistence.
- The pinned dependency patch is source-visible, runtime-visible, and covered by
  repository-owned tests.

## Scope

- In scope: the pinned ReviewGPT wake CLI's handoff selection, its shipped source
  and runtime output, focused synthetic coverage, and pnpm patch metadata.
- Out of scope: live browser-profile mutation, nested Codex execution during
  verification, capture-identity rebinding, and unrelated ReviewGPT recovery.

## Constraints

- Preserve exact session equality as the only direct-owner signal.
- Never treat detached execution as synchronous owner delivery.
- Do not change ReviewGPT's browser, response-capture, authentication, or model
  validation boundaries.
- Dependency and lockfile scope requires reviewed human handoff; this repair is
  not eligible for autonomous merge.

## Risks and mitigations

1. Risk: a detached wake inherits the originating session environment and skips
   its intended child handoff. Mitigation: mark the detached subprocess and
   exclude it from direct-owner delivery.
2. Risk: another Codex session receives the result. Mitigation: require exact,
   non-empty equality with the current `CODEX_THREAD_ID`.
3. Risk: consumer-only wrapping creates a second ReviewGPT owner. Mitigation:
   patch the dependency's existing wake CLI through pnpm's reviewed patch
   mechanism and test the installed runtime.

## Tasks

1. Add a focused failing direct-owner/detached-owner regression.
2. Patch the ReviewGPT wake CLI source and shipped runtime.
3. Run focused proof, dependency policy, typecheck, and repository-tooling checks.
4. Commit, push, open a draft PR, and preserve a human-review handoff.

## Decisions

- ReviewGPT `0.5.139` is both the pinned and latest registry version, so there is
  no published upstream release to consume.
- Existing PR #2542 changes only first-turn capture identity and does not repair
  owner delivery. This patch is behaviorally distinct but touches the same pnpm
  dependency-patch owner, so it must remain a serialized human handoff.

## Verification

- Pre-fix focused proof failed all three cases because the installed wake CLI
  had no current-owner delivery selector.
- The repaired installed-runtime regression passes all three cases: exact
  caller delivery, mismatch/empty rejection, and detached-wake exclusion.
- The owning CLI release-script audit passes 48 tests with one intentional skip.
- Frozen install, CLI typecheck, patched-runtime syntax, and diff hygiene pass.
- The complete repo-tools umbrella was not duplicated while another shared
  repository process already owned that exact command; exact-head CI remains the
  broad-suite owner.
- `pnpm deps:audit` reports the repository's existing advisories. The task
  changes no package version or transitive dependency edge.
Completed: 2026-08-29
