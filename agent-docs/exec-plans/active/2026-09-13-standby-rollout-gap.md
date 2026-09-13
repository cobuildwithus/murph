# Shorten deployment standby unavailability

Status: active
Created: 2026-09-13
Updated: 2026-09-13

## Goal

Reduce the interval in which a compatible runner deployment forces fresh
conversation allocations to cold-start. Prefer a small existing-owner change
with a plausible fourfold reduction over more elaborate availability machinery.

## Success criteria

- Obtain and assess the requested ReviewGPT architecture recommendation.
- Implement the smallest supported recommendation with focused tests and typecheck.
- Preserve exact member ownership, pristine readiness, checkpoint safety, complete
  image-pair admission, native convergence, and required deployment smoke proof.
- Open a scoped PR and complete exact-head review and required CI. Keep measured
  local behavior distinct from the production latency target.

## Scope and ownership

The Cloudflare deployment CLI owns rollout sequencing and native configuration.
The existing coordinator owns pristine standby inventory; the runtime owns
member execution and checkpointing. No additional owner or stored state is
presumed necessary. Production deployment is outside this PR-authoring task.

## Evidence and approach

The current standby target reader returns zero during an in-place image
transition. The coordinator drains unbound slots and pauses replenishment until
promotion. Deployment runs artifact proof, native rollouts, serving proof and
promotion in sequence. Member application rendering includes a five-minute
connection-age rollout protection period, separate from shutdown/checkpoint
safety. Investigate existing configuration and sequencing before introducing
new allocation or mixed-image inventory behavior.

## Product UX

Outcome: fresh conversations spend less time exposed to cold allocation during
routine deployment.
Reaches: foreground conversation allocation during deployment; active conversations
and interrupted-deployment recovery retain their existing correctness contracts.
Proof: focused deployed-config and composed orchestration/lifecycle tests selected
for the recommendation, plus a later hosted rollout measurement. No new UI,
assistant prompt, provider input, or user action is intended.

## Risks and mitigations

- An estimated latency benefit is not a measured production result: report the
  target separately and document the existing hosted verification path.
- Changes to grace or sequencing can affect ongoing execution: inspect and test
  existing shutdown, failure, and recovery boundaries before accepting the change.
- Avoid complexity inflation: retain the single fleet and current owner contracts
  unless concrete evidence requires otherwise.

## Tasks

1. ReviewGPT investigation with guarded current source: complete.
2. Parent assessment and minimal implementation: complete.
3. Focused verification and complexity review: passed; changelog preparation pending.
4. Scoped commit, PR, final ReviewGPT and required CI: in progress.

## Decisions

- Keep implementation and completion in the original session.
- Use the isolated `codex/standby-rollout-gap` branch.
- Prefer an improvement supported by existing owners over a hard latency guarantee.
- Accept ReviewGPT's recommendation: change only native connection-age grace
  from 300 seconds to zero. Keep deployment sequencing, standby admission,
  percentage steps, smoke proofs and SIGTERM draining unchanged.
- Preserve observed grace in retained applications and reject grace changes to
  a pending execution identity; complete an exact retry first.
- A fourfold speedup is unproven. Native convergence, smoke and standby refill
  still contribute to the gap; measure a subsequent authorized rollout.

## Verification

- Cloudflare focused suite: 309 tests passed across configuration, staging,
  provider transport, small runners, deployment CLI, standby and entrypoint.
- Runtime shutdown selection: 3 tests passed, including mid-wait checkpointing.
- Cloudflare typecheck passed.
- Complexity diff passed: maximum 5 unchanged, no hotspots above 20.
- Documentation drift passed.
- Changelog tests and Web typecheck are required before final candidate review.
- Broad verification and final ReviewGPT belong to the exact pushed PR head.
- Actual native rollout duration and hosted checkpoint/recovery observation
  remain post-deployment evidence; deployment is outside this task.
