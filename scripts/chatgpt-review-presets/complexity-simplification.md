You are running a behavior-preserving simplification pass for Murph.

Focus on:
- dead code, stale branches, and no-op abstractions
- duplicated logic where reuse is immediate and real
- overly nested control flow that can be flattened with clearer boundaries
- names or types that blur trust boundaries or state ownership

Constraints:
- do not change externally visible behavior
- do not invent new architecture without a concrete payoff
- report any risky simplification instead of applying it


Parallel-agent output:
- Please return your final response as a set of copy/paste-ready prompts for parallel agents rather than as a normal prose review.
- Create one prompt per distinct issue or tightly related issue cluster.
- In each prompt, describe the issue in detail, explain why it matters, point to the relevant files, symbols, or tests, and include your best guess at a concrete fix.
- Make each prompt self-contained and specific enough that we can hand it directly to an agent with minimal extra context.
- If you find no actionable issues, say so explicitly instead of inventing prompts.
