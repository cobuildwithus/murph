# Prepare the OpenAI-only production rollout

Status: completed
Created: 2026-10-07
Updated: 2026-10-07

## Goal

- Preserve ordinary replies and model-setting updates while independently
  deployed Web, Worker, and runner versions cross the OpenAI-only boundary.
- This plan owns the compatibility correction and rollout instructions. Protected
  deployment and migration results are recorded separately with the PR.

## Success criteria

- Existing runners accept the new Worker's mailbox response.
- New runtimes accept old Web configuration responses without exposing or
  enabling retired providers, and still reject retired update arguments.
- Focused mixed-version proof and typechecks pass. Exact-head CI and final
  ReviewGPT remain the protected delivery gates after this preparation.

## Scope

- In scope: the existing mailbox serializer, configuration response reader,
  their regression tests, and the deployment owner instructions.
- Out of scope: new admission controls, provider selection, inference adapters,
  persisted compatibility state, and changes to the retirement migration.

## Constraints

- Keep Web as configuration owner and existing native release convergence as
  the image-drain authority. Idle database owners do not prove native stop.
- Hold Web promotion and automatic contract migrations until consumers converge.
- Never retrieve production credentials locally or bypass deployment checks.

## Risks and mitigations

1. Existing runners require a mailbox discriminator that the new Worker removed.
   Preserve the fixed OpenAI value at that wire boundary during replacement.
2. Old Web includes retired response keys that the new strict reader rejects.
   Accept and discard those two keys; keep returned data and update inputs
   OpenAI-only and preserve rejection of other unknown keys.
3. A timed Web drain does not establish runner convergence. Use the protected
   deployment receipt and completed native rollouts before Web promotion and
   destructive migration; do not invent an unsupported fleet pause.

## Tasks

1. Reproduce both failures with synthetic payloads and the shipped readers.
2. Apply the two boundary corrections and run focused tests and typechecks.
3. Replace the unavailable quiesce instruction with a proven consumer-first
   sequence and explicit compatibility removal conditions.
4. Review, commit, and publish the correction; complete exact-head CI and
   ReviewGPT before operational deployment.

## Decisions

- Extend the existing boundaries for currently deployed readers. No new owner,
  lifecycle, dependency, or generalized compatibility framework is needed.
- Provider fields remain transport compatibility only and cannot select a model
  backend. Remove the bridge after old Web and runner readers have drained and
  rollback no longer requires those wire shapes.

## Verification

- Both legacy configuration read/update regressions failed before the fix;
  all 39 hosted-execution contract tests and package typecheck pass afterward.
- Configuration mixed-version matrix: 40 cases using exact shipped/current
  readers; two retired-provider write rejection checks pass.
- Cloudflare mailbox/payload tests: 28 pass. The real decode fixture also passes
  23 tests with the exact shipped parser loaded from Git in memory.
- Cloudflare app typecheck: passed after generating the current Prisma client.
- Existing usage-blocked delivery regression: passed.
- Docs drift/gardening and complexity guard: passed; two source files, no debt
  increase or functions above 20.
- Final CI and ReviewGPT own broad PR and cross-owner completion proof.
Completed: 2026-10-07
