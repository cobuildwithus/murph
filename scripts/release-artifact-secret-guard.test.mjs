import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { link, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  contentRuleIds,
  verifyReleaseArtifacts,
} from './release-artifact-secret-guard.mjs';

const execFileAsync = promisify(execFile);

function syntheticJwtCredential() {
  return [
    'eyJhbGciOiJIUzI1NiIs' + 'InR5cCI6IkpXVCJ9',
    'eyJzdWIiOiIxMjM0NTY3' + 'ODkwIiwiaWF0IjoxNTE2MjM5MDIyfQ',
    'SflKxwRJSMeKKF2QT4fwp' + 'MeJf36POk6yJV_adQssw5c',
  ].join('.');
}

async function createTarball(files, options = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'murph-release-secret-guard-'));
  const packageRoot = path.join(root, 'package');
  const outputRoot = path.join(root, 'dist', 'npm');
  await mkdir(packageRoot, { recursive: true });
  await mkdir(outputRoot, { recursive: true });

  for (const [relativePath, contents] of Object.entries(files)) {
    const targetPath = path.join(packageRoot, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, contents);
  }
  for (const [relativePath, target] of Object.entries(options.symlinks ?? {})) {
    const linkPath = path.join(packageRoot, relativePath);
    await mkdir(path.dirname(linkPath), { recursive: true });
    await symlink(target, linkPath);
  }
  for (const [relativePath, target] of Object.entries(options.hardlinks ?? {})) {
    const linkPath = path.join(packageRoot, relativePath);
    await mkdir(path.dirname(linkPath), { recursive: true });
    await link(path.join(packageRoot, target), linkPath);
  }

  const tarballFilename = options.tarballFilename ?? 'fixture-package-1.0.0.tgz';
  const tarballPath = path.join(outputRoot, tarballFilename);
  await execFileAsync('tar', ['-czf', tarballPath, '-C', root, 'package']);

  const packOutput = {
    packages: [
      {
        name: '@fixture/package',
        tarball: path.relative(root, tarballPath),
        tarballFilename,
      },
    ],
  };

  return {
    cleanup: async () => rm(root, { force: true, recursive: true }),
    outputRoot,
    packOutput,
    root,
  };
}

test('accepts ordinary package code and obvious local placeholders', async () => {
  const fixture = await createTarball({
    'dist/index.js': [
      'const privateKeyHeader = "-----BEGIN PRIVATE KEY-----";',
      'const localDatabase = "postgresql://postgres:postgres@127.0.0.1:5432/example";',
      'const metricKey = "cohortKey_abcdefghijklmnopqrstuvwxyz012345";',
      'const TELEGRAM_SECRET_TOKEN_HEADER = "x-telegram-bot-api-secret-token";',
      'const HOSTED_PRODUCT_FEEDBACK_REDACTION_TOKEN = "[redacted]";',
      'const REDACTED_SECRET = "<REDACTED_SECRET>";',
      'const REDACTED_SECRET_TEXT = "[REDACTED]";',
      'const token = `-${suffix}`;',
      'const laneDomains = { "clinical-records-token": "device", "device-sync-token": "device" };',
      'const configShape = { "api-key": "api-key", "AUTH_TOKEN": { type: "string" } };',
      'export { configShape, HOSTED_PRODUCT_FEEDBACK_REDACTION_TOKEN, laneDomains, localDatabase, metricKey, privateKeyHeader, REDACTED_SECRET, REDACTED_SECRET_TEXT, TELEGRAM_SECRET_TOKEN_HEADER, token };',
    ].join('\n'),
    'dist/index.d.ts': [
      'export interface CredentialShape {',
      '  API_TOKEN: string;',
      '  clientSecret: string;',
      '}',
    ].join('\n'),
    'package.json': '{"name":"@fixture/package","version":"1.0.0"}',
  });
  try {
    await verifyReleaseArtifacts(fixture.root, fixture.packOutput);
  } finally {
    await fixture.cleanup();
  }
});

