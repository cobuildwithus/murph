import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { link, mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import {
  contentRuleIds,
  sensitiveFilenameRule,
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
      'export type ProviderCredential = "provider_config" | "none";',
    ].join('\n'),
    'package.json': '{"name":"@fixture/package","version":"1.0.0"}',
  });
  try {
    await verifyReleaseArtifacts(fixture.root, fixture.packOutput);
  } finally {
    await fixture.cleanup();
  }
});

test('allows only the generated public Health Commons knowledge index', () => {
  assert.equal(
    sensitiveFilenameRule(
      'package/node_modules/@murphai/health-commons/generated/knowledge.sqlite',
    ),
    null,
  );
  assert.equal(
    sensitiveFilenameRule(
      'package/node_modules/@murphai/health-commons/generated/private.sqlite',
    ),
    'sensitive-filename:data-store',
  );
  assert.equal(
    sensitiveFilenameRule('package/generated/knowledge.sqlite'),
    'sensitive-filename:data-store',
  );
  assert.equal(
    sensitiveFilenameRule(
      'package/node_modules/@murphai/health-commons/generated/KNOWLEDGE.SQLITE',
    ),
    'sensitive-filename:data-store',
  );
  assert.equal(
    sensitiveFilenameRule(
      'package/node_modules/@murphai/health-commons/generated/knowledge.sqlite.bak',
    ),
    'sensitive-filename:data-store',
  );
  assert.equal(
    sensitiveFilenameRule(
      'package/node_modules/@murphai/other/generated/knowledge.sqlite',
    ),
    'sensitive-filename:data-store',
  );
});

