# PR 760 Provider-Neutral Labs Language

## Goal

Keep the internal lab provider out of member-facing Labs pages, assistant replies,
tool descriptions, model-visible Labs results, and public changelog copy. Present the product simply:
Murph can help people explore lab tests now, and ordering through Murph is
planned for later without a promised date.

## Constraints

- Keep Web as the sole provider credential, egress, and normalization owner.
- Keep internal provider names in implementation, configuration, tests, and
  operator-only diagnostics where they are technically necessary.
- Do not add a masking layer, persistence, compatibility shim, or new state
  owner. Delete unnecessary provider-identifying result fields instead.
- Preserve discovery-only behavior, strict bounds, sanitized failures, and the
  verified private-direct assistant audience gate.

## Working Set

- Shared Labs response contracts and provider normalization.
- Authenticated Labs metadata, page copy, and focused UI/API/provider tests.
- Assistant Labs tool description, stable guidance, serialized result proof,
  and focused prompt/tool tests.
- Device-sync user-facing provider guidance and focused prompt proof.
- Public changelog text, item identifiers, tags, and visual labels that could
  otherwise expose the internal provider to members.
- Labs product spec, indexes, coordination ledger, and PR description.

## Verification Plan

- Focused Hosted Execution, Web, Assistant Engine, and Assistant Runtime tests.
- Typecheck each affected owner and run focused Web lint.
- Run docs drift, scenario integrity, changed-line privacy/secret scans, and the
  repository diff-aware gate.
- Capture approved browser proof when the connector is available; otherwise
  preserve the explicit environment gap.
- Commit with `scripts/finish-task`, push the new PR head, run CI and ReviewGPT
  concurrently, and require a valid pass before restoring merge-ready status.

## Completion Evidence

- Provider-identifying Labs response fields were deleted at the shared contract
  and Web normalization boundary; no masking layer or compatibility machinery
  was added.
- Member-facing Labs states, assistant guidance, model-visible tool results,
  device-sync reply guidance, and public changelog data/markup are
  provider-neutral. Ordering is described as planned for later without a timing
  promise.
- Frontend review accepted two copy corrections: use the canonical ordering
  wording in expanded details and state listed home collection without hedging.
  The final frontend rerun had zero findings.
- Fable's final review found only the intentional permalink tradeoff from
  removing provider-bearing public item identifiers. Compatibility aliases were
  rejected because they would retain the forbidden public identifier and add
  machinery for a low-impact historical anchor.
- Owner tests, full Web tests, affected typechecks, changed-file lint, scenario
  integrity, docs drift, and focused regression checks passed. The diff-aware
  lane reached the affected owners but remained blocked by an unrelated CLI
  intervention test timeout that reproduced in isolation.
- Browser-backed desktop/mobile proof was unavailable because the in-app
  browser runtime exposed no browser; static rendered-markup coverage and both
  independent UI reviews record that gap.
Status: completed
Updated: 2026-07-16
Completed: 2026-07-16
