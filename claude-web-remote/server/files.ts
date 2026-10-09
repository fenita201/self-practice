import { createHash, randomBytes } from 'node:crypto';
import { chmod, lstat, mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HttpError, assertEntryName, resolveInside } from './paths.js';

export type TreeEntry = {
  name: string;
  path: string; // relative to project root, posix
  type: 'file' | 'dir';
  size: number;
  mtime: number;
  symlink: boolean;
  hiddenByDefault: boolean;
};

export type FileContent = {
  path: string;
  size: number;
  mtime: number;
  etag: string;
  binary: boolean;
  tooLarge: boolean;
  editable: boolean;
  eol: 'lf' | 'crlf';
  content: string | null;
};

export type FileServiceOptions = {
  maxViewBytes: number;
  maxSaveBytes: number;
  hiddenNames: string[];
};

const BOM = Buffer.from([0xef, 0xbb, 0xbf]);

export const etagOf = (buf: Buffer) => createHash('sha256').update(buf).digest('hex').slice(0, 32);

function looksBinary(buf: Buffer): boolean {
  const n = Math.min(buf.length, 8000);
  for (let i = 0; i < n; i++) if (buf[i] === 0) return true;
  return false;
}

function isValidUtf8(buf: Buffer): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(buf);
    return true;
  } catch {
    return false;
  }
}

/** Read-only browsing plus explicit save/create/rename. Never deletes. */
export class FileService {
  constructor(private readonly opts: FileServiceOptions) {}

  async tree(projectRoot: string, rel: string | undefined, showHidden: boolean): Promise<TreeEntry[]> {
    const dir = await resolveInside(projectRoot, rel);
    if (!dir.exists) throw new HttpError(404, 'Không tìm thấy thư mục', 'not_found');
    if (!(await stat(dir.abs)).isDirectory()) throw new HttpError(400, 'Không phải thư mục', 'not_dir');
    const dirents = await readdir(dir.abs, { withFileTypes: true });
    const out: TreeEntry[] = [];
    for (const d of dirents) {
      const hiddenByDefault = this.opts.hiddenNames.includes(d.name);
      if (hiddenByDefault && !showHidden) continue;
      const childRel = dir.rel ? `${dir.rel}/${d.name}` : d.name;
      const abs = path.join(dir.abs, d.name);
      try {
        const l = await lstat(abs);
        let isDir = l.isDirectory();
        let size = l.size;
        let mtime = l.mtimeMs;
        if (l.isSymbolicLink()) {
          // Show the link but only resolve targets that stay inside the project.
          try {
            const target = await resolveInside(projectRoot, childRel);
            const s = await stat(target.abs);
            isDir = s.isDirectory();
            size = s.size;
            mtime = s.mtimeMs;
          } catch {
            continue;
          }
        } else if (!l.isFile() && !l.isDirectory()) {
          continue; // sockets, fifos, devices
        }
        out.push({ name: d.name, path: childRel, type: isDir ? 'dir' : 'file', size, mtime, symlink: l.isSymbolicLink(), hiddenByDefault });
      } catch {
        /* entry vanished while listing */
      }
    }
    out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
    return out;
  }

  async read(projectRoot: string, rel: string): Promise<FileContent> {
    const f = await resolveInside(projectRoot, rel);
    if (!f.exists) throw new HttpError(404, 'Không tìm thấy file', 'not_found');
    const s = await stat(f.abs);
    if (!s.isFile()) throw new HttpError(400, 'Không phải file', 'not_file');
    const base = { path: f.rel, size: s.size, mtime: s.mtimeMs };
    if (s.size > this.opts.maxViewBytes) {
      const etag = etagOf(Buffer.from(`${s.size}:${s.mtimeMs}`));
      return { ...base, etag, binary: false, tooLarge: true, editable: false, eol: 'lf', content: null };
    }
    const buf = await readFile(f.abs);
    const etag = etagOf(buf);
    if (looksBinary(buf)) return { ...base, etag, binary: true, tooLarge: false, editable: false, eol: 'lf', content: null };
    const utf8 = isValidUtf8(buf);
    const body = buf.subarray(0, 3).equals(BOM) ? buf.subarray(3) : buf;
    const text = body.toString('utf8');
    const crlf = (text.match(/\r\n/g)?.length ?? 0) > 0 && (text.match(/\r\n/g)!.length >= (text.match(/(?<!\r)\n/g)?.length ?? 0));
    return {
      ...base,
      etag,
      binary: false,
      tooLarge: false,
      editable: utf8 && s.size <= this.opts.maxSaveBytes,
      eol: crlf ? 'crlf' : 'lf',
      content: text,
    };
  }

