import { createHash } from "node:crypto";

export const GITHUB_WIF_AUDIENCE = "//iam.googleapis.com/projects/662258957089/locations/global/workloadIdentityPools/github-actions/providers/github";
const REFRESH_SKEW_MS = 2 * 60_000;
const REQUEST_TIMEOUT_MS = 20_000;

// All credential requests reject redirects and discard provider error bodies.
export async function credentialJson(url, init = {}, label = "Credential request", fetchImpl = fetch) {
  try {
    const response = await fetchImpl(url, {
      ...init, redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error();
    }
    const value = await response.json();
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new Error(`${label} failed; no credential response was exposed.`);
  }
}

export function crc32c(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ ((crc & 1) ? 0x82f63b78 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function credential(value) {
  if (typeof value !== "string" || !value || value.length > 20_000 || /[\s\0]/u.test(value)) {
    throw new Error("Credential is missing or invalid.");
  }
  return value;
}

function assertAppId(appId) {
  // Frog already uses a GitHub client ID; GitHub accepts either as JWT iss.
  if (typeof appId !== "string" || !/^(?:[1-9][0-9]*|Iv[0-9][A-Za-z0-9.]{1,100})$/u.test(appId)) {
    throw new Error("GitHub App id or client id is invalid.");
  }
}

export function createKmsGitHubAppJwtSigner({ keyVersion, env = process.env, fetchImpl = fetch }) {
  if (typeof keyVersion !== "string" || !/^projects\/[a-z0-9-]+\/locations\/[a-z0-9-]+\/keyRings\/[A-Za-z0-9_-]+\/cryptoKeys\/[A-Za-z0-9_-]+\/cryptoKeyVersions\/[1-9][0-9]*$/u.test(keyVersion)) {
    throw new Error("GitHub App KMS key version is invalid.");
  }
  // Capture only the credential owner inputs; child processes need neither.
  const requestUrl = env.ACTIONS_ID_TOKEN_REQUEST_URL;
  const requestToken = env.ACTIONS_ID_TOKEN_REQUEST_TOKEN;
  return async ({ appId, now = Date.now }) => {
    assertAppId(appId);
    let oidcUrl;
    try {
      oidcUrl = new URL(requestUrl);
      if (oidcUrl.protocol !== "https:" || oidcUrl.username || oidcUrl.password) throw new Error();
      oidcUrl.searchParams.set("audience", GITHUB_WIF_AUDIENCE);
    } catch {
      throw new Error("GitHub OIDC request URL is unavailable or invalid.");
    }
    const subject = await credentialJson(oidcUrl, {
      headers: { authorization: `Bearer ${credential(requestToken)}` },
    }, "GitHub OIDC acquisition", fetchImpl);
    const google = await credentialJson("https://sts.googleapis.com/v1/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        audience: GITHUB_WIF_AUDIENCE,
        grant_type: "urn:ietf:params:oauth:grant-type:token-exchange",
        requested_token_type: "urn:ietf:params:oauth:token-type:access_token",
        scope: "https://www.googleapis.com/auth/cloud-platform",
        subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
        subject_token: credential(subject.value),
      }).toString(),
    }, "Google STS exchange", fetchImpl);
    if (google.token_type !== "Bearer" || !Number.isFinite(google.expires_in) || google.expires_in <= 0) {
      throw new Error("Google STS credential lifetime or type is invalid.");
    }
    const issuedAt = Math.floor(now() / 1000) - 60;
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const unsigned = `${encode({ alg: "RS256", typ: "JWT" })}.${encode({ exp: issuedAt + 9 * 60, iat: issuedAt, iss: appId })}`;
    const digest = createHash("sha256").update(unsigned).digest();
    const signed = await credentialJson(`https://cloudkms.googleapis.com/v1/${keyVersion}:asymmetricSign`, {
      method: "POST",
      headers: { authorization: `Bearer ${credential(google.access_token)}`, "content-type": "application/json" },
      body: JSON.stringify({ digest: { sha256: digest.toString("base64") }, digestCrc32c: String(crc32c(digest)) }),
    }, "GitHub App KMS signing", fetchImpl);
    const signature = typeof signed.signature === "string" ? Buffer.from(signed.signature, "base64") : Buffer.alloc(0);
    if (signed.name !== keyVersion || signed.verifiedDigestCrc32c !== true
      || signature.length !== 256 || signature.toString("base64") !== signed.signature
      || String(signed.signatureCrc32c) !== String(crc32c(signature))) {
      throw new Error("GitHub App KMS signature integrity check failed.");
    }
    return `${unsigned}.${signature.toString("base64url")}`;
  };
}