test('detects quoted and unquoted generic secret assignments', () => {
  const secret = ['uY7nQ2pL9vR4', 'xT8mW3cD6fH1'].join('');
  for (const assignment of [
    `{"CLOUDFLARE_API_TOKEN":"${secret}"}`,
    `CLOUDFLARE_API_TOKEN=${secret}`,
    `export AUTH_TOKEN=${secret}`,
    `export AUTH_TOKEN=${secret};`,
    `AUTH_TOKEN=${secret} # production`,
    `client_secret: ${secret}`,
    `client_secret = '${secret}'`,
  ]) {
    assert.ok(
      contentRuleIds(assignment).includes('credential:generic-assignment'),
      `expected generic credential rule for ${assignment.split(/[:=]/u, 1)[0]}`,
    );
  }

  for (const assignment of [
    'CLOUDFLARE_API_TOKEN=placeholder',
    'client_secret: ${CLIENT_SECRET}',
    'token=$TOKEN',
    'const TELEGRAM_SECRET_TOKEN_HEADER = "x-telegram-bot-api-secret-token";',
  ]) {
    assert.equal(
      contentRuleIds(assignment).includes('credential:generic-assignment'),
      false,
    );
  }
});

test('does not trust a modified vendored fixture at an allowed path', async () => {
  const credential = ['uY7nQ2pL9vR4', 'xT8mW3cD6fH1'].join('');
  const fixture = await createTarball({
    'node_modules/incur/src/Cli.test.ts': `const fixture = { API_TOKEN: "${credential}" };`,
    'package.json': '{"name":"@fixture/package","version":"1.0.0"}',
  });
  try {
    await assert.rejects(
      verifyReleaseArtifacts(fixture.root, fixture.packOutput),
      (error) => {
        assert.match(error.message, /credential:generic-assignment/u);
        assert.equal(error.message.includes(credential), false);
        return true;
      },
    );
  } finally {
    await fixture.cleanup();
  }
});

test('does not exempt complete credentials based on value shape', () => {
  const uppercaseToken = ['ABCDEFGHJKLMNPQR', 'STUVWXYZ23456789'].join('');
  const symbolPassword = ['correct-horse!', '#battery-staple'].join('');
  const basicCredential = ['c2VydmljZTp', 'wYXNzd29yZA=='].join('');
  const jwtCredential = syntheticJwtCredential();
  const cases = [
    {
      ruleId: 'credential:connection-url',
      text: 'postgresql://postgres:postgres@db.example.invalid/app',
    },
    {
      ruleId: 'credential:url-query',
      text: `https://api.example.invalid/deploy?token=${uppercaseToken}`,
    },
    {
      ruleId: 'credential:generic-assignment',
      text: `CLOUDFLARE_API_TOKEN=${uppercaseToken}`,
    },
    {
      ruleId: 'credential:generic-assignment',
      text: `password: "${symbolPassword}"`,
    },
    {
      ruleId: 'credential:generic-assignment',
      text: `ACCESS_TOKEN=${jwtCredential}`,
    },
    {
      ruleId: 'credential:url-query',
      text: `https://api.example.invalid/deploy?token=${jwtCredential}`,
    },
    {
      ruleId: 'credential:authorization-header',
      text: `Authorization: Basic ${basicCredential}`,
    },
  ];

  for (const testCase of cases) {
    assert.ok(contentRuleIds(testCase.text).includes(testCase.ruleId));
  }
});

test('rejects sensitive credential filenames', async () => {
  const fixture = await createTarball({
    '.env.production': 'SERVICE_TOKEN=not-a-real-value',
    'package.json': '{"name":"@fixture/package","version":"1.0.0"}',
  });
  try {
    await assert.rejects(
      verifyReleaseArtifacts(fixture.root, fixture.packOutput),
      (error) => {
        assert.match(error.message, /sensitive-filename:dotenv/u);
        assert.match(error.message, /tarball 1:<archive-entry>/u);
        assert.equal(error.message.includes('.env.production'), false);
        return true;
      },
    );
  } finally {
    await fixture.cleanup();
  }
});

test('rejects provider tokens without printing their values', async () => {
  const credential = ['sk', 'live', 'A1b2C3d4E5f6G7h8I9j0K1l2'].join('_');
  const fixture = await createTarball({
    'dist/config.js': `export const billingCredential = ${JSON.stringify(credential)};`,
    'package.json': '{"name":"@fixture/package","version":"1.0.0"}',
  });
  try {
    await assert.rejects(
      verifyReleaseArtifacts(fixture.root, fixture.packOutput),
      (error) => {
        assert.match(error.message, /provider-token:stripe/u);
        assert.equal(error.message.includes(credential), false);
        return true;
      },
    );
  } finally {
    await fixture.cleanup();
  }
});

