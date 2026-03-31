Murph does not use token incentives or economic security in the usual sense.

Review for operator-facing incentive issues such as:
- defaults that encourage unsafe behavior
- workflows that reward skipping validation or review
- confusing UX or automation that makes the wrong action feel easier than the right one

Final response contract:
- Return one downloadable `.patch` attachment containing a single unified diff for every change you chose to make in this pass.
- Also return a short plain-text summary that says what you changed, what those changes fix or improve, and any important residual concerns you left untouched.
- Keep the summary concise and factual; do not return a long prose review or any alternate structured findings template.
- If you find no safe actionable changes, return a short plain-text summary saying so and attach no patch.
