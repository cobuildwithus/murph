# `vault-cli workout payload-schema`

Current smoke expectation:

- emits the JSON file-body contract for `workout import-json`
- includes compact `strengthExercises` examples for repeated strength sets
- keeps the schema command separate from mutation commands so agents can inspect payload shape before writing
