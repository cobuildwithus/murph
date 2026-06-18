#!/usr/bin/env bash

labels_db_pg_secret_dir=""
labels_db_psql_bin="${PSQL_BIN:-psql}"

cleanup_labels_db_psql_env() {
  if [ -n "$labels_db_pg_secret_dir" ]; then
    rm -rf "$labels_db_pg_secret_dir"
    labels_db_pg_secret_dir=""
  fi
}

prepare_labels_db_psql_env() {
  local labels_db_url="${MURPH_LABELS_DB_URL:-}"

  if [ -z "$labels_db_url" ]; then
    echo "MURPH_LABELS_DB_URL is required" >&2
    exit 64
  fi

  if ! command -v "$labels_db_psql_bin" >/dev/null 2>&1; then
    echo "psql not found; set PSQL_BIN or install PostgreSQL client tools" >&2
    exit 69
  fi

  if ! command -v node >/dev/null 2>&1; then
    echo "node not found; install Node.js to prepare a secret-safe psql environment" >&2
    exit 69
  fi

  labels_db_pg_secret_dir="$(mktemp -d "${TMPDIR:-/tmp}/murph-labels-pg.XXXXXX")"
  local pg_env_file="$labels_db_pg_secret_dir/libpq-env.sh"
  local pg_pass_file="$labels_db_pg_secret_dir/pgpass"
  chmod 700 "$labels_db_pg_secret_dir"

  if ! printf '%s' "$labels_db_url" | node -e '
const fs = require("node:fs");
const [envPath, passPath] = process.argv.slice(1);
try {
const urlText = fs.readFileSync(0, "utf8");

if (urlText.includes("\n") || urlText.includes("\r")) {
  throw new Error("labels database URL must be a single line");
}

const parsed = new URL(urlText);
if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
  throw new Error("labels database URL must use postgres:// or postgresql://");
}

function decode(value) {
  return decodeURIComponent(value);
}

function shellQuote(value) {
  if (/[\0\r\n]/.test(value)) {
    throw new Error("labels database URL fields must not contain control characters");
  }
  return "\"" + value.replace(/["\\$`]/g, "\\$&") + "\"";
}

function pgpassEscape(value) {
  return value.replace(/\\/g, "\\\\").replace(/:/g, "\\:");
}

function systemRootCertPath() {
  const candidates = [
    "/etc/ssl/cert.pem",
    "/etc/ssl/certs/ca-certificates.crt",
    "/etc/pki/tls/certs/ca-bundle.crt",
    "/etc/ssl/ca-bundle.pem",
    "/opt/homebrew/etc/ca-certificates/cert.pem",
    "/opt/homebrew/etc/openssl@3/cert.pem",
    "/usr/local/etc/openssl@3/cert.pem",
  ];

  return candidates.find((candidate) => fs.existsSync(candidate));
}

const database = decode(parsed.pathname.replace(/^\/+/, ""));
if (!database) {
  throw new Error("labels database URL must include a database name");
}

const env = {
  PGHOST: decode(parsed.hostname),
  PGDATABASE: database,
};

if (parsed.port) {
  env.PGPORT = parsed.port;
}

const user = decode(parsed.username);
if (user) {
  env.PGUSER = user;
}

const pass = decode(parsed.password);
if (pass) {
  env.PGPASSFILE = passPath;
  const port = parsed.port || "*";
  const host = decode(parsed.hostname) || "*";
  const pgpass = [
    pgpassEscape(host),
    pgpassEscape(port),
    pgpassEscape(database),
    pgpassEscape(user || "*"),
    pgpassEscape(pass),
  ].join(":") + "\n";
  fs.writeFileSync(passPath, pgpass, { mode: 0o600 });
}

const queryEnv = new Map([
  ["application_name", "PGAPPNAME"],
  ["channel_binding", "PGCHANNELBINDING"],
  ["connect_timeout", "PGCONNECT_TIMEOUT"],
  ["gssencmode", "PGGSSENCMODE"],
  ["options", "PGOPTIONS"],
  ["sslcert", "PGSSLCERT"],
  ["sslkey", "PGSSLKEY"],
  ["sslmode", "PGSSLMODE"],
  ["sslrootcert", "PGSSLROOTCERT"],
  ["target_session_attrs", "PGTARGETSESSIONATTRS"],
]);

for (const [key, value] of parsed.searchParams.entries()) {
  const envName = queryEnv.get(key);
  if (!envName) {
    throw new Error(`unsupported labels database URL parameter for psql import: ${key}`);
  }
  if (key === "sslrootcert" && value === "system") {
    const rootCertPath = systemRootCertPath();
    if (rootCertPath) {
      env[envName] = rootCertPath;
    }
    continue;
  }
  if ((key === "sslcert" || key === "sslkey") && value === "system") {
    continue;
  }
  env[envName] = value;
}

const body = Object.entries(env)
  .map(([key, value]) => `${key}=${shellQuote(value)}`)
  .join("\n") + "\n";
fs.writeFileSync(envPath, body, { mode: 0o600 });
} catch {
  process.exit(1);
}
' "$pg_env_file" "$pg_pass_file"; then
    echo "labels database URL is invalid" >&2
    exit 65
  fi

  while IFS='=' read -r env_name _; do
    case "$env_name" in
      PG*)
        unset "$env_name"
        ;;
    esac
  done < <(env)

  # shellcheck disable=SC1090
  . "$pg_env_file"
  export PGHOST PGPORT PGDATABASE PGUSER PGPASSFILE PGAPPNAME PGCHANNELBINDING \
    PGCONNECT_TIMEOUT PGGSSENCMODE PGOPTIONS PGSSLCERT PGSSLKEY PGSSLMODE \
    PGSSLROOTCERT PGTARGETSESSIONATTRS
  unset MURPH_LABELS_DB_URL labels_db_url PGPASSWORD PGSERVICE PGSERVICEFILE
}

run_labels_psql() {
  "$labels_db_psql_bin" -X "$@"
}

labels_db_psql_copy_literal() {
  local copy_path="${1:-}"

  case "$copy_path" in
    *$'\n'*|*$'\r'*)
      echo "psql copy path must be a single line" >&2
      exit 64
      ;;
  esac

  printf "'%s'" "$(printf '%s' "$copy_path" | sed "s/'/''/g")"
}
