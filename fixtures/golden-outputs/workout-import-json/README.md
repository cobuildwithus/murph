# `vault-cli workout import-json`

Current smoke expectation:

- accepts an advanced structured JSON payload from `--input @file.json` or stdin
- preserves explicit title, note, activity type, duration, and compact strength-exercise fields
- shares the same canonical activity session result shape as `workout add`
- supports command-line overrides for ambiguous payload fields without widening the typed flag surface
