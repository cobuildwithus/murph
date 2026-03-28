Run a code quality audit for Murph.

Prioritize:
- unnecessary complexity
- stale or misleading abstractions
- brittle branching and error handling
- naming or type choices that hide intent

Recommend behavior-preserving simplifications when they materially improve clarity.


Parallel-agent output:
- Please return your final response as a set of copy/paste-ready prompts for parallel agents rather than as a normal prose review.
- Create one prompt per distinct issue or tightly related issue cluster.
- In each prompt, describe the issue in detail, explain why it matters, point to the relevant files, symbols, or tests, and include your best guess at a concrete fix.
- Make each prompt self-contained and specific enough that we can hand it directly to an agent with minimal extra context.
- If you find no actionable issues, say so explicitly instead of inventing prompts.