test('rejects complete private-key blocks and private JWKs', async () => {
  const privateKeyBlock = [
    '-----BEGIN ' + 'PRIVATE KEY-----',
    'QWxwaGFCZXRhR2FtbWFEZWx0YUVwc2lsb25aZXRhRXRhVGhldGE=',
    '-----END ' + 'PRIVATE KEY-----',
  ].join('\n');
  const privateJwk = {
    d: [
      'YWFhYmJiY2NjZGRkZWVlZmZm',
      'Z2dnaGhoaWlpampqa2trbGxs',
    ].join(''),
    kty: 'EC',
    x: 'public-coordinate-x',
    y: 'public-coordinate-y',
  };
  const fixture = await createTarball({
    'dist/key.txt': privateKeyBlock,
    'dist/recipient.json': JSON.stringify(privateJwk),
    'package.json': '{"name":"@fixture/package","version":"1.0.0"}',
  });
  try {
    await assert.rejects(
      verifyReleaseArtifacts(fixture.root, fixture.packOutput),
      (error) => {
        assert.match(error.message, /private-key:block/u);
        assert.match(error.message, /private-key:jwk/u);
        assert.equal(error.message.includes(privateJwk.d), false);
        return true;
      },
    );
  } finally {
    await fixture.cleanup();
  }
});

test('rejects credential URLs, JSON secret assignments, and wallet keys', async () => {
  const password = ['vN7mP2qR8sT4', 'uW9xY3zA6bC1'].join('');
  const deployHookKey = ['dH8kP3mR7tV2', 'wX9zB4cF6gJ1'].join('');
  const genericSecret = ['uY7nQ2pL9vR4', 'xT8mW3cD6fH1'].join('');
  const jwtCredential = syntheticJwtCredential();
  const walletKey = `0x${'a1'.repeat(32)}`;
  const fixture = await createTarball({
    'dist/config.js': [
      `const database = "postgresql://service:${password}@db.example.invalid/app";`,
      `const deployHook = "https://api.example.invalid/deploy/service?key=${deployHookKey}";`,
      `const tokenUrl = "https://api.example.invalid/deploy?token=${jwtCredential}";`,
      `CLOUDFLARE_API_TOKEN=${genericSecret} # production`,
      `export ACCESS_TOKEN=${jwtCredential};`,
      `const wallet = {"ETH_WALLET_PRIVATE_KEY":"${walletKey}"};`,
    ].join('\n'),
    'package.json': '{"name":"@fixture/package","version":"1.0.0"}',
  });
  try {
    await assert.rejects(
      verifyReleaseArtifacts(fixture.root, fixture.packOutput),
      (error) => {
        assert.match(error.message, /credential:connection-url/u);
        assert.match(error.message, /credential:url-query/u);
        assert.match(error.message, /credential:generic-assignment/u);
        assert.match(error.message, /private-key:wallet/u);
        assert.equal(error.message.includes(password), false);
        assert.equal(error.message.includes(deployHookKey), false);
        assert.equal(error.message.includes(genericSecret), false);
        assert.equal(error.message.includes(jwtCredential), false);
        assert.equal(error.message.includes(walletKey), false);
        return true;
      },
    );
  } finally {
    await fixture.cleanup();
  }
});

test('rejects credential-bearing paths without printing credential material', async () => {
  const credential = ['uY7nQ2pL9vR4', 'xT8mW3cD6fH1'].join('');
  const fixture = await createTarball({
    [`dist/token=${credential}/.env.production`]: 'public fixture content',
    'package.json': '{"name":"@fixture/package","version":"1.0.0"}',
  });
  try {
    await assert.rejects(
      verifyReleaseArtifacts(fixture.root, fixture.packOutput),
      (error) => {
        assert.match(error.message, /archive-path:credential:generic-assignment/u);
        assert.match(error.message, /sensitive-filename:dotenv/u);
        assert.match(error.message, /tarball 1:<archive-entry>/u);
        assert.equal(error.message.includes(credential), false);
        assert.equal(error.message.includes('.env.production'), false);
        return true;
      },
    );
  } finally {
    await fixture.cleanup();
  }
});

