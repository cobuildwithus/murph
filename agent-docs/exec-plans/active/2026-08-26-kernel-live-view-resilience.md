# Keep Kernel automation independent from Live View embedding

## Goal

Restore browser automation when Kernel returns a browser session whose optional
Live View URL does not match Murph's documented embed-origin allowlist.

Success criteria:

- `computer_open` can create, navigate, and attach the authenticated Kernel
  browser session even when its Live View URL cannot be embedded by Murph.
- Post-handoff browser restoration has the same behavior.
- Live View URLs remain encrypted at rest, absent from model-visible results,
  and rejected at the first-party handoff page unless they pass the existing
  origin policy.
- Focused deterministic tests cover both the recovered automation path and the
  preserved exposure denial.

## Product UX Patch

- **Outcome:** A member's ordinary browser task continues when only Kernel's
  optional human-view capability is incompatible with Murph's embed policy.
- **Reaches:** Initial browser open and post-login task-browser restoration;
  human takeover keeps its existing fail-closed origin check.
- **Proof:** Focused hosted-computer tests cover the initial open, restoration,
  retained session, requested navigation, and handoff exposure denial.

Affected paths:

1. Automation-only task: Murph reaches and operates the requested site without
   surfacing an internal Live View configuration failure.
2. Human handoff: Murph never exposes an unapproved Live View origin; the
   existing first-party handoff boundary rejects it.
3. Approved Kernel Live View: existing encrypted storage and handoff behavior
   remain unchanged.

## Constraints

- Trust the authenticated Kernel browser/session control plane for automation;
  do not broaden iframe or WebSocket CSP sources.
- Keep raw Live View URLs, provider payloads, private conversation evidence,
  and member identifiers out of tests, logs, docs, and review artifacts.
- Do not add schema, retry, queue, configuration, or dependency changes.
- Preserve all existing browser ownership, cleanup, handoff-token, and
  same-member authorization rules.

## Approach

1. Remove Live View origin admission from browser creation and restoration.
2. Preserve encrypted capability storage and the existing validation at
   `readHandoffPageState`, where the URL can actually be disclosed.
3. Convert the two origin-rejection provisioning regressions into automation
   success regressions while retaining the handoff exposure-denial test.
4. Run scoped verification, exact-head review, CI, and current-base merge proof.

## State

Implementation in progress.

The optional real-Codex continuation probe was removed after its local
subscription run stopped at the usage limit before any provider action. That
probe exercised the unchanged model-facing tool contract rather than the
Web-owned Kernel admission boundary, so keeping it would not prove this fix.
