import { watch, type FSWatcher } from 'chokidar';
import path from 'node:path';
import { projectChannel, type Journal } from './journal.js';

type Entry = { watcher: FSWatcher; refs: number; closeTimer: NodeJS.Timeout | null };

/**
 * One chokidar watcher per project, alive while at least one browser stream is
 * subscribed (plus a short grace period). Emits ephemeral "fs" events so the
 * tree and open editor tabs refresh without F5.
 */
export class ProjectWatchers {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly journal: Journal,
    private readonly hiddenNames: string[],
    private readonly log: { warn(o: unknown, m?: string): void },
  ) {}

  acquire(project: string, dir: string): () => void {
    let e = this.entries.get(project);
    if (!e) {
      const hidden = new Set([...this.hiddenNames, '.git']);
      const watcher = watch(dir, {
        ignoreInitial: true,
        persistent: true,
        ignored: (p: string) => path.relative(dir, p).split(path.sep).some((seg) => hidden.has(seg)) || /\.[^/\\]+\.[0-9a-f]{12}\.tmp$/.test(p),
      });
      const emit = (type: string) => (p: string) =>
        this.journal.ephemeral(projectChannel(project), 'fs', { type, path: path.relative(dir, p).split(path.sep).join('/') });
      watcher
        .on('add', emit('add'))
        .on('change', emit('change'))
        .on('unlink', emit('unlink'))
        .on('addDir', emit('addDir'))
        .on('unlinkDir', emit('unlinkDir'))
        .on('error', (err) => this.log.warn({ project, err: String(err) }, 'file watcher error'));
      e = { watcher, refs: 0, closeTimer: null };
      this.entries.set(project, e);
    }
    if (e.closeTimer) {
      clearTimeout(e.closeTimer);
      e.closeTimer = null;
    }
    e.refs++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const cur = this.entries.get(project);
      if (!cur) return;
      cur.refs--;
      if (cur.refs <= 0) {
        cur.closeTimer = setTimeout(() => {
          void cur.watcher.close();
          this.entries.delete(project);
        }, 30_000);
      }
    };
  }

  async closeAll(): Promise<void> {
    await Promise.all([...this.entries.values()].map((e) => e.watcher.close()));
    this.entries.clear();
  }
}
