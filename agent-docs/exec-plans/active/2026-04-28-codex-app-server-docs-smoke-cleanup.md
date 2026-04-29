Goal (incl. success criteria):
Land the docs/smoke cleanup for the Codex App Server assistant hard cut. Owned command-surface docs, smoke scenarios, and durable runtime/security/testing docs no longer advertise stale OpenAI-compatible assistant command flags, AI Gateway inbox model routing, or the removed `inbox model route` surface. Root/assistant chat and ask reflect Codex App Server options; run/root run no longer advertise model/provider endpoint flags. No runtime source or Cloudflare deploy docs are edited.

Constraints/Assumptions:
Preserve unrelated dirty work in the shared checkout. Do not write local usernames, home paths, or direct personal identifiers into files. User requested no commit. `inbox model bundle` may remain audit-only if still present.

Key decisions:
Use review-only worker lanes for doc and smoke inspection; integrate edits in the parent lane.

State:
Focused-verified; no commit per user request.

Done:
- Read required repo routing, architecture, verification, testing, and security docs.
- Inspected active coordination ledger and current dirty worktree.
- Updated owned command-surface docs, smoke scenarios, architecture/security/runtime/testing docs.
- Deleted the obsolete `inbox-model-route` smoke scenario.
- Ran focused JSON, scenario coverage, smoke, scoped workspace verifier, diff, residue, and privacy checks.

Now:
- Handoff without committing.

Next:
- None for this scoped task unless the user wants a commit or broader verification.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- `docs/contracts/03-command-surface.md`
- `e2e/smoke/scenarios/assistant-ask.json`
- `e2e/smoke/scenarios/assistant-chat.json`
- `e2e/smoke/scenarios/assistant-run.json`
- `e2e/smoke/scenarios/run.json`
- `e2e/smoke/scenarios/chat.json`
- `e2e/smoke/scenarios/inbox-model-route.json`
- `e2e/smoke/scenarios/inbox-model-bundle.json`
- `ARCHITECTURE.md`
- `agent-docs/SECURITY.md`
- `agent-docs/operations/verification-and-runtime.md`
- `agent-docs/references/testing-ci-map.md`
