# `vault-cli assistant`

Current smoke expectation:

- `ask` and `chat` reuse provider-backed sessions while Healthy Bob persists only minimal metadata under `assistant-state/`
- `session list|show` inspects local assistant session metadata without treating provider transcripts as canonical vault data
- `run` watches inbox captures, skips already-routed or parser-pending work, and reuses the existing inbox model-routing harness for canonical writes
