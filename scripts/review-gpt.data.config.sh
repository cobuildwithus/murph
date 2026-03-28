#!/usr/bin/env bash
name_prefix="murph-chatgpt-data"
include_tests=0
include_docs=0
preset_dir="scripts/chatgpt-review-presets"
package_script="scripts/package-data-context.sh"

review_gpt_register_dir_preset "data-model-composability" "data-model-composability-review.md" \
  "Review Murph's data structures and data model for simpler, more composable, and more scalable shapes." \
  "data-structures" \
  "data-model-review" \
  "composable-data-model" \
  "scalable-data-model"
