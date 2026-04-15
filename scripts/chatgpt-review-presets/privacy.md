Run a privacy and data-minimization audit for Murph.

Prioritize:
- places where we store, duplicate, or retain more user data than the product actually needs
- logs, docs, fixtures, runtime state, or hosted/local artifacts that could leak or over-retain sensitive user information
- raw external payloads, identifiers, contact details, health data, or model/tool outputs that could be narrowed, redacted, hashed, truncated, or deleted sooner
- workflows that persist user data in multiple layers when one narrower canonical or operational representation would be enough
- defaults that make long-lived retention easier than ephemeral handling or reconstructable derived state

Prefer behavior-preserving changes that keep Murph useful while reducing how much user data is stored or exposed.

Final response contract:
- Return one downloadable `.patch` attachment containing a single unified diff for every change you chose to make in this pass.
- Also return a short plain-text summary that says what you changed, what those changes fix or improve, and any important residual concerns you left untouched.
- Keep the summary concise and factual; do not return a long prose review or any alternate structured findings template.
- If you find no safe actionable changes, return a short plain-text summary saying so and attach no patch.
