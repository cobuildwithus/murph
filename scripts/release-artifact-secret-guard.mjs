import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const tarListMaxBufferBytes = 64 * 1024 * 1024;
const maxScannableFileBytes = 128 * 1024 * 1024;
const scanConcurrency = 8;

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
const authorizationCredentialPatterns = [
  /\bAuthorization\s*[:=]\s*["'`]?Bearer\s+[A-Za-z0-9._~+/=-]{20,}["'`]?/iu,
  /\bAuthorization\s*[:=]\s*["'`]?Basic\s+[A-Za-z0-9+/]{8,}={0,2}["'`]?/iu,
];
const privateJwkPatterns = [
  /\bkty\s*["']?\s*:\s*["'](?:EC|OKP|RSA)["'][\s\S]{0,2000}?\bd\s*["']?\s*:\s*["']([A-Za-z0-9_-]{32,})["']/iu,
  /\bd\s*["']?\s*:\s*["']([A-Za-z0-9_-]{32,})["'][\s\S]{0,2000}?\bkty\s*["']?\s*:\s*["'](?:EC|OKP|RSA)["']/iu,
  /\bkty\s*["']?\s*:\s*["']oct["'][\s\S]{0,1000}?\bk\s*["']?\s*:\s*["']([A-Za-z0-9_-]{32,})["']/iu,
];
const credentialUrlPattern =
  /\b(?:amqps?|https?|mongodb(?:\+srv)?|mysql|nats|postgres(?:ql)?|redis|sftp):\/\/[^:\s/@]+:[^@\s/]+@[^\s"'`,;]+/giu;
const credentialQueryPattern =
  /[?&](?:api[_-]?key|key|secret|signature|token)=([^&#\s"'`]{1,4096})/giu;
const structuredSecretAssignmentPattern =
  /(?:^|[,{][ \t\r\n]*|\n[ \t]*)["'`]?\b((?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|auth[_-]?token|access[_-]?token|client[_-]?secret|private[_-]?key|password|secret|token)(?:[_-][A-Za-z0-9]+)*)\b["'`]?\s*:\s*(["'`])([^"'`\r\n]{1,4096})\2/gimu;
const declaredSecretAssignmentPattern =
  /(?:^|[;\n][ \t]*)(?:export[ \t]+)?(?:const|let|var)[ \t]+\b((?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|auth[_-]?token|access[_-]?token|client[_-]?secret|private[_-]?key|password|secret|token)(?:[_-][A-Za-z0-9]+)*)\b[ \t]*=[ \t]*(["'`])([^"'`\r\n]{1,4096})\2/gimu;
const quotedLineSecretAssignmentPattern =
  /^[ \t]*(?:export[ \t]+)?["'`]?\b((?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|auth[_-]?token|access[_-]?token|client[_-]?secret|private[_-]?key|password|secret|token)(?:[_-][A-Za-z0-9]+)*)\b["'`]?[ \t]*[:=][ \t]*(["'`])([^"'`\r\n]{1,4096})\2[ \t]*(?:;[ \t]*)?(?:#[^\r\n]*)?$/gimu;
const unquotedLineSecretAssignmentPattern =
  /^[ \t]*(?:export[ \t]+)?["'`]?\b((?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|auth[_-]?token|access[_-]?token|client[_-]?secret|private[_-]?key|password|secret|token)(?:[_-][A-Za-z0-9]+)*)\b["'`]?[ \t]*[:=][ \t]*([^"'`\s,;#]{1,4096})[ \t]*(?:;[ \t]*)?(?:#[^\r\n]*)?$/gimu;
const walletPrivateKeyPattern =
  /["'`]?\b(?:eth(?:ereum)?[_-]?)?(?:wallet[_-]?)?private[_-]?key\b["'`]?\s*[:=]\s*["'`]?(0x[0-9a-f]{64})["'`]?/iu;
const mnemonicPattern =
  /["'`]?\b(?:mnemonic|seed[_-]?phrase)\b["'`]?\s*[:=]\s*["'`]([a-z]+(?:\s+[a-z]+){11,23})["'`]/iu;

const exactPlaceholderValues = new Set([
  'api-key',
  'changeme',
  'placeholder',
  'redacted',
  'replace-me',
  'test-only',
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
    ['access_token_expires_at', 'null'],
    [
      'apiKey',
      'is a provider-owned API secret and is not supported in serialized runtime config.',
    ],
    ['claim_token', '?'],
    ['claim_token', 'null'],
    ['clientSecret', 'string'],
    ['clinical-records-token', 'device'],
    ['device-sync-token', 'device'],
    ['token', '-${suffix}'],
  ].map(([key, value]) => `${key}\0${value}`),
);
// The CLI must bundle patched incur@0.4.5. Only the pinned upstream test files
// may skip generic assignment matching; every stronger rule still scans them.
const allowedVendoredFixtureDigests = new Map([
  [
    'package/node_modules/incur/src/Cli.test.ts',
    'c33b3cdd0609475674a995a9d4e0f32fd54bc2c83082b96c307f5f7d60ec402c',
  ],
  [
    'package/node_modules/incur/src/Mcp.test.ts',
    '7332e0e53c37da5fe510a226038f2cd08917dd4ed40d4568451e2b2259e51795',
  ],
  [
    'package/node_modules/incur/src/e2e.test.ts',
    '3f6d1c5e32414aa2d01bad1467585818b15b6499b15d18f5d344664f41cfb9cc',
  ],
]);

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
  const normalized = normalizedArchivePath(relativePath).toLowerCase();
  const basename = path.posix.basename(normalized);

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
    || (
      withoutTemplateReferences !== trimmed
      && /^[A-Za-z0-9._/-]*$/u.test(withoutTemplateReferences)
    )
  );
}

function isCredentialLiteral(key, value) {
  return (
    !isExactPlaceholder(value)
    && !isCredentialReference(value)
    && !allowedPublicCredentialAssignments.has(`${key}\0${value}`)
  );
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

function secretAssignmentHasCredential(pattern, text, valueIndex) {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const key = match[1] ?? '';
    const value = match[valueIndex] ?? '';
    if (isCredentialLiteral(key, value)) {
      return true;
    }
  }
  return false;
}

function contentRuleIds(text, options = {}) {
  const includeGenericAssignments = options.includeGenericAssignments ?? true;
  const includeUnquotedLineAssignments =
    options.includeUnquotedLineAssignments ?? true;
  const ruleIds = new Set();

  for (const { pattern, ruleId } of providerPatterns) {
    if (pattern.test(text)) {
      ruleIds.add(ruleId);
    }
  }

  if (privateKeyBlockPattern.test(text)) {
    ruleIds.add('private-key:block');
  }
  if (authorizationCredentialPatterns.some((pattern) => pattern.test(text))) {
    ruleIds.add('credential:authorization-header');
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

  credentialQueryPattern.lastIndex = 0;
  for (const match of text.matchAll(credentialQueryPattern)) {
    const credential = match[1] ?? '';
    if (isCredentialLiteral('url-query', credential)) {
      ruleIds.add('credential:url-query');
      break;
    }
  }

  if (
    includeGenericAssignments
    && (
      secretAssignmentHasCredential(structuredSecretAssignmentPattern, text, 3)
      || secretAssignmentHasCredential(declaredSecretAssignmentPattern, text, 3)
      || secretAssignmentHasCredential(quotedLineSecretAssignmentPattern, text, 3)
      || (
        includeUnquotedLineAssignments
        && secretAssignmentHasCredential(unquotedLineSecretAssignmentPattern, text, 2)
      )
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
    const expectedFixtureDigest = allowedVendoredFixtureDigests.get(
      file.relativePath,
    );
    const hasExactAllowedFixtureContents = expectedFixtureDigest !== undefined
      && createHash('sha256').update(contents).digest('hex') === expectedFixtureDigest;
    for (const ruleId of contentRuleIds(text, {
      includeGenericAssignments: !hasExactAllowedFixtureContents,
      includeUnquotedLineAssignments: !file.relativePath.endsWith('.d.ts'),
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
