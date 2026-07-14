# Clinical Records Runtime Activation

Status: completed
Updated: 2026-07-13

## Goal

Land the dormant Clinical Records hosted-runtime consumer before the web control
plane begins producing `clinical-records.sync-requested` mailbox work. The
runtime must accept only the credential-free PR-1 contract, fetch bounded pages
through the signed web-control port, import through the existing vault use case,
and record a bounded outcome without moving provider credentials or patient
identifiers into runtime state.

## Constraints

- Build on the merged Clinical Records contract/import foundation from PR #581.
- Do not add the web producer, SMART credential authority, provider directory,
  member UI, or assistant connect-link bridge in this lane.
- Activate the mailbox kind only together with its exhaustive runtime routing.
- Keep Cloudflare as transport/fence proof, assistant runtime as orchestration,
  and `packages/vault-usecases` as the canonical import composition owner.
- Preserve one-way public workspace imports and avoid raw FHIR persistence,
  logging, error serialization, prompts, or Temporal state.

## Persisted State Classification

This lane adds no canonical hosted product store. It imports bounded raw FHIR
pages into the existing encrypted vault-owned Clinical Records paths and uses
existing runtime/mailbox/checkpoint state only for execution and recovery.

## Implementation

1. Transplant the preserved runtime execution and response-budget commits onto
   current `origin/main`.
2. Reapply current-main's deliberate activation boundary: add the Clinical
   Records kind to active mailbox/runtime unions only with the exhaustive
   assistant-runtime consumer present.
3. Resolve current-base conflicts without pulling in the web control plane or
   later UI/assistant bridge.
4. Run focused package/app tests, typechecks, dependency/boundary/cycle and
   privacy/logging guards, then the required completion audits and acceptance.
5. Finish the plan, push a draft PR, and run ReviewGPT on the exact PR head in
   parallel with CI.

## Verification

- Focused hosted-execution, assistant-runtime, vault-usecases, and Cloudflare
  Clinical Records tests.
- Affected package/app typechecks and `pnpm test:diff` for the exact touched
  paths, followed by the required acceptance lane for the trust boundary.
- Dependency, workspace-boundary, package-cycle, raw-health-log, diff, secret,
  identifier, and prohibited-cast inspection.
- Security/privacy and coverage-write completion passes plus parent diff review.

Completed evidence:

- Focused Clinical Records contract, hosted-execution, assistant-runtime,
  vault-usecases, and Cloudflare suites passed. The final changed-test rerun was
  9/9 Clinical Records, 44/44 hosted-execution, and 21/21 assistant-runtime.
- Clinical Records coverage passed at 83.03% branch coverage; the focused
  assistant-runtime coverage-write pass reached 97.91% line and 94.82% branch
  coverage for the new orchestration module.
- Typechecks passed for Clinical Records, hosted-execution, assistant-runtime,
  vault-usecases, and Cloudflare.
- Dependency policy, public workspace boundaries, package cycles, raw-health
  logging, hosted crypto, hosted Temporal, diff, identifier, secret-shape, and
  prohibited-cast checks passed.
- The security/privacy review found no medium-or-higher issue after tracing
  mailbox ownership, signed callbacks, write fencing, bounded retrieval,
  validation-before-persistence, replay behavior, and public dependency flow.
- The full acceptance fanout proved the task-local packages and web tests but
  also hit unrelated existing long-test timeouts and generated-artifact races.
  Targeted reruns preserved the same two unrelated 60-second runtime/core
  timeouts; the isolated CLI health-tail check passed. CI remains the clean
  serialized acceptance authority for the pushed head.

## Deployment Compatibility

Deploy this consumer/runtime bundle before the later web control-plane producer.
With no producer on the old web build, the new runtime path is dormant. After
this runtime is converged, the additive web migration/control plane may safely
emit the activated mailbox kind. Roll back the web producer first; do not roll
the runtime below this activation floor while matching mailbox work can remain.

## Deferred

- SMART OAuth and provider-egress control plane in `apps/web`.
- Member-facing connection UI and assistant connect-link bridge.
- Scheduled refresh and additional provider families.
Completed: 2026-07-13
