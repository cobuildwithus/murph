#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

config_path="$ROOT_DIR/scripts/review-gpt.config.sh"
list_presets=0
declare -a forward_args=()

while [[ $# -gt 0 ]]; do
  case "$1" in
    --list-presets)
      list_presets=1
      shift
      ;;
    *)
      forward_args+=("$1")
      shift
      ;;
  esac
done

print_presets() {
  local preset_rows
  local terminal_columns

  review_gpt_register_dir_preset() {
    local name="$1"
    local _file="$2"
    local description="$3"

    printf '%s\t%s\n' "$name" "$description"
  }

  # shellcheck source=/dev/null
  preset_rows="$(
    # shellcheck source=/dev/null
    source "$config_path"
  )"

  terminal_columns="${COLUMNS:-}"
  if [[ -z "$terminal_columns" ]] && [[ -t 1 ]]; then
    terminal_columns="$(tput cols 2>/dev/null || true)"
  fi

  COLUMNS="$terminal_columns" PRESET_ROWS="$preset_rows" CONFIG_PATH="$config_path" \
    node <<'NODE'
const rows = (process.env.PRESET_ROWS ?? '')
  .split('\n')
  .map((line) => line.trim())
  .filter(Boolean)
  .map((line) => {
    const tabIndex = line.indexOf('\t')
    return {
      name: tabIndex >= 0 ? line.slice(0, tabIndex) : line,
      description: tabIndex >= 0 ? line.slice(tabIndex + 1) : '',
    }
  })

const configPath = process.env.CONFIG_PATH ?? '<config>'
const columns = Number.parseInt(process.env.COLUMNS ?? '', 10)
const width = Number.isFinite(columns) && columns > 40 ? columns : 88
const descriptionWidth = Math.max(40, width - 6)

function wrap(text, maxWidth) {
  const words = text.trim().split(/\s+/u).filter(Boolean)
  const lines = []
  let current = ''

  for (const word of words) {
    if (!current) {
      current = word
      continue
    }

    if (`${current} ${word}`.length <= maxWidth) {
      current = `${current} ${word}`
      continue
    }

    lines.push(current)
    current = word
  }

  if (current) {
    lines.push(current)
  }

  return lines
}

console.log('Available presets')
console.log(`Source: ${configPath.replace(/^.*\/scripts\//u, 'scripts/')}`)
console.log('')

for (const row of rows) {
  console.log(`  ${row.name}`)
  const wrapped = wrap(row.description, descriptionWidth)
  for (const line of wrapped) {
    console.log(`    ${line}`)
  }
  console.log('')
}
NODE
}

if [[ "$list_presets" == "1" ]]; then
  print_presets
  exit 0
fi

if [[ "${#forward_args[@]}" -gt 0 ]]; then
  exec pnpm exec cobuild-review-gpt --config "$config_path" "${forward_args[@]}"
fi

exec pnpm exec cobuild-review-gpt --config "$config_path"
