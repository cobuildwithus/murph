Murph does not use token incentives or economic security in the usual sense.

Review for operator-facing incentive issues such as:
- defaults that encourage unsafe behavior
- workflows that reward skipping validation or review
- confusing UX or automation that makes the wrong action feel easier than the right one

Final response contract:
- Return a concise plain-text review with the highest-value incentive or operator-default issues from this pass.
- For each item, cite the concrete files, defaults, or workflows involved, explain why they steer behavior the wrong way, and recommend the smallest safe follow-up.
- Keep the response concise and factual; do not return a long prose review, a patch, or a diff.
- If you find no safe actionable changes, return a short plain-text summary saying so.
