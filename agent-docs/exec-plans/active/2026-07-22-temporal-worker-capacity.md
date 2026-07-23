# Scale hosted Temporal worker capacity

Status: active
Created: 2026-07-22
Updated: 2026-07-22

## Goal

- Let hosted Temporal Activities absorb concurrent user demand without the
  historical two-Activity bottleneck.
- Use Temporal's server-feedback poller autoscaling for both Activity and
  Workflow Task pollers.
- Run two independent Render worker instances on the same Temporal Task Queue
  for process-level redundancy and aggregate capacity.

## Success criteria

- Each worker permits 100 concurrent Activity executions while retaining 20
  concurrent Workflow Task executions and the fixed 100-Workflow cache.
- Activity and Workflow Task pollers use Temporal autoscaling rather than
  fixed poll counts.
- The Render Blueprint requests two Standard worker instances.
- Focused tests prove the exact Worker options and Blueprint instance count.
- Required verification, completion-specialists ReviewGPT, final ReviewGPT,
  CI, and mergeability checks pass for the exact PR head.

## Scope

- Hosted Temporal Worker performance options and focused worker tests.
- The root Render Blueprint for `murph-temporal-worker`.
- Current hosted Temporal and runtime/deployment documentation.

## Constraints

- Do not change Workflow code, Task Queue identity, Activity retry semantics,
  or canonical state ownership.
- Keep fixed execution-slot suppliers; only poller counts become autoscaling.
- Keep database access behind signed hosted Web calls.
- Preserve idempotent schedule ensure behavior when both worker instances
  start.
- Do not deploy or merge as part of this task.

## Tasks

1. Remove fixed poll-count configuration and enable Temporal poller
   autoscaling.
2. Raise the default Activity execution limit from 2 to 100 and retain the
   Workflow Task execution limit at 20.
3. Configure two Render worker instances.
4. Update focused tests and durable operational documentation.
5. Complete required verification and exact-head PR review gates.

## Evidence

- The installed Temporal TypeScript SDK exposes autoscaling Activity and
  Workflow Task poller behavior while retaining fixed-size execution slots.
- Hosted Activities issue bounded signed HTTP control-plane requests; the
  longer runtime execution remains owned by Cloudflare after acceptance.
- Multiple Temporal Workers on the same Task Queue load-balance naturally, and
  the startup schedule ensure path is idempotent.
- Package typecheck, 87-test coverage, and the production Workflow-bundle build
  pass; the bundle remains 1.77 MiB.
- Render's Blueprint validator accepts `render.yaml` with two instances.
- Canonical diff verification and scenario-manifest integrity pass.
- Canonical full acceptance passes in a fresh 16-vCPU Blacksmith Testbox,
  including all workspace typechecks, package coverage, Web build/tests/lint,
  and Cloudflare verification.
