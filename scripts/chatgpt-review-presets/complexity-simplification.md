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

Output requirements:
- return findings ordered by severity: `high`, `medium`, `low`
- for each finding include: `severity`, `file:line`, `issue`, `impact`, `recommended fix`
- include `Open questions / assumptions` when uncertainty remains
- if no findings exist, say so explicitly and list any residual risk areas

Response format:
- return a normal text review, not a patch attachment and not follow-on prompts for more agents
- keep the focus on actionable simplification findings and the clearest concrete fixes
