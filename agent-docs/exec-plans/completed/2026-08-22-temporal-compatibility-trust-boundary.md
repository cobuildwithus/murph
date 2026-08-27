# Close Temporal compatibility trust and lifecycle gaps

Status: completed
Created: 2026-08-22
Updated: 2026-08-22

## Goal

- Preserve one loud exact-SHA Temporal compatibility status without executing
  public candidate code beside private source or allowing a later blue/green
  worker deployment to outrun the supported-reader policy.

## Success criteria

- Public candidate code runs only in unprivileged public CI and produces a
  run/head-bound serialized fixture artifact.
- Private trusted code exclusively enumerates readers, calculates digests, and
  publishes attestation outputs; fixture bytes cannot influence that control
  channel or read the private checkout.
- The existing private blue/green deploy owner fails before any Render hook or
  Temporal routing mutation unless the public controller targets the exact
  candidate and every still-routable prior reader remains in policy.
- The correction adds no service, queue, database state, deployment-color
  owner, or third-party dependency.

## Scope

- Public Repo Hygiene fixture artifact, trusted workflow-run download and
  dispatch binding, controller tests, and committed controller policy.
- Private serialized-fixture validation, reader attestation, deploy-policy
  preflight, and focused adversarial tests.
- Exact-head CI, ReviewGPT, immutable tag, and live compatibility dispatch.

## Decisions

- Accept the ReviewGPT private-source exposure finding: direct import of the
  public fixture owner inside the private job is removed entirely.
- Accept the stale-controller finding: deployment compatibility is enforced by
  the existing deploy workflow because it already owns routable Temporal state.
- Keep fixture data untrusted. It is expected to describe the candidate wire
  response; only private reader enumeration and proof metadata are trusted.
- Use one small committed public policy record so future deployments have a
  reviewable cross-repository convergence point instead of duplicated mutable
  environment variables.

## Verification

- Malicious fixture payload cannot read a private sentinel, append trusted
  outputs, replace the reader set, or forge its digest.
- Artifact identity is bound to the exact Repo Hygiene run and public head.
- Deployment policy rejects a stale controller candidate and a manifest that
  omits Current or Ramping readers before provider mutation.
- Existing controller terminal paths, private reader matrix, focused
  typechecks/builds, exact-head CI, and both ReviewGPT gates pass.

## Completion

- Public candidate code now executes only in unprivileged Repo Hygiene and
  emits one exact-run/head artifact. The trusted controller canonicalizes and
  hashes it before dispatching serialized data to private CI.
- Private CI no longer checks out or imports public candidate code. Its proof
  digest independently binds the producer payload, public SHA, request id, and
  complete immutable reader set.
- Fixture generation derives every closed blocked-reason and mailbox-frontier
  case from the production constants while preserving absent, null, and
  populated forms.
- The existing private deploy owner validates the committed public
  controller/tag before Temporal setup and verifies Current/Ramping reader
  coverage before any Render or routing mutation.
- Focused producer, controller, workflow-trust, adversarial private reader, and
  deploy-policy tests pass. The public full typecheck also exercised the new
  TypeScript and reported only two unrelated pre-existing workspace-entrypoint
  violations outside this change.
Completed: 2026-08-22
