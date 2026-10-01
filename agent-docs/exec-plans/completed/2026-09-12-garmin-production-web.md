# Build Web before starting the live wearable stack

Status: completed
Created: 2026-09-12
Updated: 2026-09-12

## Goal

Remove development-time Web compilation from the live wearable full-stack proof.

## Success criteria

- Live wearable preparation completes a production Web build before starting the stack.
- Build and runtime use the same isolated smoke output directory.
- Provider authority remains limited to the isolated test child.
- Focused sequencing, failure, package-boundary, and startup checks pass alongside typechecks.
- Protected-main Garmin proof still requires connection, persisted state, canonical data, and cleanup.

## Scope

In scope: E2E preparation, a Web-owned build wrapper, the existing foreground process export, focused proof, and verification documentation.
Out of scope: product auth, provider consent semantics, production deployment, new infrastructure spending, or larger timeouts.

## Constraints

Reuse production build memory limits, smoke environment defaults, and production startup selection. Keep credentials out of generic build processes and preserve hermetic suite preparation.

## Risks and mitigations

- Production compilation may expose fresh-checkout prerequisites: run a real build after the existing dependency preparation.
- Production startup may differ from development behavior: exercise the existing full-stack device-connect suite with the prepared output.
- Resource pressure may have additional causes: require a protected provider run before claiming Garmin recovery.

## Tasks

1. Add serialized live wearable Web preparation using existing owners.
2. Verify ordering, failure admission, private environment partitioning, and package resolution.
3. Build and exercise production startup with synthetic local data.
4. Review, commit, run exact-head CI and ReviewGPT, then merge and observe the protected canary.

## Decisions

- Compile before the full stack starts instead of running Turbopack during browser navigation.
- Export the existing foreground process helper directly so Web tooling does not import the whole harness graph.
- No changelog: internal verification execution only; no member-facing behavior changes.

## Verification

- E2E preparation suite: 35 tests passed.
- Production Web build: passed, including Web TypeScript checks and emitted asset checks.
- Prepared production Web with `pnpm hosted-local e2e device-connect`: 11 passed, three live-provider cases skipped; suite cleanup completed.
- Focused preparation and stack tests: 120 passed. Package boundary: two passed. Harness typecheck, changed Web script lint, frozen lockfile validation, and docs drift: passed.
- Complexity guard: passed, no functions above 20; source maximum remains 15 in the suite owner and two in the build wrapper.
- Parent candidate review: passed; existing process ownership, environment partitioning, auth, and canonical ingestion contracts preserved.
- Broad diff-aware verification is running. Exact-head CI, final ReviewGPT, and the protected-main Garmin run remain delivery gates owned by this session; local synthetic proof does not establish provider recovery.
Completed: 2026-09-12
