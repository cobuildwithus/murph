# Retire gateway projections and event polling

Status: completed
Created: 2026-09-10
Updated: 2026-09-10

## Goal and invariant

Remove the unused gateway projection/event subsystem completely while preserving
shared route, message-delivery, and opaque-id behavior. The gateway package is
public: the removal is intentional and requires the next shared major release.

## Ownership and evidence

Gateway core owns the removed in-memory snapshot/query/diff and polling helpers.
Repository-wide symbol searches found only gateway and CLI tests consuming them;
production consumers use retained route and delivery contracts. No canonical or
hosted persisted state is changed. External usage cannot be inferred from local
non-use, so the README documents the breaking export change and migration choice.

## Scope

Delete implementations, event/snapshot/poll/wait schemas and types, and obsolete
tests. Update live architecture and audit guidance. Preserve conversation,
message, attachment, permission, route, send, and opaque-id contracts. Other
retirements are separate PRs. Custom inference, Clinical Records, and group
missions are excluded from the overall retirement work.

## Product UX

Internal package/API change; no member UI or hosted conversation change.
External package consumers must remove the retired integration or remain on the
previous major. No compatibility layer or substitute state owner is introduced.

## Deployment and failure

No runtime migration, production mutation, or cross-plane protocol changes.
Release only via the existing shared major workflow; already published versions
remain available. Retained public imports and route behavior provide regression
proof. Release execution is outside this PR request.

## Tasks

1. Remove obsolete implementation, exports, contracts, and tests.
2. Run gateway coverage, gateway typecheck/build, retained CLI gateway tests,
   applicable consumer typecheck, and complexity diff; inspect the full diff.
3. Close plan, commit, push draft PR, mark Ready after focused proof, and start
   required ReviewGPT concurrently with exact-head CI.

## Verification

- Gateway test:coverage: 15 tests passed; 97.44% statements, 91.81% branches,
  100% functions. Retained routing, opaque identifiers, and schema tests pass.
- Gateway typecheck and build passed.
- CLI gateway integration: 12 tests passed, including the built package import.
- Operator-config consumer typecheck passed.
- complexity:diff passed; no remaining changed-file hotspots above 20.
- Full candidate diff, exported symbol consumers, and privacy checked. No new
  state, runtime authority, dependencies, or member-visible behavior.
- Changelog not applicable: internal unused package subsystem removal; public
  API migration is documented in the package README.
- PR CI and ReviewGPT are pending after this implementation commit.
Completed: 2026-09-10
