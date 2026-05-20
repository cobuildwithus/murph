Goal (incl. success criteria):
- Investigate why hosted Murph OpenAI GPT-5.5 low-reasoning requests are not receiving expected prompt-cache hits, using the provided AI Gateway CSV, repo code, hosted DB, and Cloudflare logs where available.
- Success means identify the likely root cause with direct evidence, and patch/recommend the narrowest fix if the cause is in this repo.

Constraints/Assumptions:
- Do not expose personal identifiers, raw prompts, secrets, full local paths, or raw request/response bodies.
- Treat hosted usage, billing, logs, and provider metadata as sensitive.
- OpenAI docs say prompt caching requires exact prompt prefixes at 1024+ tokens; stable content should be at the beginning; repeated common-prefix traffic should use a consistent `prompt_cache_key`; GPT-5.5 defaults to 24h prompt-cache retention.

Key decisions:
- Use metadata-only CSV summaries and source-code evidence.
- Use current OpenAI docs for prompt-cache behavior.

State:
- Production cache-bust fix implemented. Follow-up diagnostics now target the
  remaining warm-cache uncached suffix by summarizing the final OpenAI input
  items with metadata-only byte/count/fingerprint fields.

Done:
- Loaded required repo routing, architecture, security, reliability, verification, OpenAI, and Cloudflare skill guidance.
- Fetched current OpenAI prompt-caching docs.
- Parsed the AI Gateway CSV and confirmed prompt caching works for repeated
  in-turn requests, while first provider requests are often full uncached
  prefills.
- Queried hosted DB and Cloudflare logs; hosted usage rows currently have null
  token fields, and Cloudflare showed repeated hosted runner invocations plus
  crypto-context 403 failures during the incident window.
- Registered active plan
  `agent-docs/exec-plans/active/2026-05-04-hosted-prompt-cache-incident.md`.
- Fixed active-turn provider loop resume materialization, stale-resume fallback
  replay, final session-thread resume-state persistence/clear behavior, Codex
  token-usage extraction, and privacy-safe provider planning diagnostics.
- Ran focused tests, `pnpm typecheck`, `git diff --check`, and diff-aware
  owner/reverse-dependent verification successfully.
- Completed required security/privacy, simplify, coverage-write, and final
  completion reviews.
- Added bounded Cloudflare OpenAI input-tail diagnostics for warm-cache suffix
  analysis and verified focused egress tests, log guard, Cloudflare typecheck,
  and repo typecheck.

Now:
- Land the scoped diagnostic commit and close the prompt-cache debugging plan.

Next:
- Deploy and monitor hosted usage/runtime logs for warm-cache auto-reply rows:
  compare `cached_tokens` with the new `inputTailItem*` metadata to identify
  the item(s) making up the uncached suffix.

Open questions (UNCONFIRMED if needed):
- Whether Vercel AI Gateway/OpenAI cache routing can be improved through a
  supported Codex app-server cache-key surface; no protocol field is exposed in
  Codex 0.128.

Working set (files/ids/commands):
- `CONTINUITY_prompt-cache-incident.md`
- Provided CSV under `<HOME_DIR>/Downloads/`
