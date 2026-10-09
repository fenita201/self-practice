import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { HttpError, assertProjectName } from './paths.js';

const execFileP = promisify(execFile);

export type ProjectInfo = { name: string; mtime: number; git: boolean };

const inside = (root: string, p: string) => {
  const rel = path.relative(root, p);
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
};

/** Projects are the direct sub-directories of WORKSPACE_ROOT. */
export class Projects {
  constructor(private readonly workspaceRoot: string) {}

  async list(): Promise<ProjectInfo[]> {
    const realRoot = await realpath(this.workspaceRoot);
    const out: ProjectInfo[] = [];
    for (const d of await readdir(realRoot, { withFileTypes: true })) {
      if (d.name.startsWith('.')) continue;
      try {
        const real = await realpath(path.join(realRoot, d.name));
        if (!inside(realRoot, real)) continue;
        const s = await stat(real);
        if (!s.isDirectory()) continue;
        out.push({ name: d.name, mtime: s.mtimeMs, git: existsSync(path.join(real, '.git')) });
      } catch {
        /* skip broken entries */
      }
    }
    return out.sort((a, b) => b.mtime - a.mtime);
  }

  /** Absolute, symlink-resolved directory of a project; 404 if missing, 403 if it escapes the workspace. */
  async dir(name: string): Promise<string> {
    assertProjectName(name);
    const realRoot = await realpath(this.workspaceRoot);
    let real: string;
    try {
      real = await realpath(path.join(realRoot, name));
    } catch {
      throw new HttpError(404, `Không có project "${name}"`, 'not_found');
    }
    if (!inside(realRoot, real)) throw new HttpError(403, 'Project trỏ ra ngoài WORKSPACE_ROOT', 'outside_root');
    if (!(await stat(real)).isDirectory()) throw new HttpError(400, 'Project không phải thư mục', 'not_dir');
    return real;
  }

  async create(name: string, gitInit: boolean): Promise<ProjectInfo & { gitError?: string }> {
    assertProjectName(name);
    const realRoot = await realpath(this.workspaceRoot);
    const target = path.join(realRoot, name);
    try {
      await mkdir(target);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EEXIST') throw new HttpError(409, `Project "${name}" đã tồn tại`, 'exists');
      throw e;
    }
    let gitError: string | undefined;
    if (gitInit) {
      try {
        await execFileP('git', ['init', '--quiet'], { cwd: target, timeout: 15_000 });
      } catch (e) {
        gitError = `Đã tạo thư mục nhưng git init lỗi: ${(e as Error).message}`;
      }
    }
    const s = await stat(target);
    return { name, mtime: s.mtimeMs, git: existsSync(path.join(target, '.git')), ...(gitError ? { gitError } : {}) };
  }
}
