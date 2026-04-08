# Coordination Ledger

Active coding work must register here before code changes begin.
Rows are active-work notices by default, not hard file locks.
Use `Notes` to mark a lane as exclusive when overlap is unsafe, such as a large refactor or delicate cross-cutting rewrite.

| Agent | Scope | Files | Symbols | Status | Notes |
| --- | --- | --- | --- | --- | --- |
| Codex | Replace hosted terms/privacy with the provided legal drafts as PDF assets served from `apps/web` | `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-09-hosted-legal-pdfs.md}`, `apps/web/{app/**,public/**,src/components/hosted-onboarding/**,test/**}` | hosted legal document routes, PDF asset hosting, hosted onboarding legal links | in_progress | Narrow hosted-web legal-doc lane only. Keep the revision-notes draft private unless a concrete product need appears, preserve unrelated hosted-web worktree state, and verify with hosted-web-targeted checks plus the required final audit pass. |
| Codex | Land the residual data-model review patch on the current tree | `agent-docs/exec-plans/active/{COORDINATION_LEDGER.md,2026-04-09-data-model-review-residuals.md}`, `agent-docs/references/data-model-seams.md`, `packages/{query,assistant-engine,assistant-runtime,cli,hosted-execution}/**`, `apps/{cloudflare,web}/**` | knowledge contract ownership, hosted assistant-delivery journals, hosted webhook receipt JSON detail shell | in_progress | Keep this lane scoped to the patch files only, preserve the unfinished hosted-legal lane, and verify with repo acceptance plus the required final audit pass. |
