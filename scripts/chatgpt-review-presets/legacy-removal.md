Run a greenfield legacy-removal audit for Murph.

Assume:
- there are no live deployments or external users to preserve
- local config, state, caches, and setup can be blown away and recreated
- backwards compatibility should survive only when the current architecture still actively depends on it

Prioritize finding code we can reasonably delete now:
- legacy config readers, schema migrations, state-shape fallbacks, alias env vars, and compatibility-only normalization
- dual-read or dual-write paths kept only for old local data
- deprecated commands, flags, adapters, wrappers, or routing branches that exist only to preserve older flows
- old storage layouts, id aliases, import shims, or upgrade scaffolding that no longer protects a real cutover risk
- docs, tests, and verification steps that only justify removed compatibility paths

For each recommendation:
- cite the files, symbols, and compatibility behavior involved
- explain why a hard cut is safe here
- describe exactly what can be removed and what follow-on cleanup should happen with it
- call out the concrete risk if the code is removed incorrectly

Keep:
- code that still protects real trust boundaries, current runtime contracts, or active operator workflows
- anything you cannot justify removing from current code evidence

Final response contract:
- Return one downloadable `.patch` attachment containing a single unified diff for every change you chose to make in this pass.
- Also return a short plain-text summary that says what you changed, what those changes fix or improve, and any important residual concerns you left untouched.
- Keep the summary concise and factual; do not return a long prose review or any alternate structured findings template.
- If you find no safe actionable changes, return a short plain-text summary saying so and attach no patch.
