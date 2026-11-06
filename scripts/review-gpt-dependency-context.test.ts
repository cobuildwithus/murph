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
const lockfile = (archive: Buffer, selectedVersion = version, packageSlug = 'review-gpt', patch = committedPatch) => `lockfileVersion: '9.0'
patchedDependencies:
  '@cobuild/${packageSlug}@${selectedVersion}':
    hash: ${createHash('sha256').update(patch).digest('hex')}
    path: patches/@cobuild__${packageSlug}@${selectedVersion}.patch
packages:
  '@cobuild/${packageSlug}@${selectedVersion}':
    resolution: {integrity: ${integrity(archive)}}
snapshots:
  '@cobuild/${packageSlug}@${selectedVersion}': {}
`;

async function fixture(kind = 'safe', packageSlug = 'review-gpt', selectedVersion = version) {
  const selectedPatchPath = `patches/@cobuild__${packageSlug}@${selectedVersion}.patch`;
  const root = await mkdtemp(path.join(tmpdir(), 'murph-review-dependency-'));
  onTestFinished(() => rm(root, { recursive: true, force: true }));
  const repoRoot = path.join(root, 'repo');
  const source = path.join(root, 'source');
  const contextDir = path.join(root, 'invocation', 'review-gpt-pr-context');
  await mkdir(path.join(source, 'package', 'src'), { recursive: true });
  await mkdir(path.join(repoRoot, 'patches'), { recursive: true });
  await mkdir(contextDir, { recursive: true });
  await writeFile(path.join(source, 'package/package.json'), JSON.stringify({ name: `@cobuild/${packageSlug}`, version: selectedVersion }));
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
  await writeFile(path.join(repoRoot, 'pnpm-lock.yaml'), lockfile(archive, selectedVersion, packageSlug));
  await writeFile(path.join(repoRoot, selectedPatchPath), committedPatch);
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
  return { root, source, repoRoot, contextDir, head, archive, requests, fetchImpl, changedFiles: `${selectedPatchPath}\n` };
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


test('packages committed head and base repo-tools source for a versioned patch upgrade', async () => {
  const input = await fixture('safe', 'repo-tools', '0.1.17');
  const baseHead = input.head;
  const nextPatch = 'synthetic next patch\n';
  const nextPatchPath = 'patches/@cobuild__repo-tools@0.1.18.patch';
  await writeFile(path.join(input.source, 'package/package.json'), JSON.stringify({ name: '@cobuild/repo-tools', version: '0.1.18' }));
  await writeFile(path.join(input.source, 'package/src/example.js'), 'export const nextSource = true;\n');
  const nextTar = path.join(input.root, 'next.tar');
  execFileSync('tar', ['-cf', nextTar, '-C', input.source, 'package/package.json', 'package/src/example.js']);
  const nextArchive = gzipSync(await readFile(nextTar));
  await writeFile(path.join(input.repoRoot, 'pnpm-lock.yaml'), lockfile(nextArchive, '0.1.18', 'repo-tools', nextPatch));
  await writeFile(path.join(input.repoRoot, nextPatchPath), nextPatch);
  const git = (args: string[]) => execFileSync('git', args, { cwd: input.repoRoot, encoding: 'utf8' }).trim();
  git(['add', '.']);
  git(['commit', '-qm', 'Synthetic package upgrade']);
  const head = git(['rev-parse', 'HEAD']);
  // Both versions and patches come from commits, not the dirty working copy.
  await writeFile(path.join(input.repoRoot, 'pnpm-lock.yaml'), 'unreviewed lock');
  await writeFile(path.join(input.repoRoot, nextPatchPath), 'unreviewed patch');
  const urls: string[] = [];
  assert.equal(await addReviewGptDependencyContext({
    ...input, head, baseHead, changedFiles: `${nextPatchPath}\n${input.changedFiles}`,
    fetchImpl: async (url) => {
      urls.push(url);
      return new Response(url.endsWith('repo-tools-0.1.18.tgz') ? nextArchive : input.archive);
    },
  }), true);
  assert.deepEqual(urls, [
    'https://registry.npmjs.org/@cobuild/repo-tools/-/repo-tools-0.1.18.tgz',
    'https://registry.npmjs.org/@cobuild/repo-tools/-/repo-tools-0.1.17.tgz',
  ]);
  for (const [directory, sourceHead, patch, sourceText, role] of [
    ['repo-tools-0.1.18', head, nextPatch, 'export const nextSource = true;\n', 'head'],
    ['base/repo-tools-0.1.17', baseHead, committedPatch, 'export const exactSource = true;\n', 'base'],
  ]) {
    const destination = path.join(input.contextDir, 'dependencies', directory);
    assert.equal(await readFile(path.join(destination, 'package/src/example.js'), 'utf8'), sourceText);
    assert.equal(await readFile(path.join(destination, 'murph.patch'), 'utf8'), patch);
    const proof = JSON.parse(await readFile(path.join(destination, 'provenance.json'), 'utf8'));
    assert.equal(proof.reviewedHead, head);
    assert.equal(proof.sourceHead, sourceHead);
    assert.equal(proof.role, role);
    assert.equal(proof.patchSha256, createHash('sha256').update(patch).digest('hex'));
  }
});

for (const kind of ['symlink', 'hardlink', 'duplicate', 'traversal', 'private', 'compressed-limit', 'expanded-limit']) {
  test(`rejects ${kind} repo-tools registry content`, async () => {
    const input = await fixture(kind, 'repo-tools', '0.1.18');
    await assert.rejects(addReviewGptDependencyContext(input));
    await assert.rejects(readFile(path.join(input.contextDir, 'dependencies/repo-tools-0.1.18/provenance.json')), { code: 'ENOENT' });
  });
}

test('rejects an incorrect repo-tools package identity and integrity', async () => {
  const input = await fixture('safe', 'repo-tools', '0.1.18');
  await assert.rejects(addReviewGptDependencyContext({ ...input, fetchImpl: async () => new Response('incorrect bytes') }), /lockfile integrity/);
  const other = await fixture();
  await writeFile(path.join(input.repoRoot, 'pnpm-lock.yaml'), lockfile(other.archive, '0.1.18', 'repo-tools'));
  execFileSync('git', ['add', '.'], { cwd: input.repoRoot });
  execFileSync('git', ['commit', '-qm', 'Synthetic wrong package'], { cwd: input.repoRoot });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: input.repoRoot, encoding: 'utf8' }).trim();
  await assert.rejects(addReviewGptDependencyContext({ ...input, head, fetchImpl: async () => new Response(other.archive) }), /wrong package identity/);
});

