Run a privacy and data-minimization audit for Murph.

Prioritize:
- places where we store, duplicate, or retain more user data than the product actually needs
- logs, docs, fixtures, runtime state, or hosted/local artifacts that could leak or over-retain sensitive user information
- raw external payloads, identifiers, contact details, health data, or model/tool outputs that could be narrowed, redacted, hashed, truncated, or deleted sooner
- workflows that persist user data in multiple layers when one narrower canonical or operational representation would be enough
- defaults that make long-lived retention easier than ephemeral handling or reconstructable derived state

Prefer behavior-preserving changes that keep Murph useful while reducing how much user data is stored or exposed.

Final response contract:
- Return a concise plain-text review with the highest-value privacy or data-minimization issues from this pass.
- For each item, cite the concrete files or flows involved, explain the over-retention or exposure risk, and recommend the smallest safe follow-up.
- Keep the response concise and factual; do not return a long prose review, a patch, or a diff.
- If you find no safe actionable changes, return a short plain-text summary saying so.
