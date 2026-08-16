import { createHmac } from "node:crypto";

import {
  HTTP_TIMEOUT_MS,
  assertRecord,
  fetchJson,
  isRecord,
  requiredEnv,
  requiredString,
  runBoundedCommand,
} from "./native-ios-hosted-e2e-support.mjs";

const APPLE_HEALTH_PROVIDER = "apple_health_kit";
const CLOCK_SKEW_MS = 2 * 60_000;
const DB_CONNECTION_TIMEOUT_MS = 5_000;
const DB_QUERY_TIMEOUT_MS = 10_000;
const DB_STATEMENT_TIMEOUT_MS = 10_000;
const PRISMA_RESET_TIMEOUT_MS = 5 * 60_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function inspectE2eDatabaseUrls({ databaseUrl, directDatabaseUrl }) {
  const names = [];
  for (const [label, value] of [
    ["pooled E2E database", databaseUrl],
    ["direct E2E database", directDatabaseUrl],
  ]) {
    let parsed;
    try {
      parsed = new URL(value);
    } catch {
      throw new Error(`${label} URL is invalid.`);
    }
    if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
      throw new Error(`${label} must be PostgreSQL.`);
    }
    const name = decodeURIComponent(parsed.pathname.replace(/^\//u, ""));
    if (!name) throw new Error(`${label} must name a database.`);
    names.push(name);
  }
  if (names[0] !== names[1]) throw new Error("Pooled and direct E2E URLs must target the same database.");
  if (!/(?:^|[_-])(?:e2e|test)(?:[_-]|$)/iu.test(names[0])) {
    throw new Error("E2E database URLs must name an explicitly E2E/test database.");
  }
  return names[0];
}

export function buildDedicatedDatabasePoolOptions(connectionString) {
  if (typeof connectionString !== "string" || connectionString.length === 0) {
    throw new Error("Dedicated E2E database connection string is invalid.");
  }
  return {
    connectionString,
    connectionTimeoutMillis: DB_CONNECTION_TIMEOUT_MS,
    max: 1,
    query_timeout: DB_QUERY_TIMEOUT_MS,
    statement_timeout: DB_STATEMENT_TIMEOUT_MS,
  };
}

export function buildJunctionClientUserId(secret, memberId) {
  if (secret.trim().length < 16 || memberId.trim().length === 0) {
    throw new Error("Junction E2E identity configuration is invalid.");
  }
  const digest = createHmac("sha256", secret.trim()).update(memberId).digest();
  return `murph_${base32(digest)}`.slice(0, 32);
}

export function inspectLaneExclusiveJunctionUser(raw, { expectedTeamId }) {
  assertUuid(expectedTeamId, "dedicated Junction team id");
  assertRecord(raw, "dedicated Junction team user list");
  if (!Array.isArray(raw.users)
      || !Number.isSafeInteger(raw.total)
      || raw.total < 0
      || raw.offset !== 0
      || !Number.isSafeInteger(raw.limit)
      || raw.limit < 2) {
    throw new Error("Dedicated Junction team user list was invalid.");
  }
  if (raw.total > 1 || raw.users.length > 1) {
    throw new Error("Dedicated Junction E2E team contains more than one user; refusing destructive cleanup.");
  }
  if (raw.total !== raw.users.length) {
    throw new Error("Dedicated Junction E2E team user enumeration was incomplete.");
  }
  const user = raw.users[0];
  if (!user) return null;
  assertRecord(user, "dedicated Junction team user");
  const userTeamId = requiredString(user.team_id, "Junction E2E user team id");
  assertUuid(userTeamId, "Junction E2E user team id");
  if (userTeamId.toLowerCase() !== expectedTeamId.toLowerCase()) {
    throw new Error("Junction E2E API key returned a user from an unexpected team.");
  }
  return { userId: requiredString(user.user_id, "Junction E2E user id") };
}

export function inspectDedicatedJunctionUsers(raw, { expectedClientUserId = null, expectedTeamId }) {
  const owned = inspectLaneExclusiveJunctionUser(raw, { expectedTeamId });
  if (!owned) return null;
  const clientUserId = requiredString(
    raw.users[0].client_user_id,
    "Junction E2E client user id",
  );
  if (expectedClientUserId !== null && clientUserId !== expectedClientUserId) {
    throw new Error("Dedicated Junction E2E team contains an unexpected client user.");
  }
  return { clientUserId, userId: owned.userId };
}

export function inspectDedicatedMemberIdentity(raw, { testPhone }) {
  assertRecord(raw, "dedicated E2E member identity");
  const memberId = requiredString(raw.memberId, "dedicated E2E member id");
  const phone = requireE164(testPhone);
  const maskedPhoneNumberHint = requiredString(
    raw.maskedPhoneNumberHint,
    "dedicated E2E member phone hint",
  );
  const digits = phone.replace(/\D/gu, "");
  if (maskedPhoneNumberHint !== `*** ${digits.slice(-4)}`) {
    throw new Error("Dedicated E2E database member does not match the fixed test phone hint.");
  }
  return { memberId };
}

export function inspectResolvedJunctionUser(raw, { expectedClientUserId, expectedTeamId }) {
  assertUuid(expectedTeamId, "dedicated Junction team id");
  assertRecord(raw, "Junction E2E user lookup");
  const teamId = requiredString(raw.team_id, "Junction E2E user team id");
  assertUuid(teamId, "Junction E2E user team id");
  if (teamId.toLowerCase() !== expectedTeamId.toLowerCase()
      || requiredString(raw.client_user_id, "Junction E2E client user id") !== expectedClientUserId) {
    throw new Error("Resolved Junction E2E user does not match the dedicated team identity.");
  }
  return { userId: requiredString(raw.user_id, "Junction E2E user id") };
}

export function inspectFreshPrivyPrincipal(raw, { observedAtMs, startedAtMs }) {
  assertRecord(raw, "Privy E2E user");
  const id = requiredString(raw.id, "Privy E2E user id");
  const created = raw.created_at;
  if (typeof created !== "number" || !Number.isFinite(created) || created <= 0) {
    throw new Error("Privy E2E user did not include a valid creation time.");
  }
  const createdAtMs = created < 100_000_000_000 ? created * 1000 : created;
  if (createdAtMs < startedAtMs - CLOCK_SKEW_MS || createdAtMs > observedAtMs + CLOCK_SKEW_MS) {
    throw new Error("Privy E2E principal was not freshly created during this run.");
  }
  return { createdAtMs, id };
}

export function inspectJunctionAppleHealthConnection(raw) {
  assertRecord(raw, "Junction provider connections");
  if (!Array.isArray(raw.providers)) throw new Error("Junction provider connections response was invalid.");
  const connected = raw.providers.some((provider) => isRecord(provider)
    && provider.slug === APPLE_HEALTH_PROVIDER
    && String(provider.status ?? "").toLowerCase() === "connected");
  if (!connected) throw new Error("Junction Apple Health connection was not established.");
  return true;
}

export async function proveRunPostconditions(startedAtMs) {
  const privy = await findPrivyTestUser();
  if (!privy) throw new Error("Privy E2E principal was not created by the native journey.");
  inspectFreshPrivyPrincipal(privy, { observedAtMs: Date.now(), startedAtMs });
  console.log("::notice::native-ios-e2e stage=privy_postcondition result=success");

  const config = e2eIdentityConfig();
  const rawMember = await readDedicatedMemberRecord(config);
  if (!rawMember) throw new Error("Native E2E journey did not create the dedicated hosted member.");
  const member = inspectDedicatedMemberIdentity(rawMember, { testPhone: config.testPhone });
  const junction = await resolveJunctionUser(member.memberId, config);
  if (!junction) throw new Error("Native E2E journey did not create the dedicated Junction user.");
  inspectJunctionAppleHealthConnection(await readJunctionProviders(junction.userId, config.junctionApiKey));
  console.log("::notice::native-ios-e2e stage=junction_apple_health_postcondition result=success");
}

export async function cleanupE2e() {
  const config = e2eCleanupConfig();
  const junction = await listLaneExclusiveJunctionUser(config);
  if (junction) await deleteJunctionUser(junction.userId, config.junctionApiKey);
  if (await listLaneExclusiveJunctionUser(config)) {
    throw new Error("Dedicated Junction E2E team is not empty after cleanup.");
  }
  console.log(`::notice::native-ios-e2e stage=junction_cleanup result=${junction ? "success" : "absent"}`);

  await resetDedicatedDatabase(config.directDatabaseUrl);
  if (await readDedicatedMemberRecord(config)) {
    throw new Error("Dedicated E2E database still contains a member after reset.");
  }
  console.log("::notice::native-ios-e2e stage=database_cleanup result=success");

  const privy = await findPrivyTestUser();
  if (privy) await deletePrivyTestUser(requiredString(privy.id, "Privy E2E user id"));
  if (await findPrivyTestUser()) throw new Error("Privy E2E user still exists after deletion.");
  console.log(`::notice::native-ios-e2e stage=privy_cleanup result=${privy ? "success" : "absent"}`);
}

function e2eCleanupConfig() {
  const directDatabaseUrl = requiredEnv("NATIVE_IOS_E2E_DIRECT_DATABASE_URL");
  const junctionTeamId = requiredEnv("NATIVE_IOS_E2E_JUNCTION_TEAM_ID").toLowerCase();
  assertUuid(junctionTeamId, "NATIVE_IOS_E2E_JUNCTION_TEAM_ID");
  return {
    databaseName: inspectE2eDatabaseUrls({
      databaseUrl: requiredEnv("NATIVE_IOS_E2E_DATABASE_URL"),
      directDatabaseUrl,
    }),
    directDatabaseUrl,
    junctionApiKey: requiredEnv("NATIVE_IOS_E2E_JUNCTION_API_KEY"),
    junctionTeamId,
  };
}

function e2eIdentityConfig() {
  return {
    ...e2eCleanupConfig(),
    junctionClientUserIdSecret: requiredEnv("NATIVE_IOS_E2E_JUNCTION_CLIENT_USER_ID_SECRET"),
    testPhone: requireE164(requiredEnv("NATIVE_IOS_E2E_PRIVY_TEST_PHONE")),
  };
}

async function readDedicatedMemberRecord({ databaseName, directDatabaseUrl }) {
  const pg = await import("pg");
  const Pool = pg.default?.Pool ?? pg.Pool;
  const pool = new Pool(buildDedicatedDatabasePoolOptions(directDatabaseUrl));
  try {
    let db;
    try {
      db = await pool.query("SELECT current_database() AS name");
    } catch {
      throw new Error("Dedicated E2E database validation failed.");
    }
    if (db.rows[0]?.name !== databaseName) throw new Error("Connected PostgreSQL database is not the protected E2E database.");
    let result;
    try {
      result = await pool.query(
        "SELECT member_id, masked_phone_number_hint FROM hosted_member_identity ORDER BY member_id LIMIT 2",
      );
    } catch (error) {
      if (isRecord(error) && error.code === "42P01") return null;
      throw new Error("Dedicated E2E identity lookup failed.");
    }
    if (result.rows.length > 1) throw new Error("Dedicated E2E database contains more than one member identity.");
    const row = result.rows[0];
    if (!row) return null;
    return {
      maskedPhoneNumberHint: row.masked_phone_number_hint,
      memberId: String(row.member_id ?? ""),
    };
  } finally {
    await pool.end().catch(() => undefined);
  }
}

async function listLaneExclusiveJunctionUser(config) {
  const url = new URL(`${junctionBaseUrl(config.junctionApiKey)}/v2/user/`);
  url.searchParams.set("offset", "0");
  url.searchParams.set("limit", "2");
  return inspectLaneExclusiveJunctionUser(await fetchJson(
    url,
    { headers: junctionHeaders(config.junctionApiKey) },
    "dedicated Junction E2E team user enumeration",
  ), { expectedTeamId: config.junctionTeamId });
}

async function resolveJunctionUser(memberId, config) {
  const clientUserId = buildJunctionClientUserId(config.junctionClientUserIdSecret, memberId);
  const response = await fetch(`${junctionBaseUrl(config.junctionApiKey)}/v2/user/resolve/${encodeURIComponent(clientUserId)}`, {
    headers: junctionHeaders(config.junctionApiKey),
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Junction E2E user lookup failed with HTTP ${response.status}.`);
  }
  let body;
  try {
    body = await response.json();
  } catch {
    throw new Error("Junction E2E user lookup returned invalid JSON.");
  }
  return inspectResolvedJunctionUser(body, {
    expectedClientUserId: clientUserId,
    expectedTeamId: config.junctionTeamId,
  });
}

async function readJunctionProviders(userId, apiKey) {
  return fetchJson(
    `${junctionBaseUrl(apiKey)}/v2/user/providers/${encodeURIComponent(userId)}`,
    { headers: junctionHeaders(apiKey) },
    "Junction E2E provider connection lookup",
  );
}

async function deleteJunctionUser(userId, apiKey) {
  const response = await fetch(`${junctionBaseUrl(apiKey)}/v2/user/${encodeURIComponent(userId)}`, {
    headers: junctionHeaders(apiKey),
    method: "DELETE",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!response.ok && response.status !== 404) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Junction E2E user deletion failed with HTTP ${response.status}.`);
  }
  await response.body?.cancel().catch(() => undefined);
}

async function resetDedicatedDatabase(directDatabaseUrl) {
  const childEnv = { ...process.env };
  for (const name of Object.keys(childEnv)) {
    if (name.startsWith("NATIVE_IOS_E2E_")) delete childEnv[name];
  }
  childEnv.DATABASE_URL = directDatabaseUrl;
  childEnv.DIRECT_DATABASE_URL = directDatabaseUrl;
  await runBoundedCommand({
    argv: ["--dir", "apps/web", "exec", "prisma", "migrate", "reset", "--force"],
    command: "pnpm",
    env: childEnv,
    label: "E2E database reset",
    timeoutMs: PRISMA_RESET_TIMEOUT_MS,
  });
}

async function findPrivyTestUser() {
  const response = await fetch("https://api.privy.io/v1/users/phone/number", {
    body: JSON.stringify({ number: requireE164(requiredEnv("NATIVE_IOS_E2E_PRIVY_TEST_PHONE")) }),
    headers: { ...privyHeaders(), "content-type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (response.status === 404) {
    await response.body?.cancel().catch(() => undefined);
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Privy E2E user lookup failed with HTTP ${response.status}.`);
  }
  try {
    const user = await response.json();
    assertRecord(user, "Privy E2E user lookup");
    requiredString(user.id, "Privy E2E user id");
    return user;
  } catch (error) {
    if (error instanceof Error && /Privy E2E user/u.test(error.message)) throw error;
    throw new Error("Privy E2E user lookup returned invalid JSON.");
  }
}

async function deletePrivyTestUser(id) {
  const response = await fetch(`https://api.privy.io/v1/users/${encodeURIComponent(id)}`, {
    headers: privyHeaders(),
    method: "DELETE",
    signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
  });
  if (!response.ok && response.status !== 404) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Privy E2E user deletion failed with HTTP ${response.status}.`);
  }
  await response.body?.cancel().catch(() => undefined);
}

function junctionBaseUrl(apiKey) {
  const match = /^sk_(us|eu)_/u.exec(apiKey);
  if (!match) throw new Error("Junction E2E API key must identify a US or EU sandbox region.");
  return `https://api.sandbox.${match[1]}.junction.com`;
}

function junctionHeaders(apiKey) {
  return { Accept: "application/json", "x-vital-api-key": apiKey };
}

function privyHeaders() {
  const appId = requiredEnv("NATIVE_IOS_E2E_PRIVY_APP_ID");
  const appSecret = requiredEnv("NATIVE_IOS_E2E_PRIVY_APP_SECRET");
  return {
    Accept: "application/json",
    Authorization: `Basic ${Buffer.from(`${appId}:${appSecret}`).toString("base64")}`,
    "privy-app-id": appId,
  };
}

function requireE164(value) {
  if (!/^\+[1-9][0-9]{7,14}$/u.test(value)) throw new Error("NATIVE_IOS_E2E_PRIVY_TEST_PHONE must be an E.164 phone number.");
  return value;
}

function assertUuid(value, label) {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} must be a UUID.`);
}

function base32(input) {
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of input) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += alphabet[(value << (5 - bits)) & 31];
  return output;
}
