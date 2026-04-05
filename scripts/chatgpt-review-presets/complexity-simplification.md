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

- Return one downloadable `.patch` attachment containing a single unified diff for every change you chose to make in this pass.
- Also return a short plain-text summary that says what you changed, what those changes fix or improve, and any important residual concerns you left untouched.
- Keep the summary concise and factual; do not return a long prose review or any alternate structured findings template.
- If you find no safe actionable changes, return a short plain-text summary saying so and attach no patch.
