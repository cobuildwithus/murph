import { createSign } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { BLOG_ARTICLES, tokenizeSearchText } from "../src/lib/blog";

const DEFAULT_SITE_URL = "sc-domain:withmurph.ai";
const GOOGLE_SEARCH_CONSOLE_SCOPE =
  "https://www.googleapis.com/auth/webmasters.readonly";
const SEARCH_ANALYTICS_ROW_LIMIT = 25_000;
const MAX_SEARCH_ANALYTICS_ROWS = 100_000;
const MAX_GOOGLE_RESPONSE_BYTES = 32 * 1024 * 1024;
const MAX_TOKEN_RESPONSE_BYTES = 64 * 1024;
const REPO_ROOT = fileURLToPath(new URL("../../../", import.meta.url));

type EnvSource = Readonly<Record<string, string | undefined>>;

export type SearchConsoleRow = {
  clicks: number;
  ctr: number;
  impressions: number;
  page: string;
  position: number;
  query: string;
};

export type SearchConsoleOpportunity = SearchConsoleRow & {
  priorityScore: number;
  reason: "ranking-without-dedicated-article" | "query-article-mismatch";
  suggestedFormat: "guide" | "case-study-candidate";
};

type ServiceAccountCredentials = {
  clientEmail: string;
  privateKey: string;
  tokenUri: string;
};

type SearchConsoleDependencies = {
  fetch?: typeof fetch;
  now?: Date;
};

export function resolveSearchConsoleDateRange(now = new Date()) {
  const end = new Date(Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate() - 3,
  ));
  const start = new Date(end);
  start.setUTCFullYear(start.getUTCFullYear() - 1);

  return {
    endDate: formatIsoDate(end),
    startDate: formatIsoDate(start),
  };
}

export function rankSearchConsoleOpportunities(
  rows: readonly SearchConsoleRow[],
  options: {
    limit?: number;
    minimumImpressions?: number;
  } = {},
): SearchConsoleOpportunity[] {
  const limit = options.limit ?? 50;
  const minimumImpressions = options.minimumImpressions ?? 25;
  const bestRowByQuery = new Map<string, SearchConsoleRow>();

  for (const row of rows) {
    const query = row.query.trim().toLowerCase();
    if (
      query.length < 3
      || isBrandedQuery(query)
      || row.impressions < minimumImpressions
      || row.position < 4
      || row.position > 40
    ) {
      continue;
    }

    const existing = bestRowByQuery.get(query);
    if (
      !existing
      || row.impressions > existing.impressions
      || (row.impressions === existing.impressions && row.position < existing.position)
    ) {
      bestRowByQuery.set(query, { ...row, query });
    }
  }

  return [...bestRowByQuery.values()]
    .map(toOpportunity)
    .filter((opportunity): opportunity is SearchConsoleOpportunity =>
      opportunity !== null,
    )
    .sort((left, right) =>
      right.priorityScore - left.priorityScore
      || right.impressions - left.impressions
      || left.position - right.position,
    )
    .slice(0, limit);
}

export function buildSearchConsoleOpportunitiesCsv(
  opportunities: readonly SearchConsoleOpportunity[],
): string {
  const header = [
    "priority_score",
    "query",
    "landing_page",
    "impressions",
    "clicks",
    "ctr_percent",
    "average_position",
    "reason",
    "suggested_format",
  ];
  const rows = opportunities.map((opportunity) => [
    String(opportunity.priorityScore),
    opportunity.query,
    opportunity.page,
    String(opportunity.impressions),
    String(opportunity.clicks),
    (opportunity.ctr * 100).toFixed(2),
    opportunity.position.toFixed(2),
    opportunity.reason,
    opportunity.suggestedFormat,
  ]);

  return `${[header, ...rows]
    .map((row) => row.map(escapeCsvCell).join(","))
    .join("\n")}\n`;
}

