#!/usr/bin/env bash
script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "${script_dir}/.." && pwd)"
profile_helper="${repo_root}/scripts/review-gpt-browser-profile.sh"
review_gpt_profile_slug="${MURPH_REVIEW_GPT_PROFILE_SLUG:-phlebas}"

if [[ -r "${profile_helper}" ]]; then
  # shellcheck source=/dev/null
  . "${profile_helper}"
  murph_review_gpt_profile_apply_browser_defaults "${review_gpt_profile_slug}" || true
fi

browser_binary_path="${browser_binary_path:-/Applications/Brave Browser.app/Contents/MacOS/Brave Browser}"
managed_browser_user_data_dir="${managed_browser_user_data_dir:-$HOME/Library/Application Support/${MURPH_REVIEW_GPT_PROFILE_PRODUCT_DIR_NAME:-MurphReviewGPT/Phlebas}}"
managed_browser_profile="${managed_browser_profile:-${MURPH_REVIEW_GPT_PROFILE_BROWSER_PROFILE:-Default}}"
managed_browser_port="${managed_browser_port:-${MURPH_REVIEW_GPT_PROFILE_PORT:-9442}}"

name_prefix="murph-chatgpt-audit"
snapshot_attachment_name="murph-review-gpt.repo-snapshot.zip"
repo_context_url="https://github.com/cobuildwithus/murph"
include_tests=0
include_docs=0
preset_dir="scripts/chatgpt-review-presets"
package_script="scripts/package-review-gpt-context.sh"

# Repo-owned repomix exclusions for ordinary review-gpt uploads. Health
# Commons research workspaces use their own generated review-gpt config and
# package script, so do not widen this ordinary review bundle for them.
repomix_ignore_patterns=(
  ".git/**"
  ".env"
  ".env.*"
  "**/.env"
  "**/.env.*"
  "node_modules/**"
  "**/node_modules/**"
  ".next/**"
  "**/.next/**"
  "dist/**"
  "**/dist/**"
  "build/**"
  "**/build/**"
  "coverage/**"
  "**/coverage/**"
  "*.tsbuildinfo"
  "**/*.tsbuildinfo"
  "audit-packages/**"
  "output-packages/**"
  "apps/web/app/.well-known/workflow/**"
  "packages/health-commons/content/**"
  "packages/health-commons/generated/**"
)

review_gpt_register_dir_preset "security" "security-audit.md" \
  "General correctness and security audit focused on vault trust boundaries." \
  "security-audit" \
  "audit-security"
review_gpt_register_dir_preset "privacy" "privacy.md" \
  "Privacy and data-minimization audit focused on storing as little user data as possible." \
  "data-minimization" \
  "privacy-minimization" \
  "minimal-retention" \
  "data-retention"
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
review_gpt_register_dir_preset "bug-hunt" "bug-hunt-high-value-seams.md" \
  "Bug-finding review focused on Murph's highest-value seams, invariants, and failure modes." \
  "bugs" \
  "bug-hunt" \
  "high-value-seams" \
  "failure-modes" \
  "invariant-violations"
review_gpt_register_dir_preset "legacy-removal" "legacy-removal.md" \
  "Greenfield hard-cut audit for removable legacy compatibility, migrations, and fallback paths." \
  "remove-legacy" \
  "legacy-cleanup" \
  "hard-cut" \
  "greenfield-hard-cut"
review_gpt_register_dir_preset "package-boundaries" "package-boundaries.md" \
  "Package-boundary, circular-dependency, and mixed-concern audit focused on workspace ownership seams." \
  "package-boundary" \
  "package-ownership" \
  "dependency-boundaries" \
  "circular-deps" \
  "circular-dependencies" \
  "mixed-package-concerns"
