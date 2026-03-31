Run a security audit for Murph.

Prioritize:
- canonical vault trust boundaries, unintended writes, and corruption of human- or machine-facing source-of-truth data
- leakage of sensitive health data, tokens, session state, or provider credentials through logs, CLI/web output, docs, fixtures, or persisted artifacts
- validation gaps in imports, parser outputs, model-routing bundles, device-sync inputs, and other external or operator-supplied data
- unsafe local control-plane behavior, including localhost assumptions, redirect/origin handling, auth/account actions, and separation between web, CLI, and `device-syncd`
- replay, idempotency, or state-transition bugs that could duplicate, drop, or misattribute health records

Prefer concrete, repo-specific issues over generic best practices.

Final response contract:
- Return one downloadable `.patch` attachment containing a single unified diff for every change you chose to make in this pass.
- Also return a short plain-text summary that says what you changed, what those changes fix or improve, and any important residual concerns you left untouched.
- Keep the summary concise and factual; do not return a long prose review or any alternate structured findings template.
- If you find no safe actionable changes, return a short plain-text summary saying so and attach no patch.