export async function runSearchConsoleOpportunityIntake(
  source: EnvSource = process.env,
  dependencies: SearchConsoleDependencies = {},
): Promise<{ opportunityCount: number; outputPath: string; rowCount: number }> {
  const credentialsPath = normalizeOptionalString(
    source.MURPH_GSC_CREDENTIALS_FILE,
  );
  if (!credentialsPath) {
    throw new TypeError(
      "MURPH_GSC_CREDENTIALS_FILE is required and must point to a service-account JSON file outside the repository.",
    );
  }
  const resolvedCredentialsPath = path.resolve(credentialsPath);
  if (isPathInside(REPO_ROOT, resolvedCredentialsPath)) {
    throw new TypeError(
      "The Search Console credentials file must stay outside the repository.",
    );
  }

  const credentials = await readServiceAccountCredentials(resolvedCredentialsPath);
  const request = dependencies.fetch ?? fetch;
  const accessToken = await createGoogleAccessToken(credentials, request);
  const dateRange = resolveSearchConsoleDateRange(dependencies.now);
  const siteUrl = normalizeOptionalString(source.MURPH_GSC_SITE_URL)
    ?? DEFAULT_SITE_URL;
  const rows = await fetchSearchConsoleRows({
    accessToken,
    dateRange,
    fetch: request,
    siteUrl,
  });
  const opportunities = rankSearchConsoleOpportunities(rows);
  const outputPath = path.join(
    REPO_ROOT,
    ".artifacts",
    "seo",
    `search-console-opportunities-${dateRange.endDate}.csv`,
  );

  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(
    outputPath,
    buildSearchConsoleOpportunitiesCsv(opportunities),
    "utf8",
  );

  return {
    opportunityCount: opportunities.length,
    outputPath,
    rowCount: rows.length,
  };
}

function toOpportunity(row: SearchConsoleRow): SearchConsoleOpportunity | null {
  const landingPath = resolveLandingPath(row.page);
  const matchingArticle = landingPath?.startsWith("/blog/")
    ? BLOG_ARTICLES.find((article) =>
      landingPath === `/blog/${article.slug}`,
    )
    : undefined;
  let reason: SearchConsoleOpportunity["reason"];

  if (!matchingArticle) {
    reason = "ranking-without-dedicated-article";
  } else {
    const queryTokens = new Set(tokenizeSearchText(row.query));
    const articleTokens = new Set([
      ...tokenizeSearchText(matchingArticle.title),
      ...matchingArticle.keywords.flatMap(tokenizeSearchText),
    ]);
    const hasMeaningfulOverlap = [...queryTokens].some((token) =>
      articleTokens.has(token),
    );
    if (hasMeaningfulOverlap) {
      return null;
    }
    reason = "query-article-mismatch";
  }

  const positionWeight = Math.max(0.2, (45 - row.position) / 45);
  const priorityScore = Math.round(
    row.impressions * Math.max(0.05, 1 - row.ctr) * positionWeight,
  );

  return {
    ...row,
    priorityScore,
    reason,
    suggestedFormat: suggestsCaseStudy(row.query)
      ? "case-study-candidate"
      : "guide",
  };
}

function suggestsCaseStudy(query: string): boolean {
  return /\b(case study|case studies|results|worked|success story)\b/iu.test(query);
}

function isBrandedQuery(query: string): boolean {
  return /\b(withmurph|withmurphai|murph ai|murph health)\b/iu.test(query)
    || query === "murph";
}

function resolveLandingPath(value: string): string | null {
  try {
    return new URL(value).pathname.replace(/\/$/u, "") || "/";
  } catch {
    return null;
  }
}

async function readServiceAccountCredentials(
  credentialsPath: string,
): Promise<ServiceAccountCredentials> {
  let contents: string;
  try {
    contents = await readFile(credentialsPath, "utf8");
  } catch {
    throw new TypeError("Could not read the Search Console credentials file.");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new TypeError("The Search Console credentials file is not valid JSON.");
  }
  if (!isRecord(parsed)) {
    throw new TypeError("The Search Console credentials file has an invalid shape.");
  }

  const clientEmail = normalizeOptionalString(readString(parsed.client_email));
  const privateKey = normalizeOptionalString(readString(parsed.private_key));
  const tokenUri = normalizeOptionalString(readString(parsed.token_uri))
    ?? "https://oauth2.googleapis.com/token";
  if (!clientEmail || !privateKey || !privateKey.includes("BEGIN PRIVATE KEY")) {
    throw new TypeError(
      "The Search Console credentials file must contain a service-account client email and private key.",
    );
  }
  if (tokenUri !== "https://oauth2.googleapis.com/token") {
    throw new TypeError("The Search Console credentials file has an unsupported token endpoint.");
  }

  return { clientEmail, privateKey, tokenUri };
}

