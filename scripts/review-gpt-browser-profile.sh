#!/usr/bin/env bash

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  set -euo pipefail
fi

murph_review_gpt_find_repo_root() {
  local dir="$1"
  while [[ "$dir" != "/" ]]; do
    if [[ -f "$dir/package.json" ]] && grep -q '"name"[[:space:]]*:[[:space:]]*"murph-workspace"' "$dir/package.json"; then
      printf '%s\n' "$dir"
      return 0
    fi
    dir="$(dirname "$dir")"
  done
  return 1
}

murph_review_gpt_repo_root() {
  if [[ -n "${MURPH_REVIEW_GPT_REPO_ROOT:-}" ]]; then
    printf '%s\n' "$MURPH_REVIEW_GPT_REPO_ROOT"
    return 0
  fi

  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
  murph_review_gpt_find_repo_root "$(dirname "$script_dir")"
}

murph_review_gpt_profile_root() {
  local profile_slug="$1"
  local repo_root
  repo_root="$(murph_review_gpt_repo_root)" || return 1
  printf '%s\n' "$repo_root/output-packages/review-gpt-profiles/$profile_slug"
}

murph_review_gpt_load_profile() {
  local profile_slug="$1"
  local repo_root profile_root env_file
  repo_root="$(murph_review_gpt_repo_root)" || return 1
  profile_root="$repo_root/output-packages/review-gpt-profiles/$profile_slug"
  env_file="$profile_root/profile.env"

  if [[ ! -f "$env_file" ]]; then
    echo "Missing profile config: $env_file" >&2
    return 1
  fi

  unset profile_name profile_bundle_id profile_port profile_browser_profile profile_icon_path
  unset profile_product_dir_name profile_user_data_dir
  # shellcheck source=/dev/null
  . "$env_file"

  : "${profile_name:?Missing profile_name in $env_file}"
  : "${profile_bundle_id:?Missing profile_bundle_id in $env_file}"
  : "${profile_port:?Missing profile_port in $env_file}"

  profile_browser_profile="${profile_browser_profile:-Default}"
  profile_icon_path="${profile_icon_path:-$profile_root/profile.icns}"
  profile_product_dir_name="${profile_product_dir_name:-MurphReviewGPT/$profile_name}"
  profile_user_data_dir="${profile_user_data_dir:-$HOME/Library/Application Support/$profile_product_dir_name}"

  MURPH_REVIEW_GPT_PROFILE_SLUG="$profile_slug"
  MURPH_REVIEW_GPT_PROFILE_ROOT="$profile_root"
  MURPH_REVIEW_GPT_PROFILE_NAME="$profile_name"
  MURPH_REVIEW_GPT_PROFILE_BUNDLE_ID="$profile_bundle_id"
  MURPH_REVIEW_GPT_PROFILE_PORT="$profile_port"
  MURPH_REVIEW_GPT_PROFILE_BROWSER_PROFILE="$profile_browser_profile"
  MURPH_REVIEW_GPT_PROFILE_ICON_PATH="$profile_icon_path"
  MURPH_REVIEW_GPT_PROFILE_PRODUCT_DIR_NAME="$profile_product_dir_name"
  MURPH_REVIEW_GPT_PROFILE_USER_DATA_DIR="$profile_user_data_dir"
}

murph_review_gpt_source_app() {
  printf '%s\n' "/Applications/Brave Browser.app"
}

murph_review_gpt_profile_app_path() {
  local profile_slug="$1"
  murph_review_gpt_load_profile "$profile_slug" || return 1
  printf '%s\n' "$MURPH_REVIEW_GPT_PROFILE_ROOT/$MURPH_REVIEW_GPT_PROFILE_NAME.app"
}

murph_review_gpt_profile_user_data_dir() {
  local profile_slug="$1"
  murph_review_gpt_load_profile "$profile_slug" || return 1
  printf '%s\n' "$MURPH_REVIEW_GPT_PROFILE_USER_DATA_DIR"
}

murph_review_gpt_profile_browser_endpoint() {
  local profile_slug="$1"
  murph_review_gpt_load_profile "$profile_slug" || return 1
  printf 'http://127.0.0.1:%s\n' "$MURPH_REVIEW_GPT_PROFILE_PORT"
}

