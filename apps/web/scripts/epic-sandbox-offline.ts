// Compatibility entrypoint for a human-assisted qualification run.
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { homedir } from "node:os";
import { callback, check, requireClient } from "./epic-proof/policy";

try {
  const [id, pem, kid, jwks, redirect, cert, key] = process.argv.slice(2);
  if (id) {
    const keys = join(homedir(), ".config/murph/epic");
    requireClient(id);
    check(pem === join(keys, "sandbox-private.pem") && cert === join(keys, "loopback-cert.pem") &&
      key === join(keys, "loopback-key.pem") && kid === "murph-sandbox-sF88F1MiYZ5b" &&
      new URL(jwks!).pathname === "/.well-known/epic/sandbox.jwks.json" && redirect === callback);
  }
  process.exitCode = spawnSync(process.execPath, ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", "scripts/epic-proof/run.mjs", "--vendor", "epic", "--interactive"], {
    stdio: "inherit", env: { ...process.env, EPIC_SMART_NON_PRODUCTION_CLIENT_ID: id ?? process.env.EPIC_SMART_NON_PRODUCTION_CLIENT_ID },
  }).status ?? 1;
} catch { process.exitCode = 1; }
