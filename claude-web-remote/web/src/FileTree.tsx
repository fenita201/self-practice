import { useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError, enc, type TreeEntry } from './api';
import { Modal } from './Modal';
import type { StreamEvent } from './timeline';
import { copyText, dirname } from './util';
import type { Subscribe } from './Workspace';

type DirState = { entries: TreeEntry[] | null; error?: string };

type Dialog =
  | { type: 'create'; kind: 'file' | 'dir'; parent: string }
  | { type: 'rename'; path: string }
  | null;

export function FileTree(props: { project: string; subscribe: Subscribe; onOpen: (path: string) => void; onMention: (path: string) => void }) {
  const { project } = props;
  const [dirs, setDirs] = useState<Record<string, DirState>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [showAll, setShowAll] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);
  const [changed, setChanged] = useState<Record<string, number>>({});
  const [menu, setMenu] = useState<{ entry: TreeEntry | null; x: number; y: number } | null>(null);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(new Set<string>());

  const loadDir = useCallback(
    async (path: string) => {
      loaded.current.add(path);
      try {
        const r = await api<{ entries: TreeEntry[] }>('GET', `/api/projects/${enc(project)}/tree?path=${enc(path)}${showAll ? '&all=1' : ''}`);
        setDirs((d) => ({ ...d, [path]: { entries: r.entries } }));
      } catch (e) {
        setDirs((d) => ({ ...d, [path]: { entries: null, error: e instanceof ApiError ? e.message : 'Lỗi' } }));
      }
    },
    [project, showAll],
  );

  useEffect(() => {
    // Reload everything that is open when toggling hidden entries.
    const open = [...loaded.current];
    loaded.current.clear();
    for (const p of open.length ? open : ['']) void loadDir(p);
  }, [loadDir]);

  useEffect(() => {
    let timer: number | null = null;
    const dirty = new Set<string>();
    return props.subscribe((ev: StreamEvent) => {
      if (ev.kind !== 'fs') return;
      const p = ev.payload as { type: string; path: string };
      if (p.type === 'change' || p.type === 'add') setChanged((c) => ({ ...c, [p.path]: Date.now() }));
      if (p.type !== 'change') {
        const parent = dirname(p.path);
        if (loaded.current.has(parent)) dirty.add(parent);
        if (timer) window.clearTimeout(timer);
        timer = window.setTimeout(() => {
          for (const d of dirty) void loadDir(d);
          dirty.clear();
        }, 250);
      }
    });
  }, [props.subscribe, loadDir]);

  const toggle = (e: TreeEntry) => {
    setSelected(e.path);
    if (e.type === 'file') {
      props.onOpen(e.path);
      return;
    }
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(e.path)) n.delete(e.path);
      else {
        n.add(e.path);
        if (!dirs[e.path]) void loadDir(e.path);
      }
      return n;
    });
  };

  const openMenu = (entry: TreeEntry | null, x: number, y: number) => setMenu({ entry, x: Math.min(x, window.innerWidth - 220), y: Math.min(y, window.innerHeight - 260) });

  const submitDialog = async () => {
    if (!dialog) return;
    setError(null);
    try {
      if (dialog.type === 'create') {
        const path = dialog.parent ? `${dialog.parent}/${name.trim()}` : name.trim();
        await api('POST', `/api/projects/${enc(project)}/files`, { path, type: dialog.kind });
        setExpanded((s) => new Set(s).add(dialog.parent));
        await loadDir(dialog.parent);
        if (dialog.kind === 'file') props.onOpen(path);
      } else {
        const parent = dirname(dialog.path);
        const to = parent ? `${parent}/${name.trim()}` : name.trim();
        await api('POST', `/api/projects/${enc(project)}/rename`, { from: dialog.path, to });
        window.dispatchEvent(new CustomEvent('cr:renamed', { detail: { from: dialog.path, to } }));
        await loadDir(parent);
      }
      setDialog(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Lỗi');
    }
  };

  const startDialog = (d: Dialog, initial = '') => {
    setMenu(null);
    setError(null);
    setName(initial);
    setDialog(d);
  };

  const renderDir = (path: string, depth: number) => {
    const st = dirs[path];
    if (!st) return <div className="tree-row muted" style={{ paddingLeft: 12 + depth * 14 }}>…</div>;
    if (st.error) return <div className="tree-row error" style={{ paddingLeft: 12 + depth * 14 }}>{st.error}</div>;
    if (!st.entries!.length && depth > 0) return <div className="tree-row muted small" style={{ paddingLeft: 12 + depth * 14 }}>(trống)</div>;
    return st.entries!.map((e) => {
      const isOpen = expanded.has(e.path);
      const recent = changed[e.path] && Date.now() - changed[e.path]! < 10 * 60_000;
      return (
        <div key={e.path}>
          <div
            className={`tree-row ${selected === e.path ? 'selected' : ''} ${e.hiddenByDefault ? 'dim' : ''}`}
            style={{ paddingLeft: 8 + depth * 14 }}
            onClick={() => toggle(e)}
            onContextMenu={(ev) => {
              ev.preventDefault();
              openMenu(e, ev.clientX, ev.clientY);
            }}
            title={e.path}
          >
            <span className="tree-caret">{e.type === 'dir' ? (isOpen ? '▾' : '▸') : ''}</span>
            <span className={`tree-icon ${e.type}`}>{e.type === 'dir' ? '▣' : '▤'}</span>
            <span className="tree-name">{e.name}</span>
            {e.symlink && <span className="muted small"> ↪</span>}
            {recent && <span className="dot changed" title="Vừa thay đổi" />}
            <button
              className="tree-more"
              aria-label="Thao tác"
              onClick={(ev) => {
                ev.stopPropagation();
                const r = (ev.currentTarget as HTMLElement).getBoundingClientRect();
                openMenu(e, r.left, r.bottom);
              }}
            >
              ⋯
            </button>
          </div>
          {e.type === 'dir' && isOpen && renderDir(e.path, depth + 1)}
        </div>
      );
    });
  };

  const menuTarget = menu?.entry;
  const menuParent = menuTarget ? (menuTarget.type === 'dir' ? menuTarget.path : dirname(menuTarget.path)) : '';

  return (
    <div className="file-tree" onClick={() => setMenu(null)}>
      <div className="pane-head">
        <span className="pane-title">Files</span>
        <div className="spacer" />
        <button className="btn ghost icon" title="File mới" onClick={() => startDialog({ type: 'create', kind: 'file', parent: '' })}>
          ＋
        </button>
        <button className="btn ghost icon" title="Thư mục mới" onClick={() => startDialog({ type: 'create', kind: 'dir', parent: '' })}>
          ▣
        </button>
        <button className="btn ghost icon" title="Tải lại" onClick={() => [...loaded.current].forEach((p) => void loadDir(p))}>
          ↻
        </button>
        <button className={`btn ghost icon ${showAll ? 'active' : ''}`} title={showAll ? 'Ẩn node_modules, .git…' : 'Hiện tất cả (node_modules, .git…)'} onClick={() => setShowAll((s) => !s)}>
          {showAll ? '◉' : '○'}
        </button>
      </div>
      <div
        className="tree-body"
        onContextMenu={(ev) => {
          if (ev.target === ev.currentTarget) {
            ev.preventDefault();
            openMenu(null, ev.clientX, ev.clientY);
          }
        }}
      >
        {renderDir('', 0)}
      </div>

      {menu && (
        <div className="menu" style={{ left: menu.x, top: menu.y }} onClick={(e) => e.stopPropagation()}>
          {menuTarget?.type === 'file' && <button onClick={() => (setMenu(null), props.onOpen(menuTarget.path))}>Mở</button>}
          <button onClick={() => startDialog({ type: 'create', kind: 'file', parent: menuParent })}>Tạo file{menuParent ? ` trong ${menuParent}/` : ''}</button>
          <button onClick={() => startDialog({ type: 'create', kind: 'dir', parent: menuParent })}>Tạo thư mục{menuParent ? ` trong ${menuParent}/` : ''}</button>
          {menuTarget && <button onClick={() => startDialog({ type: 'rename', path: menuTarget.path }, menuTarget.name)}>Đổi tên</button>}
          {menuTarget && (
            <button
              onClick={() => {
                void copyText(menuTarget.path);
                setMenu(null);
              }}
            >
              Copy path
            </button>
          )}
          {menuTarget && (
            <button
              onClick={() => {
                props.onMention(menuTarget.path);
                setMenu(null);
              }}
            >
              Chèn @path vào prompt
            </button>
          )}
        </div>
      )}

      {dialog && (
        <Modal
          title={dialog.type === 'rename' ? `Đổi tên ${dialog.path}` : dialog.kind === 'file' ? 'Tạo file mới' : 'Tạo thư mục mới'}
          onClose={() => setDialog(null)}
          actions={
            <>
              <button className="btn ghost" onClick={() => setDialog(null)}>
                Huỷ
              </button>
              <button className="btn primary" disabled={!name.trim()} onClick={() => void submitDialog()}>
                {dialog.type === 'rename' ? 'Đổi tên' : 'Tạo'}
              </button>
            </>
          }
        >
          {dialog.type === 'create' && <div className="muted small">Trong: /{dialog.parent}</div>}
          <input
            className="input"
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && name.trim()) void submitDialog();
            }}
            placeholder={dialog.type === 'create' && dialog.kind === 'file' ? 'vd. main.go' : 'tên'}
          />
          {error && <div className="error-box">{error}</div>}
        </Modal>
      )}
    </div>
  );
}