murph_review_gpt_profile_ensure_app() {
  local profile_slug="$1"
  local source_app target_app target_info target_icon_dest
  local source_version target_version current_name current_bundle_id current_icon_name current_product_dir_name
  local current_icon_md5 target_icon_md5 needs_rebuild lsregister

  murph_review_gpt_load_profile "$profile_slug" || return 1

  source_app="$(murph_review_gpt_source_app)"
  target_app="$MURPH_REVIEW_GPT_PROFILE_ROOT/$MURPH_REVIEW_GPT_PROFILE_NAME.app"
  target_info="$target_app/Contents/Info.plist"
  target_icon_dest="$target_app/Contents/Resources/app.icns"

  if [[ ! -d "$source_app" ]]; then
    echo "Missing source browser app: $source_app" >&2
    return 1
  fi

  read_plist_value() {
    local plist_path="$1"
    local key="$2"
    /usr/libexec/PlistBuddy -c "Print :$key" "$plist_path" 2>/dev/null || true
  }

  source_version="$(read_plist_value "$source_app/Contents/Info.plist" CFBundleShortVersionString)"
  target_version=""
  current_name=""
  current_bundle_id=""
  current_icon_name=""
  current_product_dir_name=""
  current_icon_md5=""
  target_icon_md5=""
  needs_rebuild=0

  if [[ -f "$target_info" ]]; then
    target_version="$(read_plist_value "$target_info" CFBundleShortVersionString)"
    current_name="$(read_plist_value "$target_info" CFBundleDisplayName)"
    current_bundle_id="$(read_plist_value "$target_info" CFBundleIdentifier)"
    current_icon_name="$(read_plist_value "$target_info" CFBundleIconName)"
    current_product_dir_name="$(read_plist_value "$target_info" CrProductDirName)"
  fi

  if [[ -f "$target_icon_dest" ]]; then
    current_icon_md5="$(md5 -q "$target_icon_dest" 2>/dev/null || true)"
  fi
  if [[ -f "$MURPH_REVIEW_GPT_PROFILE_ICON_PATH" ]]; then
    target_icon_md5="$(md5 -q "$MURPH_REVIEW_GPT_PROFILE_ICON_PATH" 2>/dev/null || true)"
  fi

  if [[ ! -d "$target_app" || "$source_version" != "$target_version" || "$current_name" != "$MURPH_REVIEW_GPT_PROFILE_NAME" || "$current_bundle_id" != "$MURPH_REVIEW_GPT_PROFILE_BUNDLE_ID" || "$current_product_dir_name" != "$MURPH_REVIEW_GPT_PROFILE_PRODUCT_DIR_NAME" || -n "$current_icon_name" ]]; then
    needs_rebuild=1
  fi
  if [[ -n "$target_icon_md5" && "$current_icon_md5" != "$target_icon_md5" ]]; then
    needs_rebuild=1
  fi

  if [[ "$needs_rebuild" -eq 1 ]]; then
    rm -rf "$target_app"
    mkdir -p "$MURPH_REVIEW_GPT_PROFILE_ROOT"
    if ! cp -cR "$source_app" "$target_app" 2>/dev/null; then
      ditto "$source_app" "$target_app"
    fi

    /usr/libexec/PlistBuddy -c "Set :CFBundleDisplayName $MURPH_REVIEW_GPT_PROFILE_NAME" "$target_info" \
      || /usr/libexec/PlistBuddy -c "Add :CFBundleDisplayName string $MURPH_REVIEW_GPT_PROFILE_NAME" "$target_info"
    /usr/libexec/PlistBuddy -c "Set :CFBundleName $MURPH_REVIEW_GPT_PROFILE_NAME" "$target_info" \
      || /usr/libexec/PlistBuddy -c "Add :CFBundleName string $MURPH_REVIEW_GPT_PROFILE_NAME" "$target_info"
    /usr/libexec/PlistBuddy -c "Set :CFBundleIdentifier $MURPH_REVIEW_GPT_PROFILE_BUNDLE_ID" "$target_info" \
      || /usr/libexec/PlistBuddy -c "Add :CFBundleIdentifier string $MURPH_REVIEW_GPT_PROFILE_BUNDLE_ID" "$target_info"
    /usr/libexec/PlistBuddy -c "Delete :CFBundleIconName" "$target_info" 2>/dev/null || true
    /usr/libexec/PlistBuddy -c "Set :CFBundleIconFile app.icns" "$target_info" \
      || /usr/libexec/PlistBuddy -c "Add :CFBundleIconFile string app.icns" "$target_info"
    /usr/libexec/PlistBuddy -c "Set :CrProductDirName $MURPH_REVIEW_GPT_PROFILE_PRODUCT_DIR_NAME" "$target_info" \
      || /usr/libexec/PlistBuddy -c "Add :CrProductDirName string $MURPH_REVIEW_GPT_PROFILE_PRODUCT_DIR_NAME" "$target_info"

    if [[ -f "$MURPH_REVIEW_GPT_PROFILE_ICON_PATH" ]]; then
      cp "$MURPH_REVIEW_GPT_PROFILE_ICON_PATH" "$target_icon_dest"
    fi

    xattr -cr "$target_app" || true
    /usr/bin/codesign --force --deep --sign - "$target_app" >/dev/null

    lsregister="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"
    if [[ -x "$lsregister" ]]; then
      "$lsregister" -f "$target_app" >/dev/null 2>&1 || true
    fi
  fi

  printf '%s\n' "$target_app"
}

