Run a security audit for Murph.

Prioritize:
- canonical vault trust boundaries, unintended writes, and corruption of human- or machine-facing source-of-truth data
- leakage of sensitive health data, tokens, session state, or provider credentials through logs, CLI/web output, docs, fixtures, or persisted artifacts
- validation gaps in imports, parser outputs, model-routing bundles, device-sync inputs, and other external or operator-supplied data
- unsafe local control-plane behavior, including localhost assumptions, redirect/origin handling, auth/account actions, and separation between web, CLI, and `device-syncd`
- replay, idempotency, or state-transition bugs that could duplicate, drop, or misattribute health records

Prefer concrete, repo-specific issues over generic best practices.


Parallel-agent output:
- Please return your final response as a set of copy/paste-ready prompts for parallel agents rather than as a normal prose review.
- Create one prompt per distinct issue or tightly related issue cluster.
- In each prompt, describe the issue in detail, explain why it matters, point to the relevant files, symbols, or tests, and include your best guess at a concrete fix.
- Make each prompt self-contained and specific enough that we can hand it directly to an agent with minimal extra context.
- If you find no actionable issues, say so explicitly instead of inventing prompts.
