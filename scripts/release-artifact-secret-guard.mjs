import { execFile } from 'node:child_process';
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
const bearerCredentialPattern =
  /\bAuthorization\s*[:=]\s*["'`]?Bearer\s+[A-Za-z0-9._~+/=-]{20,}["'`]?/iu;
const privateJwkPatterns = [
  /\bkty\s*["']?\s*:\s*["'](?:EC|OKP|RSA)["'][\s\S]{0,2000}?\bd\s*["']?\s*:\s*["']([A-Za-z0-9_-]{32,})["']/iu,
  /\bd\s*["']?\s*:\s*["']([A-Za-z0-9_-]{32,})["'][\s\S]{0,2000}?\bkty\s*["']?\s*:\s*["'](?:EC|OKP|RSA)["']/iu,
  /\bkty\s*["']?\s*:\s*["']oct["'][\s\S]{0,1000}?\bk\s*["']?\s*:\s*["']([A-Za-z0-9_-]{32,})["']/iu,
];
const credentialUrlPattern =
  /\b(?:amqps?|https?|mongodb(?:\+srv)?|mysql|nats|postgres(?:ql)?|redis|sftp):\/\/([^:\s/@]+):([^@\s/]+)@/giu;
const credentialQueryPattern =
  /[?&](?:api[_-]?key|key|secret|signature|token)=([^&#\s"'`]{16,})/giu;
const secretAssignmentPattern =
  /["'`]?\b((?:[A-Za-z0-9]+[_-])*(?:api[_-]?key|auth[_-]?token|access[_-]?token|client[_-]?secret|private[_-]?key|password|secret|token)(?:[_-][A-Za-z0-9]+)*)\b["'`]?\s*[:=]\s*["'`]([^"'`\s,;]{20,})["'`]/giu;
const walletPrivateKeyPattern =
  /["'`]?\b(?:eth(?:ereum)?[_-]?)?(?:wallet[_-]?)?private[_-]?key\b["'`]?\s*[:=]\s*["'`]?(0x[0-9a-f]{64})["'`]?/iu;
const mnemonicPattern =
  /["'`]?\b(?:mnemonic|seed[_-]?phrase)\b["'`]?\s*[:=]\s*["'`]([a-z]+(?:\s+[a-z]+){11,23})["'`]/iu;

const placeholderMarkers = [
  'changeme',
  'dummy',
  'example',
  'fake',
  'fixture',
  'localhost',
  'placeholder',
  'postgres',
  'redacted',
  'replace-me',
  'sample',
  'test-only',
];

function isPathInside(parentPath, candidatePath) {
  const relativePath = path.relative(parentPath, candidatePath);
  return (
    relativePath.length === 0
    || (!relativePath.startsWith(`..${path.sep}`) && relativePath !== '..' && !path.isAbsolute(relativePath))
  );
}

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

function shannonEntropy(value) {
  const frequencies = new Map();
  for (const character of value) {
    frequencies.set(character, (frequencies.get(character) ?? 0) + 1);
  }

  let entropy = 0;
  for (const count of frequencies.values()) {
    const probability = count / value.length;
    entropy -= probability * Math.log2(probability);
  }
  return entropy;
}

function isObviousPlaceholder(value) {
  const normalized = value.toLowerCase();
  if (placeholderMarkers.some((marker) => normalized.includes(marker))) {
    return true;
  }
  if (/^(?:x+|0+|1+|a+)$/iu.test(value)) {
    return true;
  }
  if (/^[A-Z][A-Z0-9_]+$/u.test(value)) {
    return true;
  }
  return false;
}

function isPlausibleGenericSecret(value) {
  if (
    value.length < 20
    || value.length > 4096
    || isObviousPlaceholder(value)
    || !/^[A-Za-z0-9._+/=-]+$/u.test(value)
  ) {
    return false;
  }

  const characterClasses = [
    /[a-z]/u,
    /[A-Z]/u,
    /[0-9]/u,
    /[^A-Za-z0-9]/u,
  ].filter((pattern) => pattern.test(value)).length;
  return characterClasses >= 2 && shannonEntropy(value) >= 3.25;
}

function isPublicHeaderNameAssignment(key, value) {
  return (
    /_HEADER$/iu.test(key)
    && /^x-[a-z0-9]+(?:-[a-z0-9]+)+$/u.test(value)
  );
}

function contentRuleIds(text) {
  const ruleIds = new Set();

  for (const { pattern, ruleId } of providerPatterns) {
    if (pattern.test(text)) {
      ruleIds.add(ruleId);
    }
  }

  if (privateKeyBlockPattern.test(text)) {
    ruleIds.add('private-key:block');
  }
  if (bearerCredentialPattern.test(text)) {
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
    const password = match[2] ?? '';
    if (!isObviousPlaceholder(password)) {
      ruleIds.add('credential:connection-url');
      break;
    }
  }

  credentialQueryPattern.lastIndex = 0;
  for (const match of text.matchAll(credentialQueryPattern)) {
    const credential = match[1] ?? '';
    if (!isObviousPlaceholder(credential)) {
      ruleIds.add('credential:url-query');
      break;
    }
  }

  secretAssignmentPattern.lastIndex = 0;
  for (const match of text.matchAll(secretAssignmentPattern)) {
    const key = match[1] ?? '';
    const value = match[2] ?? '';
    if (
      !isPublicHeaderNameAssignment(key, value)
      && isPlausibleGenericSecret(value)
    ) {
      ruleIds.add('credential:generic-assignment');
      break;
    }
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

    const text = (await readFile(file.absolutePath)).toString('utf8');
    for (const ruleId of contentRuleIds(text)) {
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
    throw new Error(`Release tarball is empty: ${path.basename(tarballPath)}`);
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
    return await scanExtractedTarball(extractionRoot);
  } finally {
    await rm(extractionRoot, { force: true, recursive: true });
  }
}

function resolveTarballPath(repoRoot, tarball) {
  if (typeof tarball !== 'string' || tarball.length === 0 || path.isAbsolute(tarball)) {
    throw new Error('Release pack metadata must contain repository-relative tarball paths.');
  }

  const tarballPath = path.resolve(repoRoot, tarball);
  if (!isPathInside(repoRoot, tarballPath) || path.extname(tarballPath) !== '.tgz') {
    throw new Error(`Release pack metadata contains an invalid tarball path: ${tarball}`);
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
  for (const tarballPath of tarballPaths) {
    for (const finding of await scanTarball(tarballPath)) {
      findings.push({
        ...finding,
        tarball: path.basename(tarballPath),
      });
    }
  }

  findings.sort((left, right) =>
    `${left.tarball}:${left.path}:${left.ruleId}`.localeCompare(
      `${right.tarball}:${right.path}:${right.ruleId}`,
    ));
  if (findings.length > 0) {
    const displayed = findings.slice(0, 50);
    const lines = displayed.map(
      (finding) => `- ${finding.ruleId} in ${finding.tarball}:${finding.path}`,
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
  if (!isPathInside(repoRoot, packOutputPath)) {
    throw new Error('Release pack metadata must stay inside the repository.');
  }
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
