import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const tarListMaxBufferBytes = 64 * 1024 * 1024;
const maxScannableFileBytes = 128 * 1024 * 1024;
const scanConcurrency = 8;
const allowedPublicDataStorePaths = new Set([
  'package/node_modules/@murphai/health-commons/generated/knowledge.sqlite',
]);

const providerPatterns = [
  {
    ruleId: 'provider-token:anthropic',
    pattern: /\bsk-ant-[A-Za-z0-9_-]{20,}\b/u,
  },
  {
    ruleId: 'provider-token:aws-access-key',
    pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u,
  },
  {
    ruleId: 'provider-token:github',
    pattern: /\b(?:gh[pousr]_[A-Za-z0-9_]{20,}|github_pat_[A-Za-z0-9_]{20,})\b/u,
  },
  {
    ruleId: 'provider-token:google',
    pattern: /\bAIza[0-9A-Za-z_-]{30,}\b/u,
  },
  {
    ruleId: 'provider-token:npm',
    pattern: /\bnpm_[A-Za-z0-9]{20,}\b/u,
  },
  {
    ruleId: 'provider-token:openai',
    pattern: /\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{20,}\b/u,
  },
  {
    ruleId: 'provider-token:sendgrid',
    pattern: /\bSG\.[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]{16,}\b/u,
  },
  {
    ruleId: 'provider-token:slack',
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/u,
  },
  {
    ruleId: 'provider-token:stripe',
    pattern: /\b(?:sk_live_|rk_live_|whsec_)[A-Za-z0-9]{16,}\b/u,
  },
];

const privateKeyBlockPattern =
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]{32,16384}?-----END [A-Z0-9 ]*PRIVATE KEY-----/u;
const authorizationCredentialPattern =
  /\b(Bearer|Basic)[ \t]+([A-Za-z0-9._~+/$={}-]{1,4096})/gu;
