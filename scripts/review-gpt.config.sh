#!/usr/bin/env bash
name_prefix="murph-chatgpt-audit"
include_tests=0
include_docs=1
preset_dir="scripts/chatgpt-review-presets"
package_script="scripts/package-audit-context.sh"

review_gpt_register_dir_preset "security" "security-audit.md" \
  "General correctness and security audit focused on vault trust boundaries." \
  "security-audit" \
  "audit-security"
review_gpt_register_dir_preset "simplify" "complexity-simplification.md" \
  "Behavior-preserving simplification pass for Murph." \
  "complexity" \
  "complexity-simplification"
review_gpt_register_dir_preset "bad-code" "bad-code-quality.md" \
  "Code quality and anti-pattern review for Murph." \
  "anti-patterns" \
  "antipatterns" \
  "bad-practices" \
  "anti-patterns-and-bad-practices" \
  "code-quality" \
  "bad-code-quality"
review_gpt_register_dir_preset "legacy-removal" "legacy-removal.md" \
  "Greenfield hard-cut audit for removable legacy compatibility, migrations, and fallback paths." \
  "remove-legacy" \
  "legacy-cleanup" \
  "hard-cut" \
  "greenfield-hard-cut"
review_gpt_register_preset "test-coverage-audit" "agent-docs/prompts/test-coverage-audit.md" \
  "Post-simplify test-coverage audit that adds the highest-impact missing tests." \
  "coverage" \
  "coverage-audit"
review_gpt_register_preset "task-finish-review" "agent-docs/prompts/task-finish-review.md" \
  "Final completion audit for regressions, correctness, and security." \
  "finish" \
  "final-review"
review_gpt_register_preset_group "completion" \
  "Run the full completion workflow audit sequence." \
  "simplify" \
  "test-coverage-audit" \
  "task-finish-review"
