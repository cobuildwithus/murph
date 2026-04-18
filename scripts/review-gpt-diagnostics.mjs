#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import {
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const DEFAULT_BROWSER_ENDPOINT = 'http://127.0.0.1:9222';
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME_DIR = os.homedir();
const HOME_DIR_PATTERN = HOME_DIR ? new RegExp(escapeRegExp(HOME_DIR), 'gu') : null;
const require = createRequire(import.meta.url);

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function sanitizeText(value) {
  const input = String(value ?? '');
  if (!input) {
    return '';
  }
  return HOME_DIR_PATTERN ? input.replace(HOME_DIR_PATTERN, '<HOME_DIR>') : input;
}

function sanitizeValue(value) {
  if (typeof value === 'string') {
    return sanitizeText(value);
  }
  if (Array.isArray(value)) {
    return value.map((entry) => sanitizeValue(entry));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [key, sanitizeValue(entry)]),
    );
  }
  return value;
}

function relativeToRepo(targetPath) {
  const resolved = path.resolve(targetPath);
  const relativePath = path.relative(ROOT_DIR, resolved);
  return relativePath || '.';
}

function safeRelativePath(targetPath) {
  if (!targetPath) {
    return '';
  }
  return sanitizeText(relativeToRepo(targetPath));
}

function parseArgs(argv) {
  const options = {
    browserEndpoint: DEFAULT_BROWSER_ENDPOINT,
    chatUrl: '',
    commandLabel: 'review:gpt',
    exitCode: undefined,
    logFile: '',
    outputDir: '',
    receiptPath: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    switch (argument) {
      case '--browser-endpoint':
        options.browserEndpoint = argv[index + 1] ?? '';
        index += 1;
        break;
      case '--chat-url':
        options.chatUrl = argv[index + 1] ?? '';
        index += 1;
        break;
      case '--command-label':
        options.commandLabel = argv[index + 1] ?? '';
        index += 1;
        break;
      case '--exit-code':
        options.exitCode = Number.parseInt(argv[index + 1] ?? '', 10);
        index += 1;
        break;
      case '--log-file':
        options.logFile = argv[index + 1] ?? '';
        index += 1;
        break;
      case '--output-dir':
        options.outputDir = argv[index + 1] ?? '';
        index += 1;
        break;
      case '--receipt-path':
        options.receiptPath = argv[index + 1] ?? '';
        index += 1;
        break;
      default:
        if (argument.startsWith('--browser-endpoint=')) {
          options.browserEndpoint = argument.slice('--browser-endpoint='.length);
          break;
        }
        if (argument.startsWith('--chat-url=')) {
          options.chatUrl = argument.slice('--chat-url='.length);
          break;
        }
        if (argument.startsWith('--command-label=')) {
          options.commandLabel = argument.slice('--command-label='.length);
          break;
        }
        if (argument.startsWith('--exit-code=')) {
          options.exitCode = Number.parseInt(argument.slice('--exit-code='.length), 10);
          break;
        }
        if (argument.startsWith('--log-file=')) {
          options.logFile = argument.slice('--log-file='.length);
          break;
        }
        if (argument.startsWith('--output-dir=')) {
          options.outputDir = argument.slice('--output-dir='.length);
          break;
        }
        if (argument.startsWith('--receipt-path=')) {
          options.receiptPath = argument.slice('--receipt-path='.length);
          break;
        }
        throw new Error(`Unsupported argument: ${argument}`);
    }
  }

  if (!options.chatUrl) {
    throw new Error('--chat-url is required.');
  }

  return options;
}

function parseUrl(value) {
  try {
    return new URL(value);
  } catch {
    return null;
  }
}

function normalizePathname(pathname) {
  const normalized = String(pathname ?? '').replace(/\/+$/u, '');
  return normalized.length > 0 ? normalized : '/';
}

