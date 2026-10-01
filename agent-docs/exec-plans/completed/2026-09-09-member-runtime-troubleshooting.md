# Member runtime troubleshooting

Outcome: Murph answers authorized read-only questions about its current member workspace without inventing a confidentiality restriction.
Reaches: Private member troubleshooting; existing group, credential, and external-system boundaries remain owned by their current policies.
Proof: Focused real-Codex Terra reproduction, composed-prompt assertions, package typecheck, and exact-head CI.

- [x] Run synthetic diagnostics against the existing prompt. Three live Terra cases passed; the exact reported refusal was not reproduced. The scope wording remained ambiguous about Murph troubleshooting.
- [x] Clarify the existing direct scope paragraph. Composed-prompt checks and the same live Terra journey pass; group guidance is unchanged.
- [x] Review and publish the candidate with focused verification evidence.

Provider-input evidence: real native mixed-mode capture with identical base/head fixtures; o200k_base tokenization of the complete serialized model-visible request. Excluded transport cache key, client metadata, and item IDs; normalized temporary roots. Individual: 29,180 to 29,202 tokens (+22; +0.0754%), 134,940 to 135,075 bytes (+135). Group: 24,750 tokens and 114,747 bytes unchanged. Temporary capture code was removed.

Verification: 101 focused Assistant Engine tests, Assistant Engine typecheck, and 10 changelog rendering tests pass. Complexity is unchanged; the existing prompt-builder hotspots have no new branches. Final external review is not routed: this is prompt-primary work using existing workspace authority, with no permission, transport, credential, or state-owner change.

Delivery tracking: PR #3106 owns remaining exact-head CI, merge, and ordinary runner deployment. These are pending at plan closure; local implementation and verification are complete. Final Terra effect assertions pass with no dynamic tool calls, no media/card output, and unchanged diagnostic content.
Status: completed
Updated: 2026-09-09
Completed: 2026-09-09
