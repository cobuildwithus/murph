# Temporal worker memory guard

## Goal

Fix the production Temporal worker memory regression and make the production
bundle and worker memory policy fail closed before deployment.

Success criteria:

- Restore the Workflow dependency graph to its small deterministic closure.
- Keep the Render worker on the approved 2 GB instance in checked-in config.
- Give the production worker an explicit bounded Workflow cache policy.
- Fail package builds and CI when the Workflow bundle exceeds its budget or
  includes forbidden server/runtime packages.
- Prove the bundle, worker policy, and replay-sensitive Workflow surface with
  focused tests plus the routed repo verification and review gates.

## Constraints

- Do not edit the currently owned `hosted-user-runtime.ts` Workflow lane.
- Preserve public hosted-execution exports and existing mailbox behavior.
- Keep the correction at the smallest dependency and worker-policy boundaries.
- Do not expose credentials, private runtime data, local usernames, or home
  paths in committed artifacts or logs.

## Approach

1. Move the shared vault-share record limit into a dependency-light leaf and
   restore type-only imports from the Workflow-reachable runtime-control module.
2. Add a production bundle contract with a byte ceiling and forbidden-module
   checks, enforced by the ordinary package build used in CI.
3. Configure an explicit conservative Workflow cache policy and lock it with
   worker-option tests.
4. Persist the 2 GB Render plan and document the production memory/bundle
   invariants in the existing operations references.
5. Run focused bundle, worker, replay, diff-coverage, specialist audit, CI, and
   ReviewGPT proof.

## State

Active.

## Evidence

- The failing deploy's Workflow bundle grew from about 1.75 MiB to 4.62 MiB.
- The added closure included the full contracts package after runtime-control
  imported one runtime constant from the otherwise type-only vault-share module.
- The OOM deploy processed less work than the preceding stable deploy, ruling
  out an incoming-traffic spike as the trigger.
- The live instance upgrade to 2 GB stopped the immediate restart loop; this is
  containment while the dependency and memory-policy regressions are fixed.
Status: completed
Updated: 2026-07-20
Completed: 2026-07-20
