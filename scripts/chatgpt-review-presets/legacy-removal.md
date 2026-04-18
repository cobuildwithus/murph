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
- Return a concise plain-text review with the highest-value hard-cut legacy-removal recommendations from this pass.
- For each recommendation, cite the concrete files or symbols involved, explain why the hard cut is safe, and recommend the smallest safe follow-up.
- Keep the response concise and factual; do not return a long prose review, a patch, or a diff.
- If you find no safe actionable changes, return a short plain-text summary saying so.
