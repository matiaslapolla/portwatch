import {readFile, stat} from 'node:fs/promises';
import {basename, dirname, join} from 'node:path';
import {parseHead} from './parse.js';

export type ProjectInfo = {
	project?: string; // package.json "name", else repo dir name
	repoRoot?: string; // dir containing .git
	branch?: string;
	worktree?: string; // label when cwd lives in a linked git worktree
};

async function exists(path: string): Promise<boolean> {
	try {
		await stat(path);
		return true;
	} catch {
		return false;
	}
}

async function readJsonName(path: string): Promise<string | undefined> {
	try {
		const pkg = JSON.parse(await readFile(path, 'utf8')) as {name?: string};
		return typeof pkg.name === 'string' ? pkg.name : undefined;
	} catch {
		return undefined;
	}
}

/**
 * Walk up from `cwd` to find the nearest git repo and package.json, then read
 * the branch from HEAD. Pure-ish: only reads the filesystem, never spawns git.
 * A linked worktree has a `.git` *file* (not dir) pointing at the real gitdir.
 */
export async function resolveProject(cwd: string): Promise<ProjectInfo> {
	const info: ProjectInfo = {};
	let pkgName: string | undefined;
	let dir = cwd;

	// Walk up to filesystem root.
	for (let depth = 0; depth < 64; depth++) {
		if (pkgName === undefined) {
			pkgName = await readJsonName(join(dir, 'package.json'));
		}

		const gitPath = join(dir, '.git');
		if (await exists(gitPath)) {
			info.repoRoot = dir;
			const isDir = await isDirectory(gitPath);
			let gitdir = gitPath;
			if (!isDir) {
				// Linked worktree: ".git" is a file "gitdir: /abs/path".
				const ref = await readGitdirPointer(gitPath);
				if (ref) {
					gitdir = ref;
					info.worktree = basename(dir);
				}
			}
			info.branch = await readBranch(gitdir);
			break;
		}

		const parent = dirname(dir);
		if (parent === dir) break;
		dir = parent;
	}

	info.project = pkgName ?? (info.repoRoot ? basename(info.repoRoot) : undefined);
	return info;
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

async function readGitdirPointer(gitFile: string): Promise<string | undefined> {
	try {
		const content = await readFile(gitFile, 'utf8');
		const m = content.match(/^gitdir:\s*(.+)$/m);
		return m?.[1]?.trim();
	} catch {
		return undefined;
	}
}

async function readBranch(gitdir: string): Promise<string | undefined> {
	try {
		return parseHead(await readFile(join(gitdir, 'HEAD'), 'utf8'));
	} catch {
		return undefined;
	}
}
