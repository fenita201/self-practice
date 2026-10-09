import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
  }
}

const PROJECT_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function assertProjectName(name: string): void {
  if (!PROJECT_NAME.test(name) || name.includes('..')) {
    throw new HttpError(400, 'Tên project chỉ gồm chữ, số, ".", "_", "-" và không bắt đầu bằng dấu chấm', 'bad_name');
  }
}

const isInside = (root: string, target: string) => {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
};

/** Normalise a browser-supplied relative path ("", "src/a.ts", "./x") to posix form without leading slash. */
export function normalizeRel(rel: string | undefined): string {
  const raw = (rel ?? '').replace(/\\/g, '/');
  if (raw.includes('\0')) throw new HttpError(400, 'Đường dẫn không hợp lệ', 'bad_path');
  if (raw.startsWith('/') || /^[A-Za-z]:/.test(raw)) {
    throw new HttpError(400, 'Chỉ chấp nhận đường dẫn tương đối trong project', 'bad_path');
  }
  const norm = path.posix.normalize(raw === '' ? '.' : raw);
  if (norm === '..' || norm.startsWith('../')) throw new HttpError(403, 'Đường dẫn vượt ra ngoài project', 'outside_root');
  return norm === '.' ? '' : norm.replace(/\/$/, '');
}

export type Resolved = { abs: string; rel: string; exists: boolean };

/**
 * Resolve `rel` inside `root`, following symlinks. Existing targets must have a
 * realpath inside root; for new targets the parent's realpath must be inside root.
 */
export async function resolveInside(root: string, rel: string | undefined): Promise<Resolved> {
  const realRoot = await realpath(root);
  const relNorm = normalizeRel(rel);
  const lexical = path.resolve(realRoot, relNorm);
  if (!isInside(realRoot, lexical)) throw new HttpError(403, 'Đường dẫn vượt ra ngoài project', 'outside_root');

  try {
    const real = await realpath(lexical);
    if (!isInside(realRoot, real)) {
      throw new HttpError(403, 'Symlink trỏ ra ngoài project, không được phép truy cập', 'outside_root');
    }
    return { abs: real, rel: relNorm, exists: true };
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  // Target does not exist: validate the nearest parent instead.
  const parent = path.dirname(lexical);
  let realParent: string;
  try {
    realParent = await realpath(parent);
  } catch {
    throw new HttpError(404, 'Thư mục cha không tồn tại', 'not_found');
  }
  if (!isInside(realRoot, realParent)) {
    throw new HttpError(403, 'Symlink trỏ ra ngoài project, không được phép truy cập', 'outside_root');
  }
  if (!(await stat(realParent)).isDirectory()) throw new HttpError(400, 'Thư mục cha không phải thư mục', 'bad_path');
  return { abs: path.join(realParent, path.basename(lexical)), rel: relNorm, exists: false };
}

/** Validate a single file/folder name typed by the user. */
export function assertEntryName(name: string): void {
  if (!name || name === '.' || name === '..' || /[\\/\0]/.test(name) || name.length > 255) {
    throw new HttpError(400, 'Tên file/thư mục không hợp lệ', 'bad_name');
  }
}
