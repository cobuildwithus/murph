# Preserve hosted-local readiness and cleanup proof

Status: completed
Created: 2026-09-06

## Outcome

Remove the local harness override that limits deployment readiness to thirty one-second probes. The deployment smoke owner already provides a bounded attempt budget; retain the existing fast local polling interval and all readiness checks. Wait for the complete device-cleanup condition because its status fields come from independent database reads.

## Evidence

- The two standby-enabled foreground integration lanes fail before their scenarios on both the private deletion candidate and the identical public/private base.
- Both containers pass cold health in about four seconds, then remain provisioning while their full per-container CLI smoke checks run. Successful single-container smoke requests on the same source take roughly twenty-two to twenty-five seconds. The local thirty-second override can terminate this operation before its existing seventy-five-second readiness deadline.
- The device cleanup helper returns on the first zero-resource sample and immediately asserts two separately read pending flags. An atomic acknowledgement can commit between those independent reads. The same helper and store sources exist in a passing baseline.

## Scope and invariants

- Reuse the deployment smoke attempt default. Preserve explicit caller overrides, local polling cadence, fatal E2E readiness failures and proof reuse only for the matching build.
- Poll the complete existing cleanup condition under its existing deadline. Preserve positive-count pending requirements, eventual idle and reminder/device assertions.
- No runtime scheduling, standby claim/readiness, database transaction, production configuration or provider behavior changes.

## Steps

1. Apply the two small harness corrections and review their source boundaries.
2. Run relevant harness tests and typechecks, complexity and documentation checks.
3. Open the isolated PR and start GPT-6 Pro review alongside exact-head CI.
4. Verify the formerly failing integration paths using the reviewed public candidate through the existing integration mechanism.

## Verification

Passed: 81 harness stack tests; hosted-local-harness and Cloudflare typechecks; complexity guard (unchanged source debt 119, existing main stack hotspot 139); docs drift and whitespace checks.

The implementation and local proof are complete. Exact-head ReviewGPT and CI remain PR gates. The existing private workflow cannot run a public PR source: its full-integration planner resolves public main. After the public fix lands, rerun the existing private integration workflow in full so its planner and artifact builders consume the new public revision. Eventual standby completion and the formerly failing cleanup scenario still need that execution proof.
Updated: 2026-09-06
Completed: 2026-09-06