murph_review_gpt_profile_browser_binary() {
  local profile_slug="$1"
  local target_app
  target_app="$(murph_review_gpt_profile_ensure_app "$profile_slug")" || return 1
  printf '%s\n' "$target_app/Contents/MacOS/Brave Browser"
}

murph_review_gpt_profile_open_chatgpt() {
  local profile_slug="$1"
  local target_app user_data_dir
  target_app="$(murph_review_gpt_profile_ensure_app "$profile_slug")" || return 1
  user_data_dir="$(murph_review_gpt_profile_user_data_dir "$profile_slug")" || return 1
  murph_review_gpt_load_profile "$profile_slug" || return 1

  mkdir -p "$user_data_dir"

  open -na "$target_app" --args \
    "--user-data-dir=$user_data_dir" \
    "--profile-directory=$MURPH_REVIEW_GPT_PROFILE_BROWSER_PROFILE" \
    "--remote-debugging-port=$MURPH_REVIEW_GPT_PROFILE_PORT" \
    --new-window \
    "https://chatgpt.com/"
}

murph_review_gpt_profile_activate() {
  local profile_slug="$1"
  murph_review_gpt_load_profile "$profile_slug" || return 1
  osascript -e "tell application \"$MURPH_REVIEW_GPT_PROFILE_NAME\" to activate"
}

murph_review_gpt_profile_process_ids() {
  local profile_slug="$1"
  local app_path product_dir_name
  murph_review_gpt_load_profile "$profile_slug" || return 1

  app_path="$MURPH_REVIEW_GPT_PROFILE_ROOT/$MURPH_REVIEW_GPT_PROFILE_NAME.app"
  product_dir_name="$MURPH_REVIEW_GPT_PROFILE_PRODUCT_DIR_NAME"

  ps -axo pid=,command= | awk -v app="$app_path" -v product="$product_dir_name" 'index($0, app) || index($0, product) { print $1 }'
}

murph_review_gpt_profile_endpoint_ready() {
  local profile_slug="$1"
  local browser_endpoint
  browser_endpoint="$(murph_review_gpt_profile_browser_endpoint "$profile_slug")" || return 1
  curl --silent --show-error --fail --max-time 1 "$browser_endpoint/json/version" >/dev/null 2>&1
}

murph_review_gpt_profile_wait_for_endpoint() {
  local profile_slug="$1"
  local browser_endpoint=""
  local attempt=0
  local max_attempts="${2:-50}"

  browser_endpoint="$(murph_review_gpt_profile_browser_endpoint "$profile_slug")" || return 1

  while (( attempt < max_attempts )); do
    if murph_review_gpt_profile_endpoint_ready "$profile_slug"; then
      return 0
    fi
    sleep 0.2
    attempt=$((attempt + 1))
  done

  echo "Error: managed browser failed to start on ${browser_endpoint}." >&2
  return 1
}

murph_review_gpt_profile_stop_processes() {
  local profile_slug="$1"
  local pids

  pids="$(murph_review_gpt_profile_process_ids "$profile_slug")" || return 1
  if [[ -z "$pids" ]]; then
    return 0
  fi

  kill -TERM $pids 2>/dev/null || true
  sleep 2

  pids="$(murph_review_gpt_profile_process_ids "$profile_slug")" || return 1
  if [[ -n "$pids" ]]; then
    kill -KILL $pids 2>/dev/null || true
    sleep 1
  fi
}

