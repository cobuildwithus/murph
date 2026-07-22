# PR 824 launch-contract remediation

## Goal

Resolve the ReviewGPT launch-contract finding and the live Epic registration
constraint without expanding the one-generation clinical-record lifecycle.

## Scope

- Make the activation contract explicitly fresh-connection-only; active,
  disconnected, and `needs_reauth` rows remain ineligible in this beta.
- Add focused seeded-status proof while retaining the exact 24-slice fresh-run
  proof.
- Correct Epic registration guidance: the exact 38-API app uses manual customer
  distribution because two required APIs are outside USCDI-v3 auto-download.
- Update the PR description, run routed verification, push, and obtain a clean
  ReviewGPT remediation round on the exact final head.

## Constraints

- Do not add a second retrieval generation, reconnect path, retention policy,
  or stale-callback lifecycle in this correction.
- Keep all 24 primary query scopes active for fresh connections.
- Do not substitute Outside Record or SDOH APIs for distinct catalog entries.

## Verification

- Focused clinical-record control-plane and provider-directory tests.
- Web typecheck and the routed affected-owner verification required by the
  completion workflow.
- GitHub CI and ReviewGPT on the pushed remediation head.

Status: completed
Updated: 2026-07-21
Completed: 2026-07-21
