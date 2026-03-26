# `vault-cli validate`

Current smoke expectation:

- returns `valid` plus a structured `issues` array
- malformed journal and experiment frontmatter accumulate multiple issues in one response
- `vault repair` is the explicit follow-up path for additive metadata or layout drift surfaced by validation
