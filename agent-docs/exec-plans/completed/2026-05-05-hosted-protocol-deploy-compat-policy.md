# Hosted Protocol Deploy Compatibility Policy

## Goal

Record the minimal deploy-compatibility rule for web and Cloudflare protocol
changes.

Success criteria:

- Hosted protocol docs state the consumer-tolerant / producer-dual-path /
  contract-later sequence.
- The rule stays small and does not introduce a deploy orchestrator or generic
  capability system.
- The docs index points at the updated hosted runtime protocol doc.

## Constraints

- Docs-only change.
- Preserve unrelated dirty checkout edits.

## Completion State

Implemented and verified. Ready to close after scoped commit.

Verification:

- Read back `agent-docs/references/hosted-runtime-protocol.md`
- Read back `agent-docs/index.md`
- `git diff --check`
Status: completed
Updated: 2026-05-05
Completed: 2026-05-05
