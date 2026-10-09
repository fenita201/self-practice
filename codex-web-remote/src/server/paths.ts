import path from "node:path";
import {
  realpath,
  lstat,
  readFile,
  stat,
  open,
  rename,
  unlink,
  mkdir,
  readdir,
} from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { hash } from "./store.js";
import type { Config } from "./config.js";
export class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}
export function inside(root: string, p: string) {
  return p === root || p.startsWith(root + path.sep);
}
export function component(name: string) {
  if (!name || name === "." || name === ".." || /[\\/\x00-\x1f]/.test(name))
    throw new HttpError(400, "Tên chỉ được có một thành phần hợp lệ");
  return name;
}
export class Files {
  constructor(public cfg: Config) {}
  async allowed(p: string) {
    try {
      const r = await realpath(p);
      return (
        this.cfg.roots.some((root) => inside(root, r)) &&
        (await stat(r)).isDirectory()
      );
    } catch {
      return false;
    }
  }
  async project(p: string) {
    if (
      typeof p !== "string" ||
      !path.isAbsolute(p) ||
      !(await this.allowed(p))
    )
      throw new HttpError(403, "Project ngoài roots hoặc không tồn tại");
    return realpath(p);
  }
  async resolve(
    project: string,
    relative: string,
    write = false,
    missing = false,
  ) {
    const root = await this.project(project);
    if (
      typeof relative !== "string" ||
      path.isAbsolute(relative) ||
      relative.includes("\\") ||
      relative.includes("\0") ||
      relative.split("/").includes("..")
    )
      throw new HttpError(403, "Đường dẫn không hợp lệ");
    const target = path.resolve(root, relative);
    if (!inside(root, target))
      throw new HttpError(403, "Đường dẫn ngoài project");
    const parts = path.relative(root, target).split(path.sep).filter(Boolean);
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      current = path.join(current, parts[i]);
      try {
        const s = await lstat(current);
        if (s.isSymbolicLink() && write)
          throw new HttpError(403, "Không ghi qua symlink");
        const r = await realpath(current);
        if (!inside(root, r)) throw new HttpError(403, "Symlink ngoài project");
      } catch (e) {
        if (
          (e as NodeJS.ErrnoException).code === "ENOENT" &&
          missing &&
          i === parts.length - 1
        )
          return target;
        throw e;
      }
    }
    return target;
  }
  async tree(project: string, relative = "", hidden = false) {
    const p = await this.resolve(project, relative);
    return (await readdir(p, { withFileTypes: true }))
      .filter((e) => hidden || !this.cfg.hidden.includes(e.name))
      .map((e) => ({
        name: e.name,
        path: path.posix.join(relative, e.name),
        type: e.isDirectory()
          ? "folder"
          : e.isSymbolicLink()
            ? "symlink"
            : "file",
      }))
      .sort(
        (a, b) =>
          Number(b.type === "folder") - Number(a.type === "folder") ||
          a.name.localeCompare(b.name),
      );
  }
  async read(project: string, relative: string) {
    const p = await this.resolve(project, relative);
    const s = await stat(p);
    if (!s.isFile() || s.size > this.cfg.viewMax)
      throw new HttpError(413, "Không phải file hoặc vượt FILE_MAX_VIEW_BYTES");
    const b = await readFile(p);
    if (b.includes(0)) throw new HttpError(415, "File binary không hỗ trợ");
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(b);
    } catch {
      throw new HttpError(415, "Chỉ hỗ trợ UTF-8 hợp lệ");
    }
    return {
      text,
      version: hash(b.toString("base64")),
      mode: s.mode,
      newline: text.includes("\r\n") ? "CRLF" : "LF",
    };
  }
  async save(project: string, relative: string, text: string, version: string) {
    if (
      typeof text !== "string" ||
      Buffer.byteLength(text) > this.cfg.saveMax ||
      text.includes("\0")
    )
      throw new HttpError(413, "Nội dung quá lớn hoặc không hợp lệ");
    const p = await this.resolve(project, relative, true);
    const old = await this.read(project, relative);
    if (old.version !== version)
      throw new HttpError(409, "File đã đổi trên đĩa; draft được giữ lại");
    if (old.newline === "CRLF") text = text.replace(/\r?\n/g, "\r\n");
    else text = text.replace(/\r\n/g, "\n");
    const temp = path.join(
      path.dirname(p),
      `.codex-remote-${randomUUID()}.tmp`,
    );
    const fd = await open(temp, "wx", old.mode & 0o777);
    try {
      await fd.chmod(old.mode & 0o777);
      await fd.writeFile(text);
      await fd.sync();
      await fd.close();
      await this.resolve(project, relative, true);
      if ((await this.read(project, relative)).version !== version)
        throw new HttpError(409, "File đã đổi lần nữa");
      await rename(temp, p);
    } catch (e) {
      await fd.close().catch(() => {});
      await unlink(temp).catch(() => {});
      throw e;
    }
    return this.read(project, relative);
  }
  async create(project: string, relative: string, folder: boolean) {
    const p = await this.resolve(project, relative, true, true);
    if (p === (await this.project(project)))
      throw new HttpError(400, "Không tạo đè root");
    if (folder) await mkdir(p);
    else {
      const f = await open(p, "wx", 0o644);
      await f.close();
    }
  }
  async rename(project: string, from: string, to: string) {
    const a = await this.resolve(project, from, true),
      b = await this.resolve(project, to, true, true);
    if (
      a === (await this.project(project)) ||
      b === (await this.project(project))
    )
      throw new HttpError(400, "Không đổi tên root");
    try {
      await lstat(b);
      throw new HttpError(409, "Đích đã tồn tại");
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await rename(a, b);
  }
}
export class Locks {
  busy = new Set<string>();
  async run<T>(cwd: string, fn: () => Promise<T>) {
    if ([...this.busy].some((p) => inside(p, cwd) || inside(cwd, p)))
      throw new HttpError(423, "Project đang có thao tác khác");
    this.busy.add(cwd);
    try {
      return await fn();
    } finally {
      this.busy.delete(cwd);
    }
  }
}
