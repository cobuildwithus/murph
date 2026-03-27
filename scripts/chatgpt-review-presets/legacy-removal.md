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

Output:
- group findings into `remove now`, `remove after a small follow-up`, and `keep for now`
- within each group, order findings by impact on complexity reduction
- be explicit when a branch looks legacy but still appears required


Parallel-agent output:
- Please return your final response as a set of copy/paste-ready prompts for parallel agents rather than as a normal prose review.
- Create one prompt per distinct issue or tightly related issue cluster.
- In each prompt, describe the issue in detail, explain why it matters, point to the relevant files, symbols, or tests, and include your best guess at a concrete fix.
- Make each prompt self-contained and specific enough that we can hand it directly to an agent with minimal extra context.
- If you find no actionable issues, say so explicitly instead of inventing prompts.
