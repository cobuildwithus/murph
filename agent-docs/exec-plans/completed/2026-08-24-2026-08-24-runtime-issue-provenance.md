# Correlate assistant runtime issues with deploys and attempts

Status: completed
Created: 2026-08-24
Updated: 2026-08-25

## Goal

- Make every newly captured hosted assistant-runtime issue queryably attributable
  to the exact runtime attempt and public runner release that created it, so
  connection-loss reports can be correlated with runner recovery and deploys
  without inspecting member data or replaying partial tool activity.

## Success criteria

- New hosted issue records carry a trusted occurrence-attempt id, the stable
  Cloudflare hosted-runner name, and the exact public repository release SHA
  embedded in the deployed runner bundle.
- Web persists those three fields in typed, nullable columns; legacy issue files,
  export payloads, and database rows remain readable with null provenance.
- Provenance is supplied by the container/runtime boundary, never by the model,
  issue details, or a later export attempt.
- Focused parser, capture, runtime propagation, bundle-manifest, and Web import
  tests pass together with touched-package typechecks and Prisma validation.
- The candidate is committed, pushed to a draft PR, reviewed by the required
  preliminary specialist and final ReviewGPT gates, and green on required CI.

## Scope

- In scope: runner-bundle release metadata; hosted invocation provenance
  propagation; assistant issue record parsing/capture; Web schema, migration,
  import, and query index; focused tests and durable runtime/deploy docs.
- Out of scope: replay or recovery policy, partial-tool replay, member identity,
  raw issue payload expansion, production backfill, and unrelated runtime-log
  provenance.

## Constraints

- Technical constraints: preserve the v1 issue schema and nullable legacy
  compatibility; keep provenance server-attested and bounded; never use a
  Cloudflare version UUID or a private deployment-repository SHA as
  `releaseSha`; bind attempt identity at issue occurrence rather than export.
- Product/process constraints: metadata only; no member identifiers, secrets,
  raw payloads, screenshots, or production row contents; use the sanctioned
  worktree/PR lane and required high-risk completion gates.

## Risks and mitigations

1. Risk: a pending issue is exported by a later invocation and receives the
   wrong attempt id.
   Mitigation: stamp the record from the authenticated invocation request when
   it is created and preserve that value through later export retries.
2. Risk: deploy metadata is mislabeled as a public source release.
   Mitigation: embed the exact public checkout commit in the runner bundle at
   build time and reject malformed/missing production manifest metadata; keep
   the runtime name a documented stable identity.
3. Risk: mixed-version deploys make old pending files or old database rows
   unreadable.
   Mitigation: add only nullable fields, keep the issue envelope/schema version,
   and cover legacy records with focused tests.
4. Risk: provenance accidentally becomes model-controlled or carries private
   content.
   Mitigation: keep it out of `AssistantRuntimeIssueInput`, normalize it only
   from the hosted execution context, and persist only bounded identifiers.

## Tasks

1. Add and validate public release SHA metadata in the runner bundle manifest.
2. Propagate trusted release/runtime identity and occurrence attempt through the
   container invocation and assistant execution context.
3. Add nullable provenance fields to issue records and persist the occurrence
   attempt in Web with a focused correlation index.
4. Add focused regression coverage for legacy compatibility, capture,
   propagation, manifest validation, and Web import.
5. Update the durable hosted-runtime/deploy contract, run focused verification,
   inspect privacy and diff shape, and create the scoped review candidate.
6. Open the draft PR, run the preliminary and final ReviewGPT gates on the exact
   pushed head, resolve their outcomes under the required pause boundary, and
   confirm required CI.

## Decisions

- The issue occurrence attempt, not the export attempt, is canonical because a
  pending record can survive an export failure and leave on a later invocation.
- `releaseSha` is the exact public checkout commit embedded in the runner
  bundle. Cloudflare version ids and deployment-workflow SHAs are not accepted
  substitutes.
- `runtimeName` is the stable `cloudflare-hosted-runner` identity; release
  versioning remains in `releaseSha` rather than overloading the name.
- A source checkout is release-attributable only when it is clean. Local dirty
  assembly writes a null SHA for honest diagnostics, while production deploy
  validation rejects that manifest before upload.
- Runtime attempt ids use the existing strict identifier grammar rather than
  free-text/phone redaction, which can corrupt production-shaped UUID values.
- Accepted preliminary/final review findings are covered at the existing seams:
  real image occurrence capture and pending/export retry preservation, exact
  release-only smoke skew, and smoke-result release passthrough. No replay or
  lifecycle owner was added.

## Verification

- Commands to run: focused Vitest lanes for runtime-state, assistant-engine,
  assistant-runtime, Cloudflare runner/container and deploy-artifact owners, and
  Web runtime-issue import; touched-package typechecks; Prisma format/validate;
  migration/schema guards; privacy/diff inspection; PR-head preflight; required
  preliminary/final ReviewGPT commands; exact-head GitHub checks.
- Expected outcomes: new records persist all provenance fields, old records
  parse/persist with nulls, export retries retain the original attempt id,
  malformed release metadata fails closed, no private identifiers or payloads
  enter the diff, both review gates resolve with zero accepted findings, and
  required CI is green on the final head.
- Remediation proof: Cloudflare focused tests passed 293/293; Web import passed
  4/4; runtime-state passed 6/6; assistant-engine passed 21/21; image generation
  passed 4/4; hosted issue retry/export passed 5/5; and the exact workspace
  export case passed. Cloudflare, assistant-runtime, assistant-engine,
  runtime-state, and full Web typechecks passed. One broader assistant-runtime
  run completed 660 tests and hit one unrelated mixed-mailbox timing timeout;
  the changed export case passed independently.
Completed: 2026-08-25
