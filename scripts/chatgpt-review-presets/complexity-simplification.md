You are running a behavior-preserving simplification pass for Murph.

Focus on:

- dead code, stale branches, and no-op abstractions
- duplicated logic where reuse is immediate and real
- overly nested control flow that can be flattened with clearer boundaries
- names or types that blur trust boundaries or state ownership

Constraints:

- do not change externally visible behavior
- do not invent new architecture without a concrete payoff

Final response contract:

- Return a concise plain-text review with the highest-value behavior-preserving simplifications from this pass.
- For each item, cite the concrete files or symbols involved, explain the unnecessary complexity, and recommend the smallest safe follow-up.
- Keep the response concise and factual; do not return a long prose review, a patch, or a diff.
- If you find no safe actionable changes, return a short plain-text summary saying so.
