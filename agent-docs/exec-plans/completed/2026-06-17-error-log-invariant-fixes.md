Goal (incl. success criteria):
- Make the important error-log paths comply with the invariant that failure logs include both a machine-readable code/category and a redacted human-readable message/cause summary.
- Keep the fix small and composable: prefer existing hosted redaction helpers and local boundary helpers over a broad logging framework.
- Success means durable hosted runtime failure logs, key web/control-plane logs, assistant diagnostics, and device/inbox daemon failure summaries preserve both halves, with focused tests or guards covering the main drift points.

Constraints/Assumptions:
- Preserve secrets, tokens, raw payloads, direct identifiers, and local paths in all logs and docs.
- Do not add synchronous observability work to user-visible hot paths except existing crash-tail best-effort behavior.
- Do not refactor unrelated logging surfaces beyond the important invariant violations identified by the audit.
- Preserve unrelated worktree edits and active ledger rows.

Key decisions:
- Branch from `origin/main` in a separate worktree and cherry-pick only the prior invariant commit, avoiding unrelated local `main` commits.
- Use existing hosted execution error derivation/redaction helpers where possible.
- Enforce the durable hosted runtime log shape at the contract/parser seam so call-site drift fails mechanically.

State:
- In progress.

Done:
- Audit reports identified the important invariant gaps.
- Isolated worktree and branch created.
- Prior invariant commit cherry-picked into this branch.

Now:
- Split implementation across seam-focused workers and integrate the smallest durable fixes.

Next:
- Add focused tests/guard coverage, run required verification and completion audits, then open a draft PR.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- docs/contracts/00-invariants.md
- packages/hosted-execution/src/runtime-control.ts
- packages/hosted-execution/src/parsers/runtime-control.ts
- packages/assistant-runtime/src/hosted-runtime/*.ts
- packages/assistant-engine/src/assistant/**
- packages/operator-config/src/assistant-cli-contracts.ts
- packages/runtime-state/src/assistant-runtime-issues.ts
- apps/web/src/lib/hosted-execution/logging.ts
- apps/web/src/lib/http.ts
- apps/web/src/lib/hosted-*/**
- apps/web/src/lib/device-sync/**
- packages/device-syncd/src/**
- packages/inbox-services/src/**
- matching focused tests and logging guards
Status: completed
Updated: 2026-06-17
Completed: 2026-06-17
