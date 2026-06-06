import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveProject} from './project.js';

async function scratch(): Promise<string> {
	return mkdtemp(join(tmpdir(), 'pw-proj-'));
}

test('resolveProject finds package name, repo root and branch', async () => {
	const root = await scratch();
	try {
		await writeFile(join(root, 'package.json'), JSON.stringify({name: 'my-app'}));
		await mkdir(join(root, '.git'), {recursive: true});
		await writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
		const sub = join(root, 'src', 'deep');
		await mkdir(sub, {recursive: true});

		const info = await resolveProject(sub);
		assert.equal(info.project, 'my-app');
		assert.equal(info.repoRoot, root);
		assert.equal(info.branch, 'main');
		assert.equal(info.worktree, undefined);
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('resolveProject detects a linked git worktree', async () => {
	const root = await scratch();
	try {
		// Simulate a linked worktree: ".git" is a FILE pointing at the real gitdir.
		const gitdir = join(root, 'realgit');
		await mkdir(gitdir, {recursive: true});
		await writeFile(join(gitdir, 'HEAD'), 'ref: refs/heads/feature-x\n');

		const wt = join(root, 'feature-x');
		await mkdir(wt, {recursive: true});
		await writeFile(join(wt, '.git'), `gitdir: ${gitdir}\n`);
		await writeFile(join(wt, 'package.json'), JSON.stringify({name: 'my-app'}));

		const info = await resolveProject(wt);
		assert.equal(info.project, 'my-app');
		assert.equal(info.branch, 'feature-x');
		assert.equal(info.worktree, 'feature-x');
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});

test('resolveProject falls back to repo dir name without package.json', async () => {
	const root = await scratch();
	try {
		await mkdir(join(root, '.git'), {recursive: true});
		await writeFile(join(root, '.git', 'HEAD'), 'ref: refs/heads/main\n');
		const info = await resolveProject(root);
		assert.equal(info.project, root.split('/').pop());
	} finally {
		await rm(root, {recursive: true, force: true});
	}
});
