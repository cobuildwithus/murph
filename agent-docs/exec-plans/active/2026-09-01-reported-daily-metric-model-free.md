# Reported daily metric mailbox ownership

Status: active
Created: 2026-09-01
Updated: 2026-09-01

## Goal

- Stop a later reported daily metric from publishing a default-processing wake while earlier model-free device-sync work owns the durable system-mailbox frontier.

## Product UX

- Effort: Patch.
- Outcome: delayed connected-health work resumes without a hot no-progress loop.
- Reaches: members whose runtime imports device-sync work followed by a reported daily metric.
- Proof: a production-shaped mixed-mailbox regression plus post-deploy system-mode, device-pass, and frontier-advance evidence.

## Root-cause evidence

- `health.daily-metric.reported` is currently classified as `default_owned` even though import already performs its canonical write and execution is a deterministic no-op plus projection record.
- In a mixed frontier, that later row publishes a due default-processing wake while the earlier device-sync row remains the model-free execution frontier.
- Default invocations hand the earlier device row back to system mode, then checkpoint the unchanged due default wake, producing repeated no-progress invocations.

## Plan

1. Add a failing contract regression for the reported metric execution class and a failing mixed-frontier regression matching production ordering.
2. Move the deterministic reported-metric item into the existing model-free ownership set and allow its existing import route in system-mailbox mode.
3. Add runtime-entrypoint proof that system mode consumes the item without entering the assistant lane.
4. Run focused tests, package typechecks, complexity, changelog validation, diff/privacy review, exact-head CI, and ReviewGPT.
5. Merge, deploy with immediate hosted-container rollout, and verify the affected production frontier advances and the loop stops.

## Deployment concerns

- Cloudflare hosted runtime first, with immediate container replacement; then deploy Web only if the merged shared classifier is consumed by its reconciliation build.
- No schema, wire, Temporal workflow, provider-input, or persisted-state migration is expected.
