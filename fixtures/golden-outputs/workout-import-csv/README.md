# `vault-cli workout import inspect|csv`

Scenario-manifest expectation for the synthetic Strong fixture:

- registers the complete Strong CSV input without private member data
- reports missing positive weight or distance units instead of guessing
- validates the complete structured batch before storing one raw source batch
- commits canonical workout sessions together and returns bounded identifiers
- treats an unchanged replay as a no-op without storing duplicate raw evidence

This directory is manifest-integrity documentation, not an executable golden
transcript. Focused importer, CLI, and vault-usecase tests execute Strong and
Hevy parsing, persistence, correction, and replay behavior.
