Run a security audit for Murph.

Prioritize:
- canonical vault trust boundaries, unintended writes, and corruption of human- or machine-facing source-of-truth data
- leakage of sensitive health data, tokens, session state, or provider credentials through logs, CLI/web output, docs, fixtures, or persisted artifacts
- validation gaps in imports, parser outputs, model-routing bundles, device-sync inputs, and other external or operator-supplied data
- unsafe local control-plane behavior, including localhost assumptions, redirect/origin handling, auth/account actions, and separation between web, CLI, and `device-syncd`
- replay, idempotency, or state-transition bugs that could duplicate, drop, or misattribute health records

Prefer concrete, repo-specific issues over generic best practices.

Final response contract:
- Return a concise plain-text review with the highest-value security issues from this pass.
- For each item, cite the concrete files or seams involved, explain the risk, and recommend the smallest safe follow-up.
- Keep the response concise and factual; do not return a long prose review, a patch, or a diff.
- If you find no safe actionable changes, return a short plain-text summary saying so.