  /**
   * Save with optimistic concurrency: `ifMatch` must equal the etag of what is on disk.
   * Atomic: write a temp file in the same directory, then rename over the target.
   * Keeps file mode, BOM and line endings of the existing file.
   */
  async write(projectRoot: string, rel: string, content: string, ifMatch: string | undefined): Promise<{ etag: string; mtime: number }> {
    if (!ifMatch) throw new HttpError(428, 'Thiếu If-Match (etag) khi lưu file', 'etag_required');
    const f = await resolveInside(projectRoot, rel);
    if (!f.exists) throw new HttpError(404, 'File không còn tồn tại trên server', 'not_found');
    const s = await stat(f.abs);
    if (!s.isFile()) throw new HttpError(400, 'Không phải file', 'not_file');
    const current = await readFile(f.abs);
    const currentEtag = etagOf(current);
    if (currentEtag !== ifMatch) {
      throw Object.assign(new HttpError(409, 'File đã thay đổi trên server kể từ lúc bạn mở', 'conflict'), {
        details: { currentEtag },
      });
    }
    const hadBom = current.subarray(0, 3).equals(BOM);
    const currentText = (hadBom ? current.subarray(3) : current).toString('utf8');
    const crlf = /\r\n/.test(currentText) && (currentText.match(/\r\n/g)!.length >= (currentText.match(/(?<!\r)\n/g)?.length ?? 0));
    let text = content.replace(/\r\n/g, '\n');
    if (crlf) text = text.replace(/\n/g, '\r\n');
    const out = hadBom ? Buffer.concat([BOM, Buffer.from(text, 'utf8')]) : Buffer.from(text, 'utf8');
    if (out.length > this.opts.maxSaveBytes) throw new HttpError(413, 'Nội dung vượt quá FILE_MAX_SAVE_BYTES', 'too_large');

    const tmp = path.join(path.dirname(f.abs), `.${path.basename(f.abs)}.${randomBytes(6).toString('hex')}.tmp`);
    try {
      await writeFile(tmp, out, { mode: s.mode & 0o7777, flag: 'wx' });
      await chmod(tmp, s.mode & 0o7777);
      await rename(tmp, f.abs);
    } catch (err) {
      await rm(tmp, { force: true });
      throw err;
    }
    const after = await stat(f.abs);
    return { etag: etagOf(out), mtime: after.mtimeMs };
  }

  async create(projectRoot: string, rel: string, type: 'file' | 'dir'): Promise<{ path: string }> {
    assertEntryName(path.posix.basename(rel.replace(/\\/g, '/')));
    const f = await resolveInside(projectRoot, rel);
    if (f.exists) throw new HttpError(409, 'Đã tồn tại file/thư mục cùng tên', 'exists');
    if (type === 'dir') {
      await mkdir(f.abs).catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'EEXIST') throw new HttpError(409, 'Đã tồn tại file/thư mục cùng tên', 'exists');
        throw e;
      });
    } else {
      const h = await open(f.abs, 'wx').catch((e: NodeJS.ErrnoException) => {
        if (e.code === 'EEXIST') throw new HttpError(409, 'Đã tồn tại file/thư mục cùng tên', 'exists');
        throw e;
      });
      await h.close();
    }
    return { path: f.rel };
  }

  async rename(projectRoot: string, from: string, to: string): Promise<{ from: string; to: string }> {
    assertEntryName(path.posix.basename(to.replace(/\\/g, '/')));
    const src = await resolveInside(projectRoot, from);
    if (!src.exists) throw new HttpError(404, 'Không tìm thấy file/thư mục nguồn', 'not_found');
    if (src.rel === '') throw new HttpError(400, 'Không thể đổi tên thư mục gốc của project', 'root');
    // Rename the entry itself (a symlink stays a symlink), located via its validated parent dir.
    const srcParent = await resolveInside(projectRoot, path.posix.dirname(src.rel) === '.' ? '' : path.posix.dirname(src.rel));
    const srcPath = path.join(srcParent.abs, path.posix.basename(src.rel));
    const dst = await resolveInside(projectRoot, to);
    if (dst.exists) throw new HttpError(409, 'Đích đã tồn tại, không ghi đè', 'exists');
    if (dst.rel === src.rel || dst.rel.startsWith(`${src.rel}/`)) {
      throw new HttpError(400, 'Không thể di chuyển thư mục vào bên trong chính nó', 'bad_path');
    }
    await rename(srcPath, dst.abs);
    return { from: src.rel, to: dst.rel };
  }
}
