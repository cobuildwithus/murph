Run a security audit for Murph.

Prioritize:
- canonical vault trust boundaries, unintended writes, and corruption of human- or machine-facing source-of-truth data
- leakage of sensitive health data, tokens, session state, or provider credentials through logs, CLI/web output, docs, fixtures, or persisted artifacts
- validation gaps in imports, parser outputs, model-routing bundles, device-sync inputs, and other external or operator-supplied data
- unsafe local control-plane behavior, including localhost assumptions, redirect/origin handling, auth/account actions, and separation between web, CLI, and `device-syncd`
- replay, idempotency, or state-transition bugs that could duplicate, drop, or misattribute health records

Prefer concrete, repo-specific issues over generic best practices.


Patch-file output:
- Please return your final response as a single `.patch` file attachment with a `.patch` filename rather than as a normal prose review.
- Put all actionable fixes into one unified diff that we can download and apply directly.
- Limit the patch to concrete changes that fit this review scope, and keep the diff self-contained.
- If there are important residual concerns that you did not change, list them briefly outside the patch.
- If you find no actionable issues, say so explicitly instead of inventing a patch.