murph_review_gpt_profile_export_browser_env() {
  local profile_slug="$1"
  local browser_binary user_data_dir browser_endpoint

  browser_binary="$(murph_review_gpt_profile_browser_binary "$profile_slug")" || return 1
  user_data_dir="$(murph_review_gpt_profile_user_data_dir "$profile_slug")" || return 1
  browser_endpoint="$(murph_review_gpt_profile_browser_endpoint "$profile_slug")" || return 1
  murph_review_gpt_load_profile "$profile_slug" || return 1

  export browser_binary_path="$browser_binary"
  export managed_browser_user_data_dir="$user_data_dir"
  export managed_browser_profile="$MURPH_REVIEW_GPT_PROFILE_BROWSER_PROFILE"
  export managed_browser_port="$MURPH_REVIEW_GPT_PROFILE_PORT"
  export MURPH_REVIEW_GPT_BROWSER_ENDPOINT="$browser_endpoint"
  export MURPH_REVIEW_GPT_PROFILE_SLUG="$profile_slug"
  export MURPH_REVIEW_GPT_PROFILE_NAME
  export MURPH_REVIEW_GPT_PROFILE_PORT
  export MURPH_REVIEW_GPT_PROFILE_BROWSER_PROFILE
  export MURPH_REVIEW_GPT_PROFILE_PRODUCT_DIR_NAME
  export MURPH_REVIEW_GPT_PROFILE_USER_DATA_DIR
}

murph_review_gpt_profile_apply_browser_defaults() {
  local profile_slug="$1"
  local browser_binary user_data_dir browser_endpoint

  browser_binary="$(murph_review_gpt_profile_browser_binary "$profile_slug")" || return 1
  user_data_dir="$(murph_review_gpt_profile_user_data_dir "$profile_slug")" || return 1
  browser_endpoint="$(murph_review_gpt_profile_browser_endpoint "$profile_slug")" || return 1
  murph_review_gpt_load_profile "$profile_slug" || return 1

  browser_binary_path="${browser_binary_path:-${browser_binary}}"
  managed_browser_user_data_dir="${managed_browser_user_data_dir:-${user_data_dir}}"
  managed_browser_profile="${managed_browser_profile:-${MURPH_REVIEW_GPT_PROFILE_BROWSER_PROFILE}}"
  managed_browser_port="${managed_browser_port:-${MURPH_REVIEW_GPT_PROFILE_PORT}}"
  MURPH_REVIEW_GPT_BROWSER_ENDPOINT="${MURPH_REVIEW_GPT_BROWSER_ENDPOINT:-${browser_endpoint}}"
}

murph_review_gpt_profile_prepare_browser_env() {
  local profile_slug="$1"
  local running_pids

  murph_review_gpt_profile_export_browser_env "$profile_slug" || return 1

  if murph_review_gpt_profile_endpoint_ready "$profile_slug"; then
    return 0
  fi

  running_pids="$(murph_review_gpt_profile_process_ids "$profile_slug")" || return 1
  if [[ -n "$running_pids" ]]; then
    murph_review_gpt_profile_stop_processes "$profile_slug" || return 1
  fi
  murph_review_gpt_profile_open_chatgpt "$profile_slug" >/dev/null 2>&1 || return 1
  murph_review_gpt_profile_wait_for_endpoint "$profile_slug" || return 1
}

