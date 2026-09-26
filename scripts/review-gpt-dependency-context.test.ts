import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { link, mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { onTestFinished, test } from 'vitest';
import { gzipSync } from 'node:zlib';
import { addReviewGptDependencyContext, readReviewGptRegistryInput } from './review-gpt-dependency-context.mjs';

const version = '0.5.147';
const patchPath = `patches/@cobuild__review-gpt@${version}.patch`;
const committedPatch = 'synthetic committed patch\n';
const integrity = (bytes: Buffer) => `sha512-${createHash('sha512').update(bytes).digest('base64')}`;
const lockfile = (archive: Buffer, selectedVersion = version) => `lockfileVersion: '9.0'
patchedDependencies:
  '@cobuild/review-gpt@${selectedVersion}':
    hash: ${createHash('sha256').update(committedPatch).digest('hex')}
    path: patches/@cobuild__review-gpt@${selectedVersion}.patch
packages:
  '@cobuild/review-gpt@${selectedVersion}':
    resolution: {integrity: ${integrity(archive)}}
snapshots:
  '@cobuild/review-gpt@${selectedVersion}': {}
`;

async function fixture(kind = 'safe') {
  const root = await mkdtemp(path.join(tmpdir(), 'murph-review-dependency-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  const source = path.join(root, 'source');
  const contextDir = path.join(root, 'invocation', 'review-gpt-pr-context');
  await mkdir(path.join(source, 'package', 'src'), { recursive: true });
  await mkdir(path.join(repoRoot, 'patches'), { recursive: true });
  await mkdir(contextDir, { recursive: true });
  await writeFile(path.join(source, 'package/package.json'), JSON.stringify({ name: '@cobuild/review-gpt', version }));
  await writeFile(path.join(source, 'package/src/example.js'), 'export const exactSource = true;\n');
  const names = ['package/package.json', 'package/src/example.js'];
  if (kind === 'symlink') {
    await symlink('../package.json', path.join(source, 'package/src/link'));
    names.push('package/src/link');
  }
  if (kind === 'private') {
    await writeFile(path.join(source, 'package/.env'), 'SYNTHETIC=value\n');
    names.push('package/.env');
  }
  if (kind === 'hardlink') {
    await link(path.join(source, 'package/package.json'), path.join(source, 'package/src/hard-link'));
    names.push('package/src/hard-link');
  }
  const tarPath = path.join(root, 'fixture.tar');
  execFileSync('tar', ['-cf', tarPath, '-C', source, ...names]);
  if (kind === 'duplicate') execFileSync('tar', ['-rf', tarPath, '-C', source, names[0]]);
  const tarBytes = await readFile(tarPath);
  if (kind === 'traversal') {
    tarBytes.fill(0, 0, 100);
    tarBytes.write('../outside', 0);
    tarBytes.fill(32, 148, 156);
    const checksum = tarBytes.subarray(0, 512).reduce((sum, byte) => sum + byte, 0);
    tarBytes.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148);
  }
  let archive = gzipSync(tarBytes);
  if (kind === 'expanded-limit') archive = gzipSync(Buffer.alloc(4 * 1024 * 1024 + 1));
  if (kind === 'compressed-limit') archive = randomBytes(2 * 1024 * 1024 + 1);
  await writeFile(path.join(repoRoot, 'pnpm-lock.yaml'), lockfile(archive));
  await writeFile(path.join(repoRoot, patchPath), committedPatch);
  const git = (args: string[]) => execFileSync('git', args, { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  git(['init', '-q']);
  git(['config', 'user.name', 'Synthetic Fixture']);
  git(['config', 'user.email', 'fixture@example.invalid']);
  git(['add', '.']);
  git(['commit', '-qm', 'Synthetic dependency fixture']);
  const head = git(['rev-parse', 'HEAD']);
  const requests: Array<{ url: string; options: RequestInit }> = [];
  const fetchImpl = async (url: string, options: RequestInit) => {
    requests.push({ url, options });
    return new Response(archive);
  };
  return { root, repoRoot, contextDir, head, archive, requests, fetchImpl, changedFiles: `${patchPath}\n` };
}

test('uses the reviewed lock and patch, then exposes every registry file in the guarded ZIP namespace', async () => {
  const input = await fixture();
  // Dirty installed/local source must never replace committed authority.
  await writeFile(path.join(input.repoRoot, patchPath), 'unreviewed local patch');
  await writeFile(path.join(input.repoRoot, 'pnpm-lock.yaml'), 'unreviewed lock');
  assert.equal(await addReviewGptDependencyContext(input), true);
  assert.equal(input.requests.length, 1);
  assert.equal(input.requests[0].url, 'https://registry.npmjs.org/@cobuild/review-gpt/-/review-gpt-0.5.147.tgz');
  assert.equal(input.requests[0].options.redirect, 'error');
  assert.equal(input.requests[0].options.credentials, 'omit');
  assert.ok(input.requests[0].options.signal instanceof AbortSignal);
  const base = `review-gpt-pr-context/dependencies/review-gpt-${version}`;
  const zipPath = path.join(input.root, 'guarded.zip');
  // Exercise the existing packager's context append mechanism on a guarded base ZIP.
  await writeFile(path.join(input.root, 'invocation', 'tracked.txt'), 'safe tracked source\n');
  const cwd = path.dirname(input.contextDir);
  execFileSync('zip', ['-q', zipPath, 'tracked.txt'], { cwd });
  execFileSync('zip', ['-qr', zipPath, 'review-gpt-pr-context'], { cwd });
  const entries = execFileSync('unzip', ['-Z1', zipPath], { encoding: 'utf8' });
  assert.ok(entries.includes(`${base}/package/src/example.js`));
  assert.ok(!entries.includes('.tgz') && !entries.includes('.tar'));
  assert.equal(execFileSync('unzip', ['-p', zipPath, `${base}/package/src/example.js`], { encoding: 'utf8' }), 'export const exactSource = true;\n');
  assert.equal(execFileSync('unzip', ['-p', zipPath, `${base}/murph.patch`], { encoding: 'utf8' }), 'synthetic committed patch\n');
  const proof = JSON.parse(execFileSync('unzip', ['-p', zipPath, `${base}/provenance.json`], { encoding: 'utf8' }));
  assert.equal(proof.reviewedHead, input.head);
  assert.equal(proof.integrity, integrity(input.archive));
  assert.equal(proof.files.length, 2);
  for (const file of proof.files) {
    const bytes = execFileSync('unzip', ['-p', zipPath, `${base}/${file.path}`]);
    assert.equal(bytes.length, file.bytes);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256);
  }
});

test('unrelated PRs do not read Git or access the network', async () => {
  assert.equal(await addReviewGptDependencyContext({
    head: 'unused', changedFiles: 'scripts/unrelated.mjs\n', repoRoot: '/nonexistent', contextDir: '/nonexistent',
    fetchImpl: () => { throw new Error('Unexpected network request'); },
  }), false);
});

test('rejects registry integrity mismatch before creating review context', async () => {
  const input = await fixture();
  await assert.rejects(addReviewGptDependencyContext({ ...input, fetchImpl: async () => new Response('different bytes') }), /lockfile integrity/);
  await assert.rejects(readFile(path.join(input.contextDir, 'dependencies/review-gpt-0.5.147/provenance.json')), { code: 'ENOENT' });
});

for (const kind of ['symlink', 'hardlink', 'duplicate', 'traversal', 'private', 'compressed-limit', 'expanded-limit']) {
  test(`rejects ${kind} registry content without publishing context`, async () => {
    const input = await fixture(kind);
    await assert.rejects(addReviewGptDependencyContext(input));
    await assert.rejects(readFile(path.join(input.contextDir, 'dependencies/review-gpt-0.5.147/provenance.json')), { code: 'ENOENT' });
  });
}

test('strict lock selection rejects ambiguous, malformed, or redirected resolutions and supports the next exact version', () => {
  const bytes = Buffer.from('synthetic registry bytes');
  const valid = lockfile(bytes);
  assert.equal(readReviewGptRegistryInput(valid).integrity, integrity(bytes));
  assert.equal(readReviewGptRegistryInput(lockfile(bytes, '0.5.148')).patchPath, 'patches/@cobuild__review-gpt@0.5.148.patch');
  for (const invalid of [
    valid.replace('packages:\n', "packages:\n  '@cobuild/review-gpt@0.5.147':\n    resolution: {}\n"),
    valid.replace('sha512-', 'sha256-'),
    valid.replace(`integrity: ${integrity(bytes)}`, `integrity: ${integrity(bytes)}, tarball: https://example.invalid/package.tgz`),
    valid.replace(`path: ${patchPath}`, 'path: ../../outside.patch'),
    valid.replaceAll('0.5.147', 'latest'),
  ]) assert.throws(() => readReviewGptRegistryInput(invalid), /Review dependency /);
});
