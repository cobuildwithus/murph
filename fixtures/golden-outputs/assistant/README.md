# `vault-cli assistant`

Current smoke expectation:

- `chat` and `assistant chat` expose the same provider-backed terminal chat surface
- `ask`, `chat`, and `deliver` reuse provider-backed sessions while Murph persists only runtime residue under `vault/.runtime/operations/assistant/**`
- `research` and `deepthink` reuse the same provider/browser bridge for long-running chat-backed work without turning those external transcripts into canonical vault data
- `ask --deliverResponse` can send a generated reply back out over a mapped delivery target such as iMessage
- `status`, `doctor`, and `session list|show` inspect local assistant runtime state without treating provider transcripts as canonical vault data
- canonical `memory show|search|upsert|forget` uses `bank/memory.md`
- canonical `automation scaffold|list|show|upsert` uses `bank/automations/*.md`
- `run` watches inbox captures, processes due canonical automations plus internal runtime-only scheduling, skips already-routed or parser-pending work, and reuses the existing inbox model-routing harness for canonical writes
