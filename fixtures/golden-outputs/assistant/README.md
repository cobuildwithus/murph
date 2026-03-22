# `vault-cli assistant`

Current smoke expectation:

- `chat` and `assistant chat` expose the same provider-backed terminal chat surface
- `ask`, `chat`, and `deliver` reuse provider-backed sessions while Healthy Bob persists only minimal metadata under `assistant-state/`
- `ask --deliverResponse` can send a generated reply back out over a mapped delivery target such as iMessage
- `cron add|status|list|show|enable|disable|remove|run|runs` manages scheduled assistant prompts and run history under `assistant-state/cron/`
- `session list|show` inspects local assistant session metadata without treating provider transcripts as canonical vault data
- `memory search|get|upsert|forget` manages typed non-canonical assistant memory under `assistant-state/`, including explicit deletion of stale memory records
- `run` watches inbox captures, processes due assistant cron jobs, skips already-routed or parser-pending work, and reuses the existing inbox model-routing harness for canonical writes
