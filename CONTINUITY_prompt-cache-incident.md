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
- Incident fix implemented and verified; final scoped commit in progress.

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

Now:
- Commit remaining final-review/test proof changes and close the plan.

Next:
- Monitor hosted usage rows after deploy for non-null token usage and reduced
  repeated cold starts.

Open questions (UNCONFIRMED if needed):
- Whether Vercel AI Gateway/OpenAI cache routing can be improved through a
  supported Codex app-server cache-key surface; no protocol field is exposed in
  Codex 0.128.

Working set (files/ids/commands):
- `CONTINUITY_prompt-cache-incident.md`
- Provided CSV under `<HOME_DIR>/Downloads/`