test('only the two supported patched packages can select registry context', async () => {
  assert.throws(() => Reflect.apply(readReviewGptRegistryInput, undefined, [lockfile(Buffer.from('fixture')), '../outside']), /not supported/);
  assert.equal(await addReviewGptDependencyContext({
    head: 'unused', changedFiles: 'patches/@cobuild__other@0.1.18.patch\n', repoRoot: '/nonexistent', contextDir: '/nonexistent',
    fetchImpl: () => { throw new Error('Unexpected network request'); },
  }), false);
});


test('packages both supported dependencies and their base contexts without path collisions', async () => {
  const review = await fixture();
  const tools = await fixture('safe', 'repo-tools', '0.1.18');
  const toolsPatchPath = 'patches/@cobuild__repo-tools@0.1.18.patch';
  const patchHash = createHash('sha256').update(committedPatch).digest('hex');
  await writeFile(path.join(review.repoRoot, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'
patchedDependencies:
  '@cobuild/review-gpt@${version}':
    hash: ${patchHash}
    path: ${patchPath}
  '@cobuild/repo-tools@0.1.18':
    hash: ${patchHash}
    path: ${toolsPatchPath}
packages:
  '@cobuild/review-gpt@${version}':
    resolution: {integrity: ${integrity(review.archive)}}
  '@cobuild/repo-tools@0.1.18':
    resolution: {integrity: ${integrity(tools.archive)}}
snapshots:
`);
  await writeFile(path.join(review.repoRoot, toolsPatchPath), committedPatch);
  execFileSync('git', ['add', '.'], { cwd: review.repoRoot });
  execFileSync('git', ['commit', '-qm', 'Synthetic two-package fixture'], { cwd: review.repoRoot });
  const head = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: review.repoRoot, encoding: 'utf8' }).trim();
  const requests: string[] = [];
  assert.equal(await addReviewGptDependencyContext({
    ...review, head, baseHead: head, changedFiles: `${patchPath}\n${toolsPatchPath}\n`,
    fetchImpl: async (url) => {
      requests.push(url);
      return new Response(url.includes('/repo-tools/') ? tools.archive : review.archive);
    },
  }), true);
  assert.equal(requests.length, 4);
  for (const relative of [`review-gpt-${version}`, `base/review-gpt-${version}`, 'repo-tools-0.1.18', 'base/repo-tools-0.1.18']) {
    const proof = JSON.parse(await readFile(path.join(review.contextDir, 'dependencies', relative, 'provenance.json'), 'utf8'));
    assert.equal(proof.sourceHead, head);
    assert.equal(proof.files.length, 2);
  }
});

test('base dependency integrity and exact base SHA remain mandatory when requested', async () => {
  const input = await fixture('safe', 'repo-tools', '0.1.18');
  await assert.rejects(addReviewGptDependencyContext({ ...input, baseHead: 'main' }), /exact reviewed head and base/);
  let count = 0;
  await assert.rejects(addReviewGptDependencyContext({
    ...input, baseHead: input.head,
    fetchImpl: async () => new Response(++count === 1 ? input.archive : 'incorrect base bytes'),
  }), /lockfile integrity/);
  assert.equal(count, 2);
  await assert.rejects(readFile(path.join(input.contextDir, 'dependencies/base/repo-tools-0.1.18/provenance.json')), { code: 'ENOENT' });
});