test('redacts credential material in the tarball filename', async () => {
  const credential = ['sk', 'live', 'A1b2C3d4E5f6G7h8I9j0K1l2'].join('_');
  const fixture = await createTarball(
    {
      'package.json': '{"name":"@fixture/package","version":"1.0.0"}',
    },
    {
      tarballFilename: `fixture-${credential}.tgz`,
    },
  );
  try {
    await assert.rejects(
      verifyReleaseArtifacts(fixture.root, fixture.packOutput),
      (error) => {
        assert.match(error.message, /tarball-path:provider-token:stripe/u);
        assert.match(error.message, /tarball 1:<archive-entry>/u);
        assert.equal(error.message.includes(credential), false);
        return true;
      },
    );
  } finally {
    await fixture.cleanup();
  }
});

test('rejects mnemonic phrases and complete authorization credentials', async () => {
  const mnemonic = [
    'alpha', 'bravo', 'charlie', 'delta', 'echo', 'foxtrot',
    'golf', 'hotel', 'india', 'juliet', 'kilo', 'lima',
  ].join(' ');
  const bearerCredential = [
    'opaque', 'bearer', 'credential', 'A1b2C3d4E5f6G7h8I9j0',
  ].join('.');
  const basicCredential = ['c2VydmljZTp', 'wYXNzd29yZA=='].join('');
  const fixture = await createTarball({
    'dist/auth.js': [
      `const wallet = {"seed_phrase":"${mnemonic}"};`,
      `const authorization = "Authorization: Bearer ${bearerCredential}";`,
      `const legacyAuthorization = "Authorization: Basic ${basicCredential}";`,
    ].join('\n'),
    'package.json': '{"name":"@fixture/package","version":"1.0.0"}',
  });
  try {
    await assert.rejects(
      verifyReleaseArtifacts(fixture.root, fixture.packOutput),
      (error) => {
        assert.match(error.message, /private-key:mnemonic/u);
        assert.match(error.message, /credential:authorization-header/u);
        assert.equal(error.message.includes(mnemonic), false);
        assert.equal(error.message.includes(bearerCredential), false);
        assert.equal(error.message.includes(basicCredential), false);
        return true;
      },
    );
  } finally {
    await fixture.cleanup();
  }
});

test('accepts pack manifests and tarballs outside the repository', async () => {
  const fixture = await createTarball({
    'package.json': '{"name":"@fixture/package","version":"1.0.0"}',
  });
  const repoRoot = process.cwd();
  const tarballPath = path.resolve(
    fixture.root,
    fixture.packOutput.packages[0].tarball,
  );
  const externalPackOutput = {
    ...fixture.packOutput,
    packages: [
      {
        ...fixture.packOutput.packages[0],
        tarball: path.relative(repoRoot, tarballPath),
      },
    ],
  };
  const packOutputPath = path.join(fixture.root, 'pack-output.json');
  await writeFile(packOutputPath, JSON.stringify(externalPackOutput));

  try {
    await verifyReleaseArtifacts(repoRoot, externalPackOutput);
    const { stdout } = await execFileAsync(
      'node',
      [
        'scripts/release-artifact-secret-guard.mjs',
        '--pack-output',
        packOutputPath,
      ],
      { cwd: repoRoot },
    );
    assert.match(stdout, /passed for 1 tarball/u);
  } finally {
    await fixture.cleanup();
  }
});

test('rejects unlisted tarballs in the upload directory', async () => {
  const fixture = await createTarball({
    'package.json': '{"name":"@fixture/package","version":"1.0.0"}',
  });
  try {
    await writeFile(path.join(fixture.outputRoot, 'unlisted.tgz'), 'not-a-tarball');
    await assert.rejects(
      verifyReleaseArtifacts(fixture.root, fixture.packOutput),
      /unlisted=1/u,
    );
  } finally {
    await fixture.cleanup();
  }
});

test('rejects symbolic and hard links in the extracted archive', async () => {
  const fixture = await createTarball(
    {
      'dist/source.txt': 'public fixture content',
      'package.json': '{"name":"@fixture/package","version":"1.0.0"}',
    },
    {
      hardlinks: {
        'dist/hard-linked-credential': 'dist/source.txt',
      },
      symlinks: {
        'dist/linked-credential': '../../outside',
      },
    },
  );
  try {
    await assert.rejects(
      verifyReleaseArtifacts(fixture.root, fixture.packOutput),
      (error) => {
        assert.match(error.message, /archive:hard-link/u);
        assert.match(error.message, /archive:symbolic-link/u);
        return true;
      },
    );
  } finally {
    await fixture.cleanup();
  }
});