murph_review_gpt_resolve_config_path() {
  local profile_slug="$1"
  local config_override="${2:-}"
  local repo_root config_path
  repo_root="$(murph_review_gpt_repo_root)" || return 1

  if [[ -n "$config_override" ]]; then
    if [[ "$config_override" == /* ]]; then
      printf '%s\n' "$config_override"
    else
      printf '%s\n' "$repo_root/$config_override"
    fi
    return 0
  fi

  murph_review_gpt_load_profile "$profile_slug" || return 1
  config_path="$repo_root/scripts/review-gpt.config.sh"
  if [[ -f "$MURPH_REVIEW_GPT_PROFILE_ROOT/review-gpt.$profile_slug.config.sh" ]]; then
    config_path="$MURPH_REVIEW_GPT_PROFILE_ROOT/review-gpt.$profile_slug.config.sh"
  fi
  printf '%s\n' "$config_path"
}

murph_review_gpt_args_skip_browser_prepare() {
  local arg
  case "${1:-}" in
    completions|mcp|skills)
      return 0
      ;;
  esac

  for arg in "$@"; do
    case "$arg" in
      -h|--help|--version|--dry-run|--list-presets|--schema|--llms|--llms-full|--mcp)
        return 0
        ;;
    esac
  done
  return 1
}

murph_review_gpt_args_include_option() {
  local option_name="$1"
  shift

  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      "$option_name"|"$option_name="*)
        return 0
        ;;
    esac
    shift
  done

  return 1
}

murph_review_gpt_profile_run_review_gpt() {
  local profile_slug="$1"
  shift

  local repo_root config_override="" config_path
  repo_root="$(murph_review_gpt_repo_root)" || return 1

  while [[ "$#" -gt 0 ]]; do
    case "$1" in
      --config|--config-path)
        [[ "$#" -ge 2 ]] || {
          echo "Missing value for $1." >&2
          return 1
        }
        config_override="$2"
        shift 2
        ;;
      --config=*|--config-path=*)
        config_override="${1#*=}"
        shift
        ;;
      *)
        break
        ;;
    esac
  done

  config_path="$(murph_review_gpt_resolve_config_path "$profile_slug" "$config_override")" || return 1

  cd "$repo_root"
  if [[ "${1:-}" == "thread" ]]; then
    shift
    [[ "$#" -gt 0 ]] || {
      pnpm exec cobuild-review-gpt thread --help
      return 1
    }
    murph_review_gpt_profile_run_thread "$profile_slug" "$@"
  fi
  if [[ "${1:-}" == "delay" ]]; then
    shift
    if ! murph_review_gpt_args_skip_browser_prepare "$@" || murph_review_gpt_args_include_option --dry-run "$@"; then
      murph_review_gpt_profile_export_browser_env "$profile_slug" || return 1
    fi
    exec pnpm exec cobuild-review-gpt delay --config "$config_path" "$@"
  fi

  if murph_review_gpt_args_skip_browser_prepare "$@"; then
    if murph_review_gpt_args_include_option --dry-run "$@"; then
      murph_review_gpt_profile_export_browser_env "$profile_slug" || return 1
    fi
    exec pnpm exec cobuild-review-gpt --config "$config_path" "$@"
  fi

  murph_review_gpt_profile_prepare_browser_env "$profile_slug" || return 1
  exec pnpm exec cobuild-review-gpt --config "$config_path" "$@"
}

murph_review_gpt_profile_run_thread() {
  local profile_slug="$1"
  shift

  local repo_root thread_browser_endpoint="${MURPH_REVIEW_GPT_BROWSER_ENDPOINT:-}"
  repo_root="$(murph_review_gpt_repo_root)" || return 1

  cd "$repo_root"
  if murph_review_gpt_args_skip_browser_prepare "$@"; then
    exec pnpm exec cobuild-review-gpt thread "$@"
  fi
  if murph_review_gpt_args_include_option --browser-endpoint "$@"; then
    exec pnpm exec cobuild-review-gpt thread "$@"
  fi
  if [[ "${1:-}" == "wake" ]]; then
    if [[ -z "$thread_browser_endpoint" ]]; then
      thread_browser_endpoint="$(murph_review_gpt_profile_browser_endpoint "$profile_slug")" || return 1
    fi
    exec pnpm exec cobuild-review-gpt thread "$@" --browser-endpoint "$thread_browser_endpoint"
  fi
  if [[ -z "$thread_browser_endpoint" ]]; then
    murph_review_gpt_profile_prepare_browser_env "$profile_slug" || return 1
    thread_browser_endpoint="$MURPH_REVIEW_GPT_BROWSER_ENDPOINT"
  fi
  exec pnpm exec cobuild-review-gpt thread "$@" --browser-endpoint "$thread_browser_endpoint"
}

murph_review_gpt_profile_run_research() {
  local profile_slug="$1"
  shift

  murph_review_gpt_profile_prepare_browser_env "$profile_slug" || return 1

  export RESEARCH_MANAGED_BROWSER_LANE="$profile_slug"
  export RESEARCH_MANAGED_BROWSER_USER_DATA_DIR="$managed_browser_user_data_dir"
  export RESEARCH_MANAGED_BROWSER_PROFILE="$managed_browser_profile"
  export RESEARCH_MANAGED_BROWSER_ENDPOINT="$MURPH_REVIEW_GPT_BROWSER_ENDPOINT"
  export RESEARCH_MANAGED_BROWSER_PORT="$managed_browser_port"
  export RESEARCH_THREAD_EXPORT_BROWSER_ENDPOINT="$MURPH_REVIEW_GPT_BROWSER_ENDPOINT"

  exec "$@"
}

murph_review_gpt_profile_usage() {
  cat <<'EOF'
Usage:
  bash scripts/review-gpt-browser-profile.sh ensure-app <profile-slug>
  bash scripts/review-gpt-browser-profile.sh open <profile-slug>
  bash scripts/review-gpt-browser-profile.sh activate <profile-slug>
  bash scripts/review-gpt-browser-profile.sh browser-binary <profile-slug>
  bash scripts/review-gpt-browser-profile.sh browser-endpoint <profile-slug>
  bash scripts/review-gpt-browser-profile.sh ensure-endpoint <profile-slug>
  bash scripts/review-gpt-browser-profile.sh user-data-dir <profile-slug>
  bash scripts/review-gpt-browser-profile.sh review-gpt <profile-slug> [--config-path <path>] [review-gpt args...]
  bash scripts/review-gpt-browser-profile.sh thread <profile-slug> <thread args...>
  bash scripts/review-gpt-browser-profile.sh research <profile-slug> <command...>
EOF
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  subcommand="${1:-}"
  profile_slug="${2:-}"

  case "$subcommand" in
    ensure-app)
      [[ -n "$profile_slug" ]] || { murph_review_gpt_profile_usage >&2; exit 1; }
      murph_review_gpt_profile_ensure_app "$profile_slug"
      ;;
    open)
      [[ -n "$profile_slug" ]] || { murph_review_gpt_profile_usage >&2; exit 1; }
      murph_review_gpt_profile_open_chatgpt "$profile_slug"
      ;;
    activate)
      [[ -n "$profile_slug" ]] || { murph_review_gpt_profile_usage >&2; exit 1; }
      murph_review_gpt_profile_activate "$profile_slug"
      ;;
    browser-binary)
      [[ -n "$profile_slug" ]] || { murph_review_gpt_profile_usage >&2; exit 1; }
      murph_review_gpt_profile_browser_binary "$profile_slug"
      ;;
    browser-endpoint)
      [[ -n "$profile_slug" ]] || { murph_review_gpt_profile_usage >&2; exit 1; }
      murph_review_gpt_profile_browser_endpoint "$profile_slug"
      ;;
    ensure-endpoint)
      [[ -n "$profile_slug" ]] || { murph_review_gpt_profile_usage >&2; exit 1; }
      murph_review_gpt_profile_prepare_browser_env "$profile_slug"
      printf '%s\n' "$MURPH_REVIEW_GPT_BROWSER_ENDPOINT"
      ;;
    user-data-dir)
      [[ -n "$profile_slug" ]] || { murph_review_gpt_profile_usage >&2; exit 1; }
      murph_review_gpt_profile_user_data_dir "$profile_slug"
      ;;
    review-gpt)
      [[ -n "$profile_slug" ]] || { murph_review_gpt_profile_usage >&2; exit 1; }
      shift 2
      murph_review_gpt_profile_run_review_gpt "$profile_slug" "$@"
      ;;
    thread)
      [[ -n "$profile_slug" ]] || { murph_review_gpt_profile_usage >&2; exit 1; }
      shift 2
      [[ "$#" -gt 0 ]] || { murph_review_gpt_profile_usage >&2; exit 1; }
      murph_review_gpt_profile_run_thread "$profile_slug" "$@"
      ;;
    research)
      [[ -n "$profile_slug" ]] || { murph_review_gpt_profile_usage >&2; exit 1; }
      shift 2
      [[ "$#" -gt 0 ]] || { murph_review_gpt_profile_usage >&2; exit 1; }
      murph_review_gpt_profile_run_research "$profile_slug" "$@"
      ;;
    *)
      murph_review_gpt_profile_usage >&2
      exit 1
      ;;
  esac
fi