async function createGoogleAccessToken(
  credentials: ServiceAccountCredentials,
  request: typeof fetch,
): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1_000);
  const encodedHeader = encodeBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const encodedClaims = encodeBase64Url(JSON.stringify({
    aud: credentials.tokenUri,
    exp: issuedAt + 3_600,
    iat: issuedAt,
    iss: credentials.clientEmail,
    scope: GOOGLE_SEARCH_CONSOLE_SCOPE,
  }));
  const unsignedJwt = `${encodedHeader}.${encodedClaims}`;
  const signature = createSign("RSA-SHA256")
    .update(unsignedJwt)
    .end()
    .sign(credentials.privateKey)
    .toString("base64url");
  const response = await request(credentials.tokenUri, {
    body: new URLSearchParams({
      assertion: `${unsignedJwt}.${signature}`,
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
    }),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await readBoundedJson(response, MAX_TOKEN_RESPONSE_BYTES);
  if (!response.ok) {
    throw new TypeError(`Google token exchange failed with status ${response.status}.`);
  }
  if (!isRecord(payload)) {
    throw new TypeError("Google returned an invalid token response.");
  }
  const accessToken = normalizeOptionalString(readString(payload.access_token));
  if (!accessToken) {
    throw new TypeError("Google returned a token response without an access token.");
  }
  return accessToken;
}

async function fetchSearchConsoleRows(input: {
  accessToken: string;
  dateRange: { endDate: string; startDate: string };
  fetch: typeof fetch;
  siteUrl: string;
}): Promise<SearchConsoleRow[]> {
  const endpoint =
    `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(input.siteUrl)}/searchAnalytics/query`;
  const rows: SearchConsoleRow[] = [];

  for (
    let startRow = 0;
    startRow < MAX_SEARCH_ANALYTICS_ROWS;
    startRow += SEARCH_ANALYTICS_ROW_LIMIT
  ) {
    const response = await input.fetch(endpoint, {
      body: JSON.stringify({
        ...input.dateRange,
        dataState: "final",
        dimensions: ["query", "page"],
        rowLimit: SEARCH_ANALYTICS_ROW_LIMIT,
        searchType: "web",
        startRow,
      }),
      headers: {
        Authorization: `Bearer ${input.accessToken}`,
        "Content-Type": "application/json",
      },
      method: "POST",
      signal: AbortSignal.timeout(20_000),
    });
    const payload = await readBoundedJson(response, MAX_GOOGLE_RESPONSE_BYTES);
    if (!response.ok) {
      throw new TypeError(
        `Search Console query failed with status ${response.status}.`,
      );
    }
    const pageRows = parseSearchConsoleRows(payload);
    rows.push(...pageRows);
    if (pageRows.length < SEARCH_ANALYTICS_ROW_LIMIT) {
      break;
    }
  }

  return rows;
}

function parseSearchConsoleRows(payload: unknown): SearchConsoleRow[] {
  if (!isRecord(payload) || payload.rows === undefined) {
    return [];
  }
  if (!Array.isArray(payload.rows)) {
    throw new TypeError("Search Console returned an invalid rows collection.");
  }

  return payload.rows.map((row, index) => {
    if (!isRecord(row) || !Array.isArray(row.keys) || row.keys.length !== 2) {
      throw new TypeError(`Search Console returned an invalid row at index ${index}.`);
    }
    const [query, page] = row.keys;
    if (
      typeof query !== "string"
      || typeof page !== "string"
      || !isFiniteNumber(row.clicks)
      || !isFiniteNumber(row.impressions)
      || !isFiniteNumber(row.ctr)
      || !isFiniteNumber(row.position)
    ) {
      throw new TypeError(`Search Console returned an invalid row at index ${index}.`);
    }

    return {
      clicks: row.clicks,
      ctr: row.ctr,
      impressions: row.impressions,
      page,
      position: row.position,
      query,
    };
  });
}

async function readBoundedJson(response: Response, maxBytes: number): Promise<unknown> {
  const text = await response.text();
  if (Buffer.byteLength(text, "utf8") > maxBytes) {
    throw new TypeError("Google returned a response larger than the allowed limit.");
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new TypeError("Google returned an invalid JSON response.");
  }
}

function encodeBase64Url(value: string): string {
  return Buffer.from(value, "utf8").toString("base64url");
}

function escapeCsvCell(value: string): string {
  const spreadsheetSafe = /^[=+\-@]/u.test(value) ? `'${value}` : value;
  return `"${spreadsheetSafe.replaceAll('"', '""')}"`;
}

function normalizeOptionalString(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function formatIsoDate(value: Date): string {
  return value.toISOString().slice(0, 10);
}

function isPathInside(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void runSearchConsoleOpportunityIntake().then((result) => {
    const relativeOutputPath = path.relative(REPO_ROOT, result.outputPath);
    console.info(
      `Search Console intake complete: ${result.rowCount} rows checked, ${result.opportunityCount} opportunities saved to ${relativeOutputPath}.`,
    );
  }).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "Search Console intake failed.";
    console.error(message);
    process.exitCode = 1;
  });
}