const scopedAuthorizationCredentialPattern =
  /\b(?:authorization(?:Header)?|authHeader)\b["'`\]\s,:=()]{1,32}\b(Bearer|Basic)[ \t]+([A-Za-z0-9._~+/$={}-]{1,4096})/giu;
const serializedHeaderCredentialPattern =
  /(["'`])([A-Za-z][A-Za-z0-9_-]{0,127})[ \t]*:[ \t]*([^"'`\r\n]{1,4096})\1/gu;
const privateJwkPatterns = [
  /\bkty\s*["']?\s*:\s*["'](?:EC|OKP|RSA)["'][\s\S]{0,2000}?\bd\s*["']?\s*:\s*["']([A-Za-z0-9_-]{32,})["']/iu,
  /\bd\s*["']?\s*:\s*["']([A-Za-z0-9_-]{32,})["'][\s\S]{0,2000}?\bkty\s*["']?\s*:\s*["'](?:EC|OKP|RSA)["']/iu,
  /\bkty\s*["']?\s*:\s*["']oct["'][\s\S]{0,1000}?\bk\s*["']?\s*:\s*["']([A-Za-z0-9_-]{32,})["']/iu,
];
const credentialUrlPattern =
  /\b(?:amqps?|https?|mongodb(?:\+srv)?|mysql|nats|postgres(?:ql)?|redis|sftp):\/\/[^:\s/@]+:[^@\s/]+@[^\s"'`,;]+/giu;
const credentialParameterPattern =
  /(?:^|[?&])([A-Za-z_$][A-Za-z0-9_$-]{0,127})=([^&#\s"'`]{1,4096})/gimu;
const quotedCredentialParameterPattern =
  /(?:\.\s*(?:set|append)\s*\(\s*|\[\s*)(["'`])([A-Za-z_$][A-Za-z0-9_$-]*)\1\s*,\s*(["'`])([^"'`\r\n]{1,4096})\3\s*(?:\)|\])/gimu;
const quotedColonAssignmentPattern =
  /(?:^|[,{][ \t\r\n]*|\n[ \t]*)["'`]?\b([A-Za-z_$][A-Za-z0-9_$-]*)\b["'`]?\s*:\s*(["'`])([^"'`\r\n]{1,4096})\2/gimu;
const unquotedColonAssignmentPattern =
  /^[ \t]*["'`]?\b([A-Za-z_$][A-Za-z0-9_$-]*)\b["'`]?[ \t]*:[ \t]*([^"'`\s,;#]{1,4096})[ \t]*(?:;[ \t]*)?(?:#[^\r\n]*)?$/gimu;
const equalsAssignmentPattern =
  /(?:^|[^A-Za-z0-9_$-])["'`]?\b([A-Za-z_$][A-Za-z0-9_$-]*)\b["'`]?[ \t]*=(?!=|>)[ \t]*(?:(["'`])([^"'`\r\n]{1,4096})\2|([^"'`\s,;#&|]{1,4096}))/gimu;
const bracketEqualsAssignmentPattern =
  /\[[ \t]*(["'`])([A-Za-z_$][A-Za-z0-9_$-]*)\1[ \t]*\][ \t]*=(?!=|>)[ \t]*(?:(["'`])([^"'`\r\n]{1,4096})\3|([^"'`\s,;#&|]{1,4096}))/gimu;
const walletPrivateKeyPattern =
  /["'`]?\b(?:eth(?:ereum)?[_-]?)?(?:wallet[_-]?)?private[_-]?key\b["'`]?\s*[:=]\s*["'`]?(0x[0-9a-f]{64})["'`]?/iu;
const mnemonicPattern =
  /["'`]?\b(?:mnemonic|seed[_-]?phrase)\b["'`]?\s*[:=]\s*["'`]([a-z]+(?:\s+[a-z]+){11,23})["'`]/iu;

const exactPlaceholderValues = new Set([
  '...',
  '<token>',
  'api-key',
  'changeme',
  'placeholder',
  'redacted',
  'replace-me',
  'test-only',
]);
// These exact normalized names are credential holders even when they do not
// end in a separator- or camel-case token such as `secret` or `token`.
const exactCredentialKeys = new Set([
  'accesskey',
  'accesstoken',
  'apikey',
  'apitoken',
  'auth',
  'authheader',
  'authorization',
  'authorizationheader',
  'authtoken',
  'bearertoken',
  'clientsecret',
  'cookie',
  'csrftoken',
  'idtoken',
  'oauthtoken',
  'passwd',
  'password',
  'privatekey',
  'providersecretvalue',
  'refreshtoken',
  'secret',
  'sessiontoken',
  'setcookie',
  'token',
]);
const credentialTerminalParts = new Set([
  'credential',
  'credentials',
  'mnemonic',
  'password',
  'secret',
  'token',
]);
const credentialKeyAuthorityParts = new Set([
  'access',
  'api',
  'auth',
  'client',
  'encryption',
  'fingerprint',
  'hmac',
  'private',
  'privacy',
  'root',
  'secret',
  'signing',
]);
// These are reviewed public literals from the real release inventory. Do not
// replace them with key-suffix or value-shape exemptions.
const allowedPublicCredentialAssignments = new Set(
  [
    ['DEVICE_SYNC_CONTROL_TOKEN_ENV', 'DEVICE_SYNC_CONTROL_TOKEN'],
    ['DEVICE_SYNC_SECRET_ENV', 'DEVICE_SYNC_SECRET'],
    ['ENCRYPTED_SECRET_PREFIX', 'mdss'],
    ['ENCRYPTED_SECRET_VERSION', 'v1'],
    ['EXA_API_KEY_ENV', 'EXA_API_KEY'],
    ['GATEWAY_ROUTE_TOKEN_PREFIX', 'gwrt1_'],
    ['HOSTED_AI_USAGE_REPORTING_SECRET_ENV', 'HOSTED_AI_USAGE_REPORTING_SECRET'],
    ['HOSTED_ASSISTANT_API_KEY_ENV', 'HOSTED_ASSISTANT_API_KEY_ENV'],
    ['HOSTED_CHECKPOINT_DEBUG_LOG_HASH_SECRET_ENV', 'HOSTED_LOG_FINGERPRINT_SECRET'],
    ['HOSTED_CUSTOM_INFERENCE_API_KEY_ENV', 'MURPH_CUSTOM_INFERENCE_API_KEY'],
    ['HOSTED_PRODUCT_FEEDBACK_REDACTION_TOKEN', '[redacted]'],
    ['HOSTED_RUNTIME_ENSURE_PROCESSING_TOKEN_ACQUIRED_AT_MS_HEADER', 'x-hosted-runtime-ensure-processing-token-acquired-at-ms'],
    ['HOSTED_RUNTIME_ENSURE_PROCESSING_TOKEN_ACQUIRE_STARTED_AT_MS_HEADER', 'x-hosted-runtime-ensure-processing-token-acquire-started-at-ms'],
    ['HOSTED_OPERATOR_HOME_ROOT_KEY', 'operator-home'],
    ['MANAGED_CONTROL_TOKEN_FILE_NAME', 'control-token'],
    ['MANAGED_ENCRYPTION_SECRET_FILE_NAME', 'encryption-secret'],
    ['OURA_OAUTH_TOKEN_ENDPOINT_KIND', 'oura_oauth_token'],
    ['OURA_TOKEN_PATH', '/oauth/token'],
    ['REDACTED_SECRET', '<REDACTED_SECRET>'],
    ['REDACTED_SECRET_TEXT', '[REDACTED]'],
    ['STRAVA_OAUTH_TOKEN_ENDPOINT_KIND', 'strava_oauth_token'],
    ['STRAVA_TOKEN_PATH', '/oauth/token'],
    ['TELEGRAM_SECRET_TOKEN_HEADER', 'x-telegram-bot-api-secret-token'],
    ['WHOOP_OAUTH_TOKEN_ENDPOINT_KIND', 'whoop_oauth_token'],
    ['WHOOP_TOKEN_PATH', '/oauth/oauth2/token'],
    ['XAI_API_KEY', 'XAI_X_SEARCH_MODEL'],
    ['access_token_expires_at', 'null'],
    [
      'apiKey',
      'is a provider-owned API secret and is not supported in serialized runtime config.',
    ],
    ['claim_token', '?'],
    ['claim_token', 'null'],
    ['clientSecret', 'string'],
    [
      'clientUserIdSecret',
      'is a provider-owned HMAC secret and is not supported in serialized runtime config.',
    ],
    ['clinical-records-token', 'device'],
    ['device-sync-token', 'device'],
    ['rootKey', 'vault'],
    ['token', '-${suffix}'],
    [
      'webhookSecret',
      'is a provider-owned webhook secret and is not supported in serialized runtime config.',
    ],
    [
      'webhookSigningSecret',
      'is a provider-owned webhook signing secret and is not supported in serialized runtime config.',
    ],
    [
      'webhookVerificationToken',
      'is a provider-owned admin secret and is not supported in serialized runtime config.',
    ],
    [
      'webhookVerifyToken',
      'is a provider-owned admin secret and is not supported in serialized runtime config.',
    ],
  ].map(([key, value]) => `${key}\0${value}`),
);
function normalizedArchivePath(value) {
  return value.replaceAll('\\', '/').replace(/^\.\//u, '');
}

function validateArchiveEntryPath(entryPath) {
  const normalized = normalizedArchivePath(entryPath);
  if (
    normalized.length === 0
    || normalized.startsWith('/')
    || normalized.split('/').includes('..')
    || !normalized.startsWith('package/')
  ) {
    throw new Error('Release tarball contains an unsafe archive path.');
  }
  return normalized;
}

function sensitiveFilenameRule(relativePath) {
  const exactPath = normalizedArchivePath(relativePath);
  const normalized = exactPath.toLowerCase();
  const basename = path.posix.basename(normalized);

  if (allowedPublicDataStorePaths.has(exactPath)) {
    return null;
  }

  if (basename === '.env' || basename.startsWith('.env.')) {
    return 'sensitive-filename:dotenv';
  }

  if (
    [
      '.git-credentials',
      '.netrc',
      '.npmrc',
      '.pypirc',
      'credentials.json',
      'id_ed25519',
      'id_rsa',
      'wallet.dat',
    ].includes(basename)
  ) {
    return 'sensitive-filename:credential-store';
  }

  if (/\.(?:jks|key|keystore|p12|pem|pfx)$/u.test(basename)) {
    return 'sensitive-filename:key-container';
  }

  if (/\.(?:bak|db|dump|sqlite|sqlite3)$/u.test(basename)) {
    return 'sensitive-filename:data-store';
  }

  if (/\.(?:gz|tar|tgz|zip)$/u.test(basename)) {
    return 'sensitive-filename:nested-archive';
  }

  return null;
}

function isExactPlaceholder(value) {
  return exactPlaceholderValues.has(value.trim().toLowerCase());
}

function isCredentialReference(value) {
  const trimmed = value.trim();
  const withoutTemplateReferences = trimmed.replace(
    /\$\{(?:[A-Za-z_$][A-Za-z0-9_$]*\.)*[A-Za-z_$][A-Za-z0-9_$]*\}/gu,
    '',
  );
  return (
    /^\$\{?[A-Z][A-Z0-9_]*\}?$/u.test(trimmed)
    || /^(?:process\.)?env\.[A-Z][A-Z0-9_]*$/u.test(trimmed)
    || (
      withoutTemplateReferences !== trimmed
      && /^[A-Za-z0-9._/-]*$/u.test(withoutTemplateReferences)
    )
  );
}

function isCredentialLiteral(key, value) {
  const authorizationValueMatch = /^(?:Bearer|Basic)[ \t]+(.+)$/iu.exec(
    value.trim(),
  );
  const referenceValue = authorizationValueMatch?.[1] ?? value;
  return (
    !isExactPlaceholder(referenceValue)
    && !isCredentialReference(referenceValue)
    && !allowedPublicCredentialAssignments.has(`${key}\0${value}`)
  );
}

function credentialKeyParts(key) {
  return key
    .replace(/([a-z0-9])([A-Z])/gu, '$1_$2')
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1_$2')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter(Boolean);
}

function isCredentialKey(key, options = {}) {
  const normalizedKey = key.toLowerCase().replace(/[^a-z0-9]/gu, '');
  if (exactCredentialKeys.has(normalizedKey)) {
    return true;
  }

  const parts = credentialKeyParts(key);
  while (['base64', 'pem'].includes(parts.at(-1))) {
    parts.pop();
  }
  const terminal = parts.at(-1);
  if (credentialTerminalParts.has(terminal)) {
    return true;
  }
  if (terminal === 'tokens' && parts.includes('control')) {
    return true;
  }
  if (terminal === 'signature') {
    return options.allowSignature === true;
  }
  if (
    terminal === 'json'
    && (
      parts.includes('auth')
      || parts.includes('keyring')
      || (parts.includes('private') && parts.includes('jwk'))
    )
  ) {
    return true;
  }
  if (terminal === 'jwk' && parts.includes('private')) {
    return true;
  }
  if (terminal === 'material' && parts.includes('key')) {
    return true;
  }
  if (!['key', 'keys'].includes(terminal)) {
    return false;
  }
  return (
    (parts.length === 1 && options.allowBareKey === true)
    || parts.slice(0, -1).some((part) => credentialKeyAuthorityParts.has(part))
    || (parts.includes('routing') && parts.includes('index'))
  );
}

function parameterHasCredential(pattern, text, keyIndex, valueIndex, options = {}) {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const key = match[keyIndex] ?? '';
    const credential = match[valueIndex] ?? '';
    if (
      isCredentialKey(key, {
        allowBareKey: options.allowBareKey === true,
        allowSignature: true,
      })
      && isCredentialLiteral(key, credential)
    ) {
      return true;
    }
  }
  return false;
}

function isAuthorizationChallenge(scheme, value) {
  return ['basic', 'bearer'].includes(scheme.toLowerCase())
    && value.toLowerCase() === 'realm=';
}

function hasValidAuthorizationCredentialSyntax(scheme, value) {
  if (scheme.toLowerCase() !== 'basic') {
    return true;
  }

  return value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/u.test(value);
}

function authorizationHasCredential(pattern, text) {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const scheme = match[1] ?? '';
    const value = match[2] ?? '';
    if (
      !isAuthorizationChallenge(scheme, value)
      && hasValidAuthorizationCredentialSyntax(scheme, value)
      && isCredentialLiteral('authorization', value)
    ) {
      return true;
    }
  }
  return false;
}

function isAllowedLocalDatabasePlaceholder(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    return (
      ['postgres:', 'postgresql:'].includes(parsed.protocol)
      && ['127.0.0.1', '[::1]', 'localhost'].includes(parsed.hostname)
      && parsed.username === 'postgres'
      && parsed.password === 'postgres'
    );
  } catch {
    return false;
  }
}

function secretAssignmentHasCredential(
  pattern,
  text,
  keyIndex,
  valueIndexes,
  options = {},
) {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const matchIndex = match.index ?? 0;
    if (
      options.skipTypeAliases === true
      && /\btype\s*$/u.test(
        text.slice(Math.max(0, matchIndex - 32), matchIndex),
      )
    ) {
      continue;
    }
    const key = match[keyIndex] ?? '';
    const matchedValue = valueIndexes
      .map((index) => ({ index, value: match[index] }))
      .find((entry) => entry.value !== undefined);
    if (
      options.includeUnquoted === false
      && matchedValue?.index === options.unquotedValueIndex
    ) {
      continue;
    }
    const value = matchedValue?.value ?? '';
    if (isCredentialKey(key) && isCredentialLiteral(key, value)) {
      return true;
    }
  }
  return false;
}

function contentRuleIds(text, options = {}) {
  const includeUnquotedColonAssignments =
    options.includeUnquotedColonAssignments ?? true;
  const includeUnquotedEqualsAssignments =
    options.includeUnquotedEqualsAssignments ?? true;
  const ruleIds = new Set();

  for (const { pattern, ruleId } of providerPatterns) {
    if (pattern.test(text)) {
      ruleIds.add(ruleId);
    }
  }

  if (privateKeyBlockPattern.test(text)) {
    ruleIds.add('private-key:block');
  }
  if (
    authorizationHasCredential(authorizationCredentialPattern, text)
    || authorizationHasCredential(scopedAuthorizationCredentialPattern, text)
  ) {
    ruleIds.add('credential:authorization-header');
  }
  if (
    parameterHasCredential(serializedHeaderCredentialPattern, text, 2, 3)
  ) {
    ruleIds.add('credential:serialized-header');
  }
  if (privateJwkPatterns.some((pattern) => pattern.test(text))) {
    ruleIds.add('private-key:jwk');
  }
  if (walletPrivateKeyPattern.test(text)) {
    ruleIds.add('private-key:wallet');
  }
  if (mnemonicPattern.test(text)) {
    ruleIds.add('private-key:mnemonic');
  }

  credentialUrlPattern.lastIndex = 0;
  for (const match of text.matchAll(credentialUrlPattern)) {
    if (!isAllowedLocalDatabasePlaceholder(match[0])) {
      ruleIds.add('credential:connection-url');
      break;
    }
  }

  if (parameterHasCredential(credentialParameterPattern, text, 1, 2, {
    allowBareKey: true,
  })) {
    ruleIds.add('credential:url-query');
  }
  if (parameterHasCredential(quotedCredentialParameterPattern, text, 2, 4)) {
    ruleIds.add('credential:parameter');
  }

  if (
    secretAssignmentHasCredential(quotedColonAssignmentPattern, text, 1, [3])
    || secretAssignmentHasCredential(equalsAssignmentPattern, text, 1, [3, 4], {
      includeUnquoted: includeUnquotedEqualsAssignments,
      skipTypeAliases: true,
      unquotedValueIndex: 4,
    })
    || secretAssignmentHasCredential(bracketEqualsAssignmentPattern, text, 2, [4, 5], {
      includeUnquoted: includeUnquotedEqualsAssignments,
      unquotedValueIndex: 5,
    })
    || (
      includeUnquotedColonAssignments
      && secretAssignmentHasCredential(unquotedColonAssignmentPattern, text, 1, [2])
    )
  ) {
    ruleIds.add('credential:generic-assignment');
  }

  return [...ruleIds].sort();
}

async function regularFilesAndLinkFindings(rootPath) {
  const files = [];
  const findings = [];

  async function visit(directoryPath) {
    const entries = await readdir(directoryPath, { withFileTypes: true });
    for (const entry of entries) {
      const absolutePath = path.join(directoryPath, entry.name);
      const relativePath = normalizedArchivePath(path.relative(rootPath, absolutePath));

      if (entry.isSymbolicLink()) {
        findings.push({ path: relativePath, ruleId: 'archive:symbolic-link' });
      } else if (entry.isDirectory()) {
        await visit(absolutePath);
      } else if (entry.isFile()) {
        files.push({ absolutePath, relativePath });
      } else {
        findings.push({ path: relativePath, ruleId: 'archive:special-file' });
      }
    }
  }

  await visit(rootPath);
  return { files, findings };
}

async function scanExtractedTarball(rootPath) {
  const { files, findings } = await regularFilesAndLinkFindings(rootPath);

  async function scanFile(file) {
    const filenameRule = sensitiveFilenameRule(file.relativePath);
    if (filenameRule) {
      findings.push({ path: file.relativePath, ruleId: filenameRule });
    }

    const fileStats = await stat(file.absolutePath);
    if (fileStats.nlink > 1) {
      findings.push({
        path: file.relativePath,
        ruleId: 'archive:hard-link',
      });
      return;
    }
    if (fileStats.size > maxScannableFileBytes) {
      findings.push({
        path: file.relativePath,
        ruleId: 'content:oversized-unscannable-file',
      });
      return;
    }

    const contents = await readFile(file.absolutePath);
    const text = contents.toString('utf8');
    const isDeclarationFile = file.relativePath.endsWith('.d.ts');
    const isJavaScriptOrTypeScript = /\.(?:[cm]?[jt]sx?)$/u.test(file.relativePath);
    // Inline string credentials in JS/TS are quoted; unquoted right-hand sides
    // are code expressions. Declaration files cannot contain executable
    // assignments, so a KEY=value line there remains suspicious.
    for (const ruleId of contentRuleIds(text, {
      includeUnquotedColonAssignments: !isJavaScriptOrTypeScript,
      includeUnquotedEqualsAssignments:
        !isJavaScriptOrTypeScript || isDeclarationFile,
    })) {
      findings.push({ path: file.relativePath, ruleId });
    }
  }

  let nextFileIndex = 0;
  async function scanNextFile() {
    while (nextFileIndex < files.length) {
      const file = files[nextFileIndex];
      nextFileIndex += 1;
      await scanFile(file);
    }
  }
  await Promise.all(
    Array.from(
      { length: Math.min(scanConcurrency, files.length) },
      () => scanNextFile(),
    ),
  );

  return findings;
}

async function scanTarball(tarballPath) {
  let stdout;
  try {
    ({ stdout } = await execFileAsync('tar', ['-tzf', tarballPath], {
      maxBuffer: tarListMaxBufferBytes,
    }));
  } catch {
    throw new Error('Release tarball inventory could not be read.');
  }

  const entries = stdout
    .split('\n')
    .filter((entry) => entry.length > 0)
    .map(validateArchiveEntryPath);
  if (entries.length === 0) {
    throw new Error('Release tarball is empty.');
  }
  const archivePathFindings = [];
  for (const entry of entries) {
    for (const segment of normalizedArchivePath(entry).split('/')) {
      for (const ruleId of contentRuleIds(segment)) {
        archivePathFindings.push({
          path: entry,
          ruleId: `archive-path:${ruleId}`,
        });
      }
    }
  }

  const extractionRoot = await mkdtemp(
    path.join(path.dirname(tarballPath), '.release-secret-scan-'),
  );
  try {
    try {
      await execFileAsync('tar', ['-xzf', tarballPath, '-C', extractionRoot], {
        maxBuffer: tarListMaxBufferBytes,
      });
    } catch {
      throw new Error('Release tarball could not be extracted for scanning.');
    }
    const extractedFindings = await scanExtractedTarball(extractionRoot);
    return [...archivePathFindings, ...extractedFindings];
  } finally {
    await rm(extractionRoot, { force: true, recursive: true });
  }
}

function resolveTarballPath(repoRoot, tarball) {
  if (typeof tarball !== 'string' || tarball.length === 0 || path.isAbsolute(tarball)) {
    throw new Error('Release pack metadata must contain repository-relative tarball paths.');
  }

  const tarballPath = path.resolve(repoRoot, tarball);
  if (path.extname(tarballPath) !== '.tgz') {
    throw new Error('Release pack metadata contains an invalid tarball path.');
  }
  return tarballPath;
}

async function verifyTarballInventory(tarballPaths) {
  const parentDirectories = new Set(tarballPaths.map((entry) => path.dirname(entry)));
  if (parentDirectories.size !== 1) {
    throw new Error('Release tarballs must share one output directory.');
  }

  const outputDirectory = tarballPaths.length > 0 ? path.dirname(tarballPaths[0]) : null;
  if (!outputDirectory) {
    throw new Error('Release pack metadata contains no tarballs.');
  }

  const expected = new Set(tarballPaths.map((entry) => path.basename(entry)));
  if (expected.size !== tarballPaths.length) {
    throw new Error('Release pack metadata contains duplicate tarball paths.');
  }

  const actual = new Set(
    (await readdir(outputDirectory)).filter((entry) => entry.endsWith('.tgz')),
  );
  const missing = [...expected].filter((entry) => !actual.has(entry));
  const unlisted = [...actual].filter((entry) => !expected.has(entry));
  if (missing.length > 0 || unlisted.length > 0) {
    throw new Error(
      `Release tarball inventory does not match pack metadata (missing=${missing.length}, unlisted=${unlisted.length}).`,
    );
  }
}

async function verifyReleaseArtifacts(repoRoot, packOutput) {
  if (!Array.isArray(packOutput?.packages) || packOutput.packages.length === 0) {
    throw new Error('Release pack metadata must contain at least one package.');
  }

  const tarballPaths = packOutput.packages.map((entry) =>
    resolveTarballPath(repoRoot, entry?.tarball));
  await verifyTarballInventory(tarballPaths);

  const findings = [];
  for (const [tarballIndex, tarballPath] of tarballPaths.entries()) {
    const tarballName = path.basename(tarballPath);
    const tarballPathRuleIds = contentRuleIds(tarballName);
    for (const ruleId of tarballPathRuleIds) {
      findings.push({
        path: '<tarball-name>',
        ruleId: `tarball-path:${ruleId}`,
        tarballIndex,
      });
    }
    for (const finding of await scanTarball(tarballPath)) {
      findings.push({
        ...finding,
        tarballIndex,
      });
    }
  }

  findings.sort((left, right) =>
    `${left.tarballIndex}:${left.path}:${left.ruleId}`.localeCompare(
      `${right.tarballIndex}:${right.path}:${right.ruleId}`,
    ));
  if (findings.length > 0) {
    const displayed = findings.slice(0, 50);
    const lines = displayed.map(
      (finding) =>
        `- ${finding.ruleId} in tarball ${finding.tarballIndex + 1}:<archive-entry>`,
    );
    if (findings.length > displayed.length) {
      lines.push(`- ${findings.length - displayed.length} additional finding(s) omitted`);
    }
    throw new Error(
      `Release artifact secret guard rejected ${findings.length} finding(s):\n${lines.join('\n')}`,
    );
  }

  console.log(`Release artifact secret guard passed for ${tarballPaths.length} tarball(s).`);
}

function parseCliArgs(args) {
  if (args.length === 0) {
    return { packOutput: 'dist/npm/pack-output.json' };
  }
  if (args.length === 2 && args[0] === '--pack-output' && args[1].length > 0) {
    return { packOutput: args[1] };
  }
  throw new Error(
    'Usage: node scripts/release-artifact-secret-guard.mjs [--pack-output <file>]',
  );
}

async function main() {
  const options = parseCliArgs(process.argv.slice(2));
  const repoRoot = process.cwd();
  const packOutputPath = path.resolve(repoRoot, options.packOutput);
  const packOutput = JSON.parse(await readFile(packOutputPath, 'utf8'));
  await verifyReleaseArtifacts(repoRoot, packOutput);
}

const isDirectRun =
  typeof process.argv[1] === 'string'
  && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirectRun) {
  try {
    await main();
  } catch (error) {
    console.error(
      error instanceof Error
        ? error.message
        : 'Release artifact secret guard failed.',
    );
    process.exitCode = 1;
  }
}

export {
  contentRuleIds,
  sensitiveFilenameRule,
  verifyReleaseArtifacts,
};
