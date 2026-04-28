# `vault-cli assistant`

Current smoke expectation:

- `chat` and `assistant chat` expose the same Codex App Server-backed terminal chat surface
- `ask` and `chat` reuse Codex-backed sessions while `deliver` remains an explicit channel delivery utility; Murph persists only runtime residue under `vault/.runtime/operations/assistant/**`
- `research` and `deepthink` reuse the same provider/browser bridge for long-running chat-backed work without turning those external transcripts into canonical vault data
- `ask --deliverResponse` can send a generated reply back out over a mapped delivery target such as Telegram or email
- `status`, `doctor`, and `session list|show` inspect local assistant runtime state without treating external Codex thread history as canonical vault data
- canonical `memory show|search|upsert|forget` uses `bank/memory.md`
- canonical `automation scaffold|list|show|upsert` uses `bank/automations/*.md`
- `run` watches inbox captures, processes due canonical automations plus internal runtime-only scheduling, skips already-routed or parser-pending work, and lets the Codex app-server runner call the normal `vault-cli` / `murph` surface for canonical writes