export function githubAppHeaders(token) {
  return {
    accept: "application/vnd.github+json", authorization: `Bearer ${token}`,
    "user-agent": "murph-github-app", "x-github-api-version": "2026-03-10",
  };
}

export async function revokeGitHubAppToken(token, { fetchImpl = fetch } = {}) {
  try {
    const response = await fetchImpl("https://api.github.com/installation/token", {
      method: "DELETE", headers: githubAppHeaders(credential(token)),
      redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    await response.body?.cancel();
    // Expired/already revoked tokens are also no longer usable.
    if (response.status !== 204 && response.status !== 401) throw new Error();
  } catch {
    throw new Error("GitHub App token revocation failed.");
  }
}

export function createGitHubAppTokenSupplier({
  appId, keyVersion, env = process.env, fetchImpl = fetch,
  createJwt = createKmsGitHubAppJwtSigner({ keyVersion, env, fetchImpl }),
  fetchJsonImpl = (url, init, label) => credentialJson(url, init, label, fetchImpl),
  now = Date.now, repository, repositories, permissions,
}) {
  assertAppId(appId);
  if (typeof repository !== "string" || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(repository)) {
    throw new Error("GitHub repository is invalid.");
  }
  const [owner, name] = repository.split("/");
  if (!Array.isArray(repositories) || !repositories.length || !repositories.includes(name)
    || repositories.some((repo) => typeof repo !== "string" || !/^[A-Za-z0-9_.-]+$/u.test(repo))
    || new Set(repositories).size !== repositories.length) {
    throw new Error("Explicit GitHub App repositories are required.");
  }
  if (!permissions || typeof permissions !== "object" || Array.isArray(permissions)
    || !Object.keys(permissions).length
    || Object.entries(permissions).some(([key, value]) => !/^[a-z_]+$/u.test(key) || !["read", "write"].includes(value))) {
    throw new Error("Explicit GitHub App permissions are required.");
  }
  const scope = JSON.stringify({ permissions, repositories });
  let installationId = null;
  let token = null;
  let expiresAtMs = 0;
  let pending = null;
  const mint = async () => {
    const jwt = await createJwt({ appId, now });
    if (installationId === null) {
      const installation = await fetchJsonImpl(
        `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}/installation`,
        { headers: githubAppHeaders(jwt), redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
        "GitHub App installation lookup",
      );
      if (!Number.isSafeInteger(installation.id) || installation.id <= 0) {
        throw new Error("GitHub App installation id is invalid.");
      }
      installationId = installation.id;
    }
    const result = await fetchJsonImpl(`https://api.github.com/app/installations/${installationId}/access_tokens`, {
      method: "POST", body: scope,
      redirect: "error", signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: { ...githubAppHeaders(jwt), "content-type": "application/json" },
    }, "GitHub App token mint");
    const nextToken = credential(result.token);
    const nextExpiry = Date.parse(result.expires_at);
    if (!Number.isFinite(nextExpiry) || nextExpiry - now() <= REFRESH_SKEW_MS) {
      await revokeGitHubAppToken(nextToken, { fetchImpl });
      throw new Error("GitHub App token expiry is invalid.");
    }
    token = nextToken;
    expiresAtMs = nextExpiry;
    return token;
  };
  return async () => {
    if (token && expiresAtMs - now() > REFRESH_SKEW_MS) return token;
    pending ??= mint().finally(() => { pending = null; });
    return pending;
  };
}
