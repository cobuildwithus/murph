#!/usr/bin/env bash
name_prefix="murph-chatgpt-audit"
include_tests=0
include_docs=0
preset_dir="scripts/chatgpt-review-presets"
package_script="scripts/package-audit-context.sh"

review_gpt_register_dir_preset "security" "security-audit.md" \
  "General correctness and security audit focused on vault trust boundaries." \
  "security-audit" \
  "audit-security"
review_gpt_register_dir_preset "architecture" "architecture-review.md" \
  "Architecture and data-model review focused on simplification, composability, and long-term maintainability." \
  "architecture-review" \
  "data-model" \
  "refactor-architecture"
review_gpt_register_dir_preset "giant-file-composability" "giant-file-composability.md" \
  "Review giant files for multi-responsibility seams that should be split into smaller composable units." \
  "large-files" \
  "split-files" \
  "file-composability" \
  "large-file-composability"
review_gpt_register_dir_preset "data-model-composability" "data-model-composability-review.md" \
  "Review Murph's data structures and data model for simpler, more composable, and more scalable shapes." \
  "data-structures" \
  "data-model-review" \
  "composable-data-model" \
  "scalable-data-model"
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