function extractChatId(pathname) {
  const match = normalizePathname(pathname).match(/^\/c\/([^/?#]+)$/u);
  return match?.[1] ?? '';
}

function conversationUrlsReferToSameThread(candidateUrl, chatUrl) {
  const candidate = parseUrl(candidateUrl);
  const chat = parseUrl(chatUrl);
  if (!candidate || !chat || candidate.origin !== chat.origin) {
    return false;
  }
  const candidateChatId = extractChatId(candidate.pathname);
  const chatId = extractChatId(chat.pathname);
  return Boolean(candidateChatId) && Boolean(chatId) && candidateChatId === chatId;
}

function scoreThreadTargetUrl(targetUrl, chatUrl) {
  const target = parseUrl(targetUrl ?? '');
  const chat = parseUrl(chatUrl);
  if (!target || !chat || target.origin !== chat.origin) {
    return -1;
  }
  const normalizedTargetPath = normalizePathname(target.pathname);
  const normalizedChatPath = normalizePathname(chat.pathname);
  if (normalizedTargetPath === normalizedChatPath && target.search === chat.search) {
    return 3;
  }
  if (conversationUrlsReferToSameThread(targetUrl ?? '', chatUrl)) {
    return 2;
  }
  return -1;
}

function endpointUrl(browserEndpoint, pathname) {
  const normalizedBase = browserEndpoint.endsWith('/')
    ? browserEndpoint
    : `${browserEndpoint}/`;
  return new URL(pathname.replace(/^\//u, ''), normalizedBase).toString();
}

async function fetchJson(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} for ${url}`);
  }
  return await response.json();
}

function slugify(value, fallback) {
  const slug = String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, '-')
    .replace(/^-+|-+$/gu, '');
  return slug || fallback;
}

function resolveOutputDir(options) {
  if (options.outputDir) {
    return path.resolve(options.outputDir);
  }
  const chatId = extractChatId(parseUrl(options.chatUrl)?.pathname ?? '') || 'thread';
  const label = slugify(options.commandLabel, 'review-gpt');
  const timestamp = new Date().toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}Z$/u, 'Z');
  return path.join(
    ROOT_DIR,
    'output-packages',
    'review-gpt-diagnostics',
    `${timestamp}-${label}-${chatId}-${process.pid}`,
  );
}

async function copySanitizedTextFile(sourcePath, destinationPath) {
  if (!sourcePath || !existsSync(sourcePath)) {
    return null;
  }
  const raw = await readFile(sourcePath, 'utf8');
  await writeFile(destinationPath, sanitizeText(raw), 'utf8');
  return destinationPath;
}

async function copySanitizedJsonFile(sourcePath, destinationPath) {
  if (!sourcePath || !existsSync(sourcePath)) {
    return null;
  }
  const raw = await readFile(sourcePath, 'utf8');
  const parsed = JSON.parse(raw);
  await writeFile(destinationPath, `${JSON.stringify(sanitizeValue(parsed), null, 2)}\n`, 'utf8');
  return {
    destinationPath,
    parsed,
  };
}

async function writeSanitizedJson(destinationPath, value) {
  await writeFile(
    destinationPath,
    `${JSON.stringify(sanitizeValue(value), null, 2)}\n`,
    'utf8',
  );
}

async function collectBrowserDiagnostics(browserEndpoint, chatUrl) {
  const diagnostics = {
    browserEndpoint,
    matchingThreadTargetCount: 0,
    matchingTargets: [],
    pageTargetCount: 0,
    preferredTargetId: '',
    preferredTargetUrl: '',
    targetCount: 0,
  };

  const [version, targets] = await Promise.all([
    fetchJson(endpointUrl(browserEndpoint, '/json/version')),
    fetchJson(endpointUrl(browserEndpoint, '/json/list')),
  ]);

  diagnostics.targetCount = Array.isArray(targets) ? targets.length : 0;
  diagnostics.pageTargetCount = Array.isArray(targets)
    ? targets.filter((target) => target?.type === 'page').length
    : 0;

  let bestScore = -1;
  let preferredTarget = null;
  const matchingTargets = [];

  for (const target of Array.isArray(targets) ? targets : []) {
    const score = scoreThreadTargetUrl(target?.url, chatUrl);
    if (target?.type === 'page' && score >= 0) {
      const summary = {
        id: String(target.id ?? ''),
        score,
        title: String(target.title ?? ''),
        type: String(target.type ?? ''),
        url: String(target.url ?? ''),
      };
      matchingTargets.push(summary);
      if (score >= bestScore) {
        bestScore = score;
        preferredTarget = summary;
      }
    }
  }

  diagnostics.matchingThreadTargetCount = matchingTargets.length;
  diagnostics.matchingTargets = matchingTargets.map((target) => ({
    ...target,
    isPreferred: preferredTarget?.id === target.id,
  }));
  diagnostics.preferredTargetId = preferredTarget?.id ?? '';
  diagnostics.preferredTargetUrl = preferredTarget?.url ?? '';

  return {
    browser: diagnostics,
    version: {
      browser: String(version?.Browser ?? ''),
      protocolVersion: String(version?.['Protocol-Version'] ?? ''),
      userAgent: String(version?.['User-Agent'] ?? ''),
      webSocketDebuggerUrl: String(version?.webSocketDebuggerUrl ?? ''),
    },
  };
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? ROOT_DIR,
      env: options.env ?? process.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', (error) => {
      resolve({
        code: null,
        error: error.message,
        stderr,
        stdout,
      });
    });
    child.on('close', (code) => {
      resolve({
        code,
        error: '',
        stderr,
        stdout,
      });
    });
  });
}

async function exportThreadSnapshot({ browserEndpoint, chatUrl, outputDir }) {
  const exportLogPath = path.join(outputDir, 'thread-export.log');
  const temporaryExportPath = path.join(outputDir, 'thread.raw.json');
  const exportPath = path.join(outputDir, 'thread.json');
  const result = await runCommand('bash', [
    path.join(ROOT_DIR, 'scripts', 'review-gpt-cli.sh'),
    'thread',
    'export',
    '--browser-endpoint',
    browserEndpoint,
    '--chat-url',
    chatUrl,
    '--output',
    temporaryExportPath,
  ]);

  const exportLog = [
    result.stdout.trim(),
    result.stderr.trim(),
    result.error ? `spawn-error: ${result.error}` : '',
  ]
    .filter(Boolean)
    .join('\n');

  await writeFile(exportLogPath, sanitizeText(`${exportLog}\n`), 'utf8');

  if (result.code !== 0 || result.error) {
    await rm(temporaryExportPath, { force: true });
    return {
      error: result.error || `thread export exited with code ${String(result.code)}`,
      exportLogPath,
      exportPath: '',
      status: 'failed',
    };
  }

  const rawExport = await readFile(temporaryExportPath, 'utf8');
  await writeFile(exportPath, sanitizeText(rawExport), 'utf8');
  await rm(temporaryExportPath, { force: true });

  return {
    error: '',
    exportLogPath,
    exportPath,
    status: 'succeeded',
  };
}

function resolveInstalledReviewGptVersion() {
  const localPackageJsonPath = path.join(ROOT_DIR, '..', 'review-gpt', 'package.json');
  if (existsSync(localPackageJsonPath)) {
    try {
      const packageJson = JSON.parse(sanitizeText(readFileSync(localPackageJsonPath, 'utf8')));
      return String(packageJson.version ?? '');
    } catch {
      return '';
    }
  }
  try {
    const packageJsonPath = require.resolve('@cobuild/review-gpt/package.json');
    const packageJson = JSON.parse(sanitizeText(readFileSync(packageJsonPath, 'utf8')));
    return String(packageJson.version ?? '');
  } catch {
    return '';
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outputDir = resolveOutputDir(options);
  await mkdir(outputDir, { recursive: true });

  const commandLogCopyPath = options.logFile
    ? await copySanitizedTextFile(options.logFile, path.join(outputDir, 'command.log'))
    : null;

  const receiptCopy = options.receiptPath
    ? await copySanitizedJsonFile(options.receiptPath, path.join(outputDir, 'receipt.json'))
    : null;

  let browserDiagnostics = {
    browser: {
      browserEndpoint: options.browserEndpoint,
      matchingTargets: [],
      matchingThreadTargetCount: 0,
      pageTargetCount: 0,
      preferredTargetId: '',
      preferredTargetUrl: '',
      targetCount: 0,
    },
    version: {
      browser: '',
      protocolVersion: '',
      userAgent: '',
      webSocketDebuggerUrl: '',
    },
  };
  let browserError = '';

  try {
    browserDiagnostics = await collectBrowserDiagnostics(
      options.browserEndpoint,
      options.chatUrl,
    );
  } catch (error) {
    browserError =
      error instanceof Error ? error.message : 'Failed to fetch managed browser diagnostics.';
  }

  await writeSanitizedJson(
    path.join(outputDir, 'browser-version.json'),
    browserDiagnostics.version,
  );
  await writeSanitizedJson(
    path.join(outputDir, 'browser-targets.json'),
    browserDiagnostics.browser,
  );

  const exportResult = await exportThreadSnapshot({
    browserEndpoint: options.browserEndpoint,
    chatUrl: options.chatUrl,
    outputDir,
  });

  const status = {
    generatedAt: new Date().toISOString(),
    chatUrl: options.chatUrl,
    commandLabel: options.commandLabel,
    commandLogPath: commandLogCopyPath ? safeRelativePath(commandLogCopyPath) : '',
    commandLogSourcePath: options.logFile ? safeRelativePath(options.logFile) : '',
    exitCode: Number.isFinite(options.exitCode) ? options.exitCode : null,
    inputReceiptPath: options.receiptPath ? safeRelativePath(options.receiptPath) : '',
    installedReviewGptVersion: resolveInstalledReviewGptVersion(),
    outputDir: safeRelativePath(outputDir),
    receipt: receiptCopy?.parsed
      ? {
          nextWakeStatus: String(receiptCopy.parsed.nextWakeStatus ?? ''),
          requestedDepth: Number(receiptCopy.parsed.requestedDepth ?? 0),
          reviewSendStatus: String(receiptCopy.parsed.reviewSendStatus ?? ''),
        }
      : null,
    receiptCopyPath: receiptCopy?.destinationPath
      ? safeRelativePath(receiptCopy.destinationPath)
      : '',
    browser: {
      ...browserDiagnostics.browser,
      error: browserError,
    },
    export: {
      error: exportResult.error,
      exportLogPath: safeRelativePath(exportResult.exportLogPath),
      exportPath: exportResult.exportPath ? safeRelativePath(exportResult.exportPath) : '',
      status: exportResult.status,
    },
  };

  await writeSanitizedJson(path.join(outputDir, 'status.json'), status);
  process.stdout.write(`${safeRelativePath(outputDir)}\n`);
}

main().catch((error) => {
  const message =
    error instanceof Error ? error.message : 'review-gpt diagnostics failed unexpectedly.';
  process.stderr.write(`${sanitizeText(message)}\n`);
  process.exitCode = 1;
});
