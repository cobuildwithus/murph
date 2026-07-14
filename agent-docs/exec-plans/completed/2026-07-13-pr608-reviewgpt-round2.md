Goal (incl. success criteria):
- Resolve the two accepted High findings from PR #608 ReviewGPT round 2 without adding persisted authorization state or another delivery service.
- Success means canonical membership/email/health authority is resolved last before facts enter Codex, the same deterministic authorization proof is revalidated by the existing web callback immediately before provider entry, and zero-sent failed delivery remains retryable.
- Complete focused verification, required completion audits, another zero-accepted-finding ReviewGPT round, green CI, and merge PR #608.

Constraints/Assumptions:
- Preserve `packages/query` as the single weekly group-summary owner and the existing seven-day consent scope.
- Preserve scheduled occurrence authority, idempotency, missing-email nudges, provider delivery, and fail-closed legacy runner behavior.
- Use the existing newsletter preparation and group-recipient callback boundaries; do not add a table, queue, route, scheduler, or parallel projection.
- Keep the authorization proof compact, deterministic, opaque to the model, and bound to the complete canonical participant snapshot.
- Preserve unrelated working-tree and coordination-ledger edits.

Key decisions:
- Have the web preparation owner construct the deterministic authorization proof from the complete participant snapshot.
- Load local projection/timezone enrichment before the final web preparation call, then synchronously intersect that already-loaded data with the final canonical authorization response before model serialization.
- Carry the proof through the existing hosted email request and group-recipient callback, where the web owner recomputes and compares it before returning any addresses.
- Delete the runtime-side second `prepare` request and duplicate snapshot comparison; retain only same-occurrence/group preparation binding plus the proof.
- Treat delivery status `failed` or any zero-sent delivery as `send_failed`; reserve `partial_failure` for at least one successful recipient.

State:
- The authorization-proof and ordering corrections are implemented, verified, and ready for the scoped commit and PR gates.

Done:
- Verified the exact pushed head and completed ReviewGPT round 2 with required marker/model evidence.
- Proved both reported races and the zero-sent classification bug against the production code path.
- Confirmed all PR-specific CI gates on the reviewed head were green; the sole failing CLI assertion is unchanged base-owned drift.
- Added one deterministic, address-free authorization proof owned by web preparation and revalidated by the existing signed recipient callback before provider entry.
- Moved local projection/timezone loading ahead of the final canonical web authorization result and deleted the runtime's duplicate second preparation read.
- Corrected zero-sent delivery classification and added focused revoke, parser, callback, transport, and runtime regression coverage.
- Resolved the completion security audit's mixed-snapshot finding with one late repeatable-read authority snapshot plus verified-email fingerprint matching; added suspension and email-mutation proof.
- Passed the fresh security/privacy re-audit with zero critical, high, or medium findings.
- Completed the coverage-write audit; added the missing snapshot-only/proof-only rollout regression and passed its focused 5-test file plus lint.
- Passed the affected package typechecks, 365 initial focused tests, revised web/engine tests, production runner bundle assembly/budget, and the canonical bundle regression. Broad reverse-dependent typechecks passed; three unrelated parallel timing failures passed their exact serial reruns.

Now:
- Create the scoped task commit and rebase it onto the advanced base branch.

Next:
- Push, rerun ReviewGPT and CI on the exact head, and merge.

Open questions (UNCONFIRMED if needed):
- None.

Working set (files/ids/commands):
- packages/hosted-execution/src/{runtime-control,hosted-email}.ts
- packages/hosted-execution/src/parsers/runtime-control.ts
- packages/hosted-execution/test/*
- packages/assistant-engine/src/assistant-codex/dynamic-tools.ts
- packages/assistant-engine/test/assistant-codex-group-tool.test.ts
- packages/assistant-runtime/src/{hosted-email,hosted-runtime/workspace-assistant-phase}.ts
- packages/assistant-runtime/test/{hosted-email,hosted-runtime-group-tool-linq-context}.test.ts
- apps/cloudflare/src/hosted-email/transport.ts
- apps/cloudflare/test/hosted-email-*.test.ts
- apps/web/src/lib/hosted-groups/group-newsletter.ts
- apps/web/app/api/internal/hosted-execution/email/group-recipients/route.ts
- apps/web/test/{hosted-group-newsletter,hosted-execution-email-callback-routes}.test.ts
- agent-docs/product-specs/group-health-newsletter.md
- agent-docs/exec-plans/active/COORDINATION_LEDGER.md

Status: completed
Updated: 2026-07-13
Completed: 2026-07-13