test('detects quoted and unquoted generic secret assignments', () => {
  const secret = ['uY7nQ2pL9vR4', 'xT8mW3cD6fH1'].join('');
  for (const assignment of [
    `{"CLOUDFLARE_API_TOKEN":"${secret}"}`,
    `CLOUDFLARE_API_TOKEN=${secret}`,
    `export AUTH_TOKEN=${secret}`,
    `MAPBOX_ACCESS_TOKEN=${secret} vault-cli route estimate`,
    `export AUTH_TOKEN=${secret} && deploy-release`,
    `AUTH_TOKEN="${secret}" command`,
    `AUTH_TOKEN=${secret} || exit 1`,
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

test('rejects shell assignment suffixes through the complete tarball boundary', async () => {
  const credential = ['uY7nQ2pL9vR4', 'xT8mW3cD6fH1'].join('');
  for (const assignment of [
    `MAPBOX_ACCESS_TOKEN=${credential} vault-cli route estimate`,
    `export AUTH_TOKEN=${credential} && deploy-release`,
    `AUTH_TOKEN="${credential}" command`,
    `AUTH_TOKEN=${credential} || exit 1`,
    `export AUTH_TOKEN=${credential};`,
    `AUTH_TOKEN=${credential} # production`,
  ]) {
    const fixture = await createTarball({
      'README.md': assignment,
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
  }
});

test('scans every shipped file without archive-path exceptions', async () => {
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

test('scans equals assignments in declaration files but permits colon type fields', async () => {
  const credential = ['uY7nQ2pL9vR4', 'xT8mW3cD6fH1'].join('');
  const fixture = await createTarball({
    'dist/index.d.ts': [
      'export interface CredentialShape {',
      '  API_TOKEN: string;',
      '}',
      `API_TOKEN=${credential}`,
    ].join('\n'),
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

test('detects standard authorization, parameter, and camel-case credential forms', async () => {
  const credential = ['uY7nQ2pL9vR4', 'xT8mW3cD6fH1'].join('');
  const basicCredential = ['c2VydmljZTp', 'wYXNzd29yZA=='].join('');
  const shortBasicCredential = 'YTpi';
  const cases = [
    `{"Authorization":"Bearer ${credential}"}`,
    `headers["Authorization"] = "Bearer ${credential}"`,
    `headers.set("Authorization", "Bearer ${credential}")`,
    `new Headers([["Authorization", "Basic ${basicCredential}"]])`,
    `https://provider.example/revoke?access_token=${credential}`,
    `https://provider.example/token?client_secret=${credential}`,
    `refresh_token=${credential}&grant_type=refresh_token`,
    `const controlToken = "${credential}";`,
    `const webhookSecret = "${credential}";`,
    `config["signingSecret"] = "${credential}";`,
    `const databasePassword = "${credential}";`,
    `const providerSecretValue = "${credential}";`,
    `const providerCredential = "${credential}";`,
    `const storedCredential = "${credential}";`,
    `const authorizationHeader = "Bearer ${credential}";`,
    `const authHeader = "Basic ${credential}";`,
    `const lowerHeader = "authorization: bearer ${credential}";`,
    `const mixedHeader = "Authorization: bAsIc ${basicCredential}";`,
    `url.searchParams.set("access_token", "${credential}");`,
    `form.append("client_secret", "${credential}");`,
    `const apikey = "${credential}";`,
    `const clientsecret = "${credential}";`,
    `const compactBasic = "Basic ${shortBasicCredential}";`,
    `const formFields = [["refresh_token", "${credential}"]];`,
    `HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON="${credential}"`,
    `HOSTED_APP_SESSION_HMAC_KEY="${credential}"`,
    `HOSTED_MAILBOX_FINGERPRINT_KEY="${credential}"`,
    `HOSTED_EXECUTION_CONTROL_TOKENS="${credential}"`,
    `const hmacKey = "${credential}";`,
    `const encryptionKey = "${credential}";`,
    `const routingIndexKey = "${credential}";`,
    `const privateJwkJson = "${credential}";`,
    `const contactPrivacyKeys = "${credential}";`,
    `const keyMaterial = "${credential}";`,
    `const rootKey = "${credential}";`,
  ];
  for (const text of cases) {
    assert.ok(
      contentRuleIds(text).some((ruleId) =>
        [
          'credential:authorization-header',
          'credential:generic-assignment',
          'credential:parameter',
          'credential:url-query',
        ].includes(ruleId)),
      `expected credential rule for ${text.replaceAll(credential, '<synthetic>')}`,
    );
  }

  for (const text of [
    'headers.set("Authorization", `Bearer ${ACCESS_TOKEN}`)',
    'const controlToken = process.env.CONTROL_TOKEN;',
    'refresh_token=${REFRESH_TOKEN}&grant_type=refresh_token',
    'const providerSecretValue = process.env.PROVIDER_SECRET_VALUE;',
    'const providerCredential = process.env.PROVIDER_CREDENTIAL;',
    'const storedCredential = `${STORED_CREDENTIAL}`;',
    'const authorizationHeader = `Bearer ${ACCESS_TOKEN}`;',
    'const lowerHeader = "authorization: bearer ${ACCESS_TOKEN}";',
    'const mixedHeader = "Authorization: bAsIc ${BASIC_CREDENTIAL}";',
    'url.searchParams.set("access_token", "${ACCESS_TOKEN}");',
    'form.append("client_secret", "placeholder");',
    'headers.set("WWW-Authenticate", \'Basic realm="private"\');',
    'headers.set("WWW-Authenticate", \'Bearer realm="device-sync"\');',
    'const HOSTED_XAI_SEARCH_ENV_NAMES = ["XAI_API_KEY", "XAI_X_SEARCH_MODEL"];',
    'const fixture = { testName: "Basic metabolic panel" };',
    'const source = { title: "Basic Return to Running Guideline" };',
    'const headings = ["Key", "Value"];',
    'const prose = "basic care and bearer token handling";',
    'HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON=${HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON}',
    'HOSTED_APP_SESSION_HMAC_KEY=${HOSTED_APP_SESSION_HMAC_KEY}',
    'HOSTED_EXECUTION_CONTROL_TOKENS=${HOSTED_EXECUTION_CONTROL_TOKENS}',
    'const hmacKey = process.env.HOSTED_APP_SESSION_HMAC_KEY;',
    'const privateJwkJson = `${HOSTED_WEB_CALLBACK_SIGNING_PRIVATE_JWK}`;',
    'const contactPrivacyKeys = process.env.HOSTED_CONTACT_PRIVACY_KEYS;',
    'const rootKey = "vault";',
    'const rootKeyId = "runtime-v1";',
  ]) {
    assert.equal(
      contentRuleIds(text).some((ruleId) =>
        [
          'credential:authorization-header',
          'credential:generic-assignment',
          'credential:parameter',
          'credential:url-query',
        ].includes(ruleId)),
      false,
      `expected credential reference or challenge to pass for ${text}`,
    );
  }

  const fixture = await createTarball({
    'dist/auth.js': [
      `const jsonHeader = {"Authorization":"Bearer ${credential}"};`,
      `headers["Authorization"] = "Bearer ${credential}";`,
      `headers.set("Authorization", "Bearer ${credential}");`,
      `const tupleHeaders = new Headers([["Authorization", "Basic ${basicCredential}"]]);`,
      `const revokeUrl = "https://provider.example/revoke?access_token=${credential}";`,
      `const exchangeUrl = "https://provider.example/token?client_secret=${credential}";`,
      `const refreshBody = "refresh_token=${credential}&grant_type=refresh_token";`,
      `const controlToken = "${credential}";`,
      `const webhookSecret = "${credential}";`,
      `const providerSecretValue = "${credential}";`,
      `const providerCredential = "${credential}";`,
      `const storedCredential = "${credential}";`,
      `const authorizationHeader = "Bearer ${credential}";`,
      `const authHeader = "Basic ${credential}";`,
      `const lowerHeader = "authorization: bearer ${credential}";`,
      `const mixedHeader = "Authorization: bAsIc ${basicCredential}";`,
      `url.searchParams.set("access_token", "${credential}");`,
      `form.append("client_secret", "${credential}");`,
      `const apikey = "${credential}";`,
      `const clientsecret = "${credential}";`,
      `const compactBasic = "Basic ${shortBasicCredential}";`,
      `const formFields = [["refresh_token", "${credential}"]];`,
      `HOSTED_RUNTIME_CODEX_CHATGPT_AUTH_JSON="${credential}"`,
      `HOSTED_APP_SESSION_HMAC_KEY="${credential}"`,
      `HOSTED_MAILBOX_FINGERPRINT_KEY="${credential}"`,
      `HOSTED_EXECUTION_CONTROL_TOKENS="${credential}"`,
      `const hmacKey = "${credential}";`,
      `const encryptionKey = "${credential}";`,
      `const routingIndexKey = "${credential}";`,
      `const privateJwkJson = "${credential}";`,
      `const contactPrivacyKeys = "${credential}";`,
      `const keyMaterial = "${credential}";`,
      `const rootKey = "${credential}";`,
    ].join('\n'),
    'package.json': '{"name":"@fixture/package","version":"1.0.0"}',
  });
  try {
    await assert.rejects(
      verifyReleaseArtifacts(fixture.root, fixture.packOutput),
      (error) => {
        assert.match(error.message, /credential:authorization-header/u);
        assert.match(error.message, /credential:url-query/u);
        assert.match(error.message, /credential:generic-assignment/u);
        assert.match(error.message, /credential:parameter/u);
        assert.equal(error.message.includes(credential), false);
        return true;
      },
    );
  } finally {
    await fixture.cleanup();
  }
});

test('classifies encoded private-key holders without classifying certificates', () => {
  const encodedPrivateKey = Buffer.from(
    'synthetic Temporal client private key material',
  ).toString('base64');
  const encodedCertificate = Buffer.from(
    'synthetic public Temporal client certificate',
  ).toString('base64');
  const escapedPem = [
    '-----BEGIN PRIVATE KEY-----',
    'QWxwaGFCZXRhR2FtbWFEZWx0YUVwc2lsb25aZXRhRXRhVGhldGE=',
    '-----END PRIVATE KEY-----',
  ].join('\\n');

  for (const assignment of [
    `HOSTED_TEMPORAL_CLIENT_KEY_BASE64="${encodedPrivateKey}"`,
    `TEMPORAL_CLIENT_KEY_BASE64="${encodedPrivateKey}"`,
    `HOSTED_TEMPORAL_CLIENT_KEY_PEM="${escapedPem}"`,
    `TEMPORAL_CLIENT_KEY_PEM="${escapedPem}"`,
  ]) {
    assert.ok(
      contentRuleIds(assignment).includes('credential:generic-assignment'),
      `expected encoded private-key holder to fail for ${assignment.split('=', 1)[0]}`,
    );
  }

  for (const assignment of [
    'HOSTED_TEMPORAL_CLIENT_KEY_BASE64=${HOSTED_TEMPORAL_CLIENT_KEY_BASE64}',
    'TEMPORAL_CLIENT_KEY_BASE64=process.env.TEMPORAL_CLIENT_KEY_BASE64',
    `HOSTED_TEMPORAL_CLIENT_CERT_BASE64="${encodedCertificate}"`,
    `TEMPORAL_CLIENT_CERT_PEM="${encodedCertificate}"`,
  ]) {
    assert.equal(
      contentRuleIds(assignment).includes('credential:generic-assignment'),
      false,
      `expected reference or public certificate to pass for ${assignment.split('=', 1)[0]}`,
    );
  }
});

test('enforces encoded private-key holders through the complete tarball boundary', async () => {
  const encodedPrivateKey = Buffer.from(
    'synthetic Temporal client private key material',
  ).toString('base64');
  const encodedCertificate = Buffer.from(
    'synthetic public Temporal client certificate',
  ).toString('base64');
  const escapedPem = [
    '-----BEGIN PRIVATE KEY-----',
    'QWxwaGFCZXRhR2FtbWFEZWx0YUVwc2lsb25aZXRhRXRhVGhldGE=',
    '-----END PRIVATE KEY-----',
  ].join('\\n');

  for (const assignment of [
    `HOSTED_TEMPORAL_CLIENT_KEY_BASE64="${encodedPrivateKey}"`,
    `TEMPORAL_CLIENT_KEY_BASE64="${encodedPrivateKey}"`,
    `HOSTED_TEMPORAL_CLIENT_KEY_PEM="${escapedPem}"`,
    `TEMPORAL_CLIENT_KEY_PEM="${escapedPem}"`,
  ]) {
    const fixture = await createTarball({
      'dist/temporal-env.js': assignment,
      'package.json': '{"name":"@fixture/package","version":"1.0.0"}',
    });
    try {
      await assert.rejects(
        verifyReleaseArtifacts(fixture.root, fixture.packOutput),
        /credential:generic-assignment/u,
      );
    } finally {
      await fixture.cleanup();
    }
  }

  const publicFixture = await createTarball({
    'dist/temporal-env.js': [
      'HOSTED_TEMPORAL_CLIENT_KEY_BASE64=${HOSTED_TEMPORAL_CLIENT_KEY_BASE64}',
      'TEMPORAL_CLIENT_KEY_BASE64=process.env.TEMPORAL_CLIENT_KEY_BASE64',
      `HOSTED_TEMPORAL_CLIENT_CERT_BASE64="${encodedCertificate}"`,
      `TEMPORAL_CLIENT_CERT_PEM="${encodedCertificate}"`,
    ].join('\n'),
    'package.json': '{"name":"@fixture/package","version":"1.0.0"}',
  });
  try {
    await verifyReleaseArtifacts(publicFixture.root, publicFixture.packOutput);
  } finally {
    await publicFixture.cleanup();
  }
});

test('detects serialized credential headers while allowing public forms', () => {
  const credential = ['uY7nQ2pL9vR4', 'xT8mW3cD6fH1'].join('');
  for (const header of [
    `const headerLine = "X-API-Key: ${credential}";`,
    `curl -H "X-API-Key: ${credential}" https://provider.example/v1`,
    `const cookieLine = "Cookie: session=${credential}";`,
  ]) {
    assert.ok(
      contentRuleIds(header).includes('credential:serialized-header'),
      'expected serialized credential header to fail',
    );
  }

  for (const header of [
    'const headerLine = `X-API-Key: ${EXA_API_KEY}`;',
    'curl -H "X-API-Key: placeholder" https://provider.example/v1',
    'const authorizationLine = "Authorization: Bearer <token>";',
    'const cookieLine = `Cookie: ${COOKIE_HEADER}`;',
    'const prose = "The X-API-Key header is required.";',
    'const headerName = "X-API-Key";',
  ]) {
    assert.equal(
      contentRuleIds(header).includes('credential:serialized-header'),
      false,
      'expected serialized header reference, placeholder, or prose to pass',
    );
  }
});

test('enforces serialized credential headers through the complete tarball boundary', async () => {
  const credential = ['uY7nQ2pL9vR4', 'xT8mW3cD6fH1'].join('');
  for (const header of [
    `const headerLine = "X-API-Key: ${credential}";`,
    `curl -H "X-API-Key: ${credential}" https://provider.example/v1`,
    `const cookieLine = "Cookie: session=${credential}";`,
  ]) {
    const fixture = await createTarball({
      'README.md': header,
      'package.json': '{"name":"@fixture/package","version":"1.0.0"}',
    });
    try {
      await assert.rejects(
        verifyReleaseArtifacts(fixture.root, fixture.packOutput),
        /credential:serialized-header/u,
      );
    } finally {
      await fixture.cleanup();
    }
  }

  const publicFixture = await createTarball({
    'README.md': [
      'const headerLine = `X-API-Key: ${EXA_API_KEY}`;',
      'curl -H "X-API-Key: placeholder" https://provider.example/v1',
      'const authorizationLine = "Authorization: Bearer <token>";',
      'const cookieLine = `Cookie: ${COOKIE_HEADER}`;',
      'The X-API-Key header is required.',
    ].join('\n'),
    'package.json': '{"name":"@fixture/package","version":"1.0.0"}',
  });
  try {
    await verifyReleaseArtifacts(publicFixture.root, publicFixture.packOutput);
  } finally {
    await publicFixture.cleanup();
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
