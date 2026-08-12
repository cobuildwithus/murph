# `vault-cli workout import inspect|csv`

Current smoke expectation:

- inspects the complete Strong or Hevy CSV without writing raw or canonical data
- reports missing positive weight or distance units instead of guessing
- validates the complete structured batch before storing one raw source batch
- commits canonical workout sessions together and returns bounded identifiers
- treats an unchanged replay as a no-op without storing duplicate raw evidence
