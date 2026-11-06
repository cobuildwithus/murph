# Explain background boundary failures and simplify child tracking

Status: completed
Created: 2026-09-20
Updated: 2026-09-20

## Goal

Make unsupported child lifecycle failures distinguishable through existing hosted
error diagnostics and remove duplicated lifecycle validation and diagnostic indirection.

## Protected boundary

Snapshot construction still waits for all admitted children, usage reports, and
terminal scans. Unsupported work stops the exact resident process. Ordinary
checkpoint interruption preserves resident evidence. No production mutations.

## Decisions

- Encode the finite lifecycle reason in the existing error code; do not add an
  event stream, logging state, transport field, or diagnostic service.
- Retain early native completion evidence: completion can precede parent-side
  admission. A candidate consolidation discarded that supported ordering and
  was rejected in parent review. The final change preserves lifecycle state.
- Validate lifecycle identifiers once in the existing protocol parser and remove
  the message-only violation wrapper. Keep the first finite reason directly.
- Keep billing handlers separate: they can exist before lifecycle admission.
- No prompts, tools, provider input, or model decisions change. Deterministic
  process/protocol tests exercise the affected checkpoint boundary.
- Internal diagnostic/state correction; no public changelog needed.

## Tasks

1. Reproduce indistinguishable reasons with synthetic tests; protect early completion ordering.
2. Remove duplicated validation and expose finite failure codes.
3. Prove codes survive container serialization and Worker error diagnostics.
4. Run focused tests, relevant typechecks, complexity check, privacy and parent
   review; close the plan and create a scoped local commit.

## Verification

- Passed: 127 tests across assistant-codex-runtime-events, runtime-process,
  and runtime-recovery using the assistant-engine Vitest config.
- Passed: six focused container-entrypoint/runner-container cases through the
  Cloudflare Vitest config. The emitted error detail and persisted safe summary
  retain finite lifecycle codes while private cause/detail text stays omitted.
- Passed: assistant-engine and Cloudflare package typechecks. Initial Cloudflare
  typecheck needed the normal Web Prisma client generation; it passed after
  `pnpm --dir apps/web prisma:generate`.
- Passed: `pnpm complexity:diff`; no complexity debt or maximum increase.
  Existing unrelated hotspots remain outside this change. Production source
  removes 19 net lines, one wrapper, and repeated identifier validation.
- Parent review: first violation remains latched, unsupported work still stops
  the exact process, valid completion-before-admission survives, and stale
  prior-boundary completions remain inert. Tests preserve nonblocking root
  replies, cancellation, child accounting, and background terminal scans.
- Red/green evidence: untracked completion and interaction assertions initially
  received only the generic unsupported code; both pass with finite codes.
- No provider-facing input or model behavior changed; no live provider journey
  needed for this deterministic diagnostic-only change.

## Deployment and remaining evidence

No deployment or production mutation performed. Existing Worker readers accept
these codes through the unchanged safe error metadata path; no schema migration,
consumer rollout prerequisite, or durable state change. Old containers continue
to emit the generic code until replaced. After deployment, inspect the existing
container failure diagnostics for the finite code to identify the actual rejected
lifecycle. This patch does not claim the prior incident's precise cause is known.

Completed: 2026-09-20
