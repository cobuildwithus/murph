Goal (incl. success criteria):
- Fix hosted assistant Health Commons search/list behavior so broad discovery for sauna returns the public Finnish Dry Sauna protocol when the corpus diagnostics show it is present.
- Preserve exact lookup and source-list behavior; avoid widening into Health Commons content generation or research artifacts.

Constraints/Assumptions:
- Work in the current checkout only.
- Do not touch unrelated active Health Commons research/generated-output lanes.
- Hosted assistant/iMessage path may pass wildcard filters such as `["*"]`; those should mean unfiltered all-categories/all-statuses, not a literal category/status.
- Health Commons public catalog data is not private vault data, but hosted assistant turns and logs are privacy-sensitive.

Key decisions:
- Prefer a narrow runtime/tool filter normalization fix plus focused CLI and assistant-tool tests.
- Keep the existing Health Commons runtime reader as the owner instead of adding a new package or broad query subsystem.
- Move wildcard/status/category/source-kind filtering into one runtime selector; keep CLI and assistant tools as transport adapters.

State:
- Implementing.

Done:
- Reproduced local CLI `commons search sauna` and `commons protocol list --query sauna` returning Finnish Dry Sauna.
- Reproduced `commons protocol list --query sauna --category '*'` returning zero, matching the empty-result shape seen in hosted assistant reports.

Now:
- Patch runtime, CLI, assistant tools, and focused regressions for wildcard filters.

Next:
- Patch focused tests, run package checks, required audits, and commit scoped fix if safe.

Open questions (UNCONFIRMED if needed):
- UNCONFIRMED: Whether the live hosted iMessage/Linq turn passed `categories: ["*"]`, `status: ["*"]`, both, or a stale deployed bundle.

Working set (files/ids/commands):
- `packages/health-commons/src/runtime.ts`
- `packages/cli/src/commands/commons.ts`
- `packages/assistant-engine/src/assistant-cli-tools/definitions/health-commons.ts`
- Focused tests under `packages/{health-commons,cli,assistant-engine}/test/**`
Status: completed
Updated: 2026-04-26
Completed: 2026-04-26
