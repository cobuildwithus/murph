import {
  HOSTED_CLI_BRIDGE_TOKEN_ENV,
  HOSTED_CLI_BRIDGE_URL_ENV,
  HOSTED_RUNTIME_PROCESS_ENV,
} from "@murphai/hosted-execution/cli-runtime-bridge";
import {
  MURPH_ASSISTANT_SKILLS_ROOT_ENV,
} from "@murphai/assistant-engine/assistant-skill-env";

export const HOSTED_CODEX_SHELL_ENVIRONMENT_INHERITANCE = "all";
export const HOSTED_CODEX_SHELL_ENVIRONMENT_INCLUDE_ONLY = [
  "CI",
  "CODEX_HOME",
  "CODEX_CA_CERTIFICATE",
  "COLORTERM",
  "CURL_CA_BUNDLE",
  "FORCE_COLOR",
  "HOME",
  HOSTED_CLI_BRIDGE_TOKEN_ENV,
  HOSTED_CLI_BRIDGE_URL_ENV,
  HOSTED_RUNTIME_PROCESS_ENV,
  MURPH_ASSISTANT_SKILLS_ROOT_ENV,
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  // Hosted provider CLIs run as Codex shell commands and read these keys to
  // mark egress for the Worker intercept. In hosted runs each value is only
  // the __cloudflare_injected__ sentinel; the real token is swapped in at
  // egress, so no raw provider key enters the runner shell.
  "EXA_API_KEY",
  "MAPBOX_ACCESS_TOKEN",
  "NODE_EXTRA_CA_CERTS",
  "NO_COLOR",
  "PATH",
  "REQUESTS_CA_BUNDLE",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TEMP",
  "TERM",
  "TMP",
  "TMPDIR",
  "VAULT",
] as const;
