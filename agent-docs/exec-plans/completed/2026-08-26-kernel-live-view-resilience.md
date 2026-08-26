# Keep Kernel automation independent from Live View embedding

## Goal

Restore browser automation when Kernel returns a browser session whose optional
Live View URL does not match Murph's documented embed-origin allowlist.

Success criteria:

- `computer_open` can create, navigate, and attach the authenticated Kernel
  browser session even when its Live View URL cannot be embedded by Murph.
- Post-handoff browser restoration has the same behavior.
- Live View URLs remain encrypted at rest, absent from model-visible results,
  and rejected before a first-party handoff link or Managed Auth fallback can
  expose them unless they pass the shared origin policy.
- The shared policy accepts Kernel's documented `*.kernel.sh:8443` and
  `*.onkernel.com:8443` viewer families and derives the matching CSP sources.
- Focused deterministic tests cover the recovered automation path, safe
  publication boundary, supported host families, CSP, and exposure denial.

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
2. Human handoff: Murph never publishes an unusable link or exposes an
   unapproved Live View origin; direct and Managed Auth fallback boundaries
   reject it before publication.
3. Approved Kernel Live View: existing encrypted storage and handoff behavior
   remain unchanged.

## Constraints

- Trust the authenticated Kernel browser/session control plane for automation;
  derive only Kernel's documented Live View host families from one code-owned
  source and do not admit arbitrary HTTPS origins.
- Keep raw Live View URLs, provider payloads, private conversation evidence,
  and member identifiers out of tests, logs, docs, and review artifacts.
- Do not add schema, retry, queue, configuration, or dependency changes.
- Preserve all existing browser ownership, cleanup, handoff-token, and
  same-member authorization rules.

## Approach

1. Remove Live View origin admission from browser creation and restoration.
2. Derive the validator and iframe/WebSocket CSP from one canonical list for
   Kernel's documented `kernel.sh` and `onkernel.com` viewer families.
3. Validate direct handoffs before publishing their link and validate Managed
   Auth only when it actually converts to the Live View fallback.
4. Cover automation continuity, pre-publication denial, fallback cleanup,
   supported host families, CSP, and handoff exposure with focused tests.
5. Run scoped verification, exact-head review, CI, and current-base merge proof.

## State

Implementation complete; verification and landing are in progress.

The required focused real-Codex continuation journey remains committed for
repeatable browser-behavior proof. Its local run stopped at
`ASSISTANT_CODEX_USAGE_LIMIT` before any provider action, so this attempt is a
live-proof Hold rather than pass/fail evidence for the Web-owned boundary.
Status: completed
Updated: 2026-08-26
Completed: 2026-08-26
