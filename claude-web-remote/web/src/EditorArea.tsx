import { indentWithTab } from '@codemirror/commands';
import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { oneDark } from '@codemirror/theme-one-dark';
import { EditorView, keymap } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { api, ApiError, enc, type FileContent } from './api';
import { isMarkdown, languageFor } from './languages';
import { Markdown } from './Markdown';
import { Modal } from './Modal';
import type { StreamEvent } from './timeline';
import { basename, copyText, fmtBytes, lineDiff, type DiffLine } from './util';
import type { Subscribe } from './Workspace';

export type EditorHandle = { open(path: string): void };

type Tab = {
  path: string;
  status: 'loading' | 'ready' | 'error';
  error?: string;
  file?: FileContent;
  base: string; // content as last loaded/saved from the server
  dirty: boolean;
  externalChange: boolean;
  deleted: boolean;
  preview: boolean;
  editing: boolean;
  saving: boolean;
};

type Conflict = { path: string; serverEtag: string | null; diff: DiffLine[] | null | 'loading' | 'too-big' };

const dark = () => window.matchMedia('(prefers-color-scheme: dark)').matches;

export const EditorArea = forwardRef<EditorHandle, { project: string; subscribe: Subscribe; isMobile: boolean; onMention: (path: string) => void }>(function EditorArea(props, ref) {
  const { project, isMobile } = props;
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const states = useRef(new Map<string, EditorState>());
  const viewRef = useRef<EditorView | null>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const activeRef = useRef(active);
  activeRef.current = active;
  const readOnlyComp = useRef(new Compartment());
  const dirtyTimer = useRef<number | null>(null);

  const patchTab = useCallback((path: string, patch: Partial<Tab> | ((t: Tab) => Partial<Tab>)) => {
    setTabs((ts) => ts.map((t) => (t.path === path ? { ...t, ...(typeof patch === 'function' ? patch(t) : patch) } : t)));
  }, []);

  const flash = (msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast((t) => (t === msg ? null : t)), 2500);
  };

  const save = useCallback(
    async (path: string, opts: { overwriteEtag?: string } = {}) => {
      const tab = tabsRef.current.find((t) => t.path === path);
      const st = path === activeRef.current && viewRef.current ? viewRef.current.state : states.current.get(path);
      if (!tab?.file || !st || !tab.file.editable) return;
      const content = st.doc.toString();
      patchTab(path, { saving: true });
      try {
        const r = await api<{ etag: string; mtime: number }>('PUT', `/api/projects/${enc(project)}/file?path=${enc(path)}`, { content }, { 'if-match': `"${opts.overwriteEtag ?? tab.file.etag}"` });
        patchTab(path, (t) => ({ saving: false, dirty: false, externalChange: false, base: content, file: { ...t.file!, etag: r.etag, mtime: r.mtime } }));
        flash(`Đã lưu ${basename(path)}`);
      } catch (e) {
        patchTab(path, { saving: false });
        if (e instanceof ApiError && e.code === 'conflict') {
          setConflict({ path, serverEtag: (e.details.currentEtag as string) ?? null, diff: null });
        } else flash(e instanceof ApiError ? `Lưu lỗi: ${e.message}` : 'Lưu lỗi');
      }
    },
    [project, patchTab],
  );

  const makeState = useCallback(
    (path: string, content: string, editable: boolean): EditorState => {
      const lang = languageFor(path).ext;
      const exts: Extension[] = [
        basicSetup,
        keymap.of([
          indentWithTab,
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              void save(path);
              return true;
            },
          },
        ]),
        readOnlyComp.current.of([EditorState.readOnly.of(!editable), EditorView.editable.of(editable)]),
        EditorView.updateListener.of((u) => {
          // Keep the per-tab state current so React re-renders never swap in a stale doc.
          states.current.set(path, u.state);
          if (!u.docChanged) return;
          if (dirtyTimer.current) window.clearTimeout(dirtyTimer.current);
          dirtyTimer.current = window.setTimeout(() => {
            const t = tabsRef.current.find((x) => x.path === path);
            if (t) {
              const dirty = u.state.doc.toString() !== t.base;
              if (dirty !== t.dirty) patchTab(path, { dirty });
            }
          }, 150);
        }),
        EditorView.lineWrapping,
      ];
      if (lang) exts.push(lang);
      if (dark()) exts.push(oneDark);
      return EditorState.create({ doc: content, extensions: exts });
    },
    [save, patchTab],
  );

  const load = useCallback(
    async (path: string, opts: { keepPreview?: boolean } = {}) => {
      try {
        const f = await api<FileContent>('GET', `/api/projects/${enc(project)}/file?path=${enc(path)}`);
        const content = f.content ?? '';
        const prev = tabsRef.current.find((t) => t.path === path);
        const editing = f.editable && (prev?.editing ?? !isMobile);
        states.current.set(path, makeState(path, content, editing));
        patchTab(path, (t) => ({
          status: 'ready',
          file: f,
          base: content,
          dirty: false,
          externalChange: false,
          deleted: false,
          editing,
          preview: opts.keepPreview ? t.preview : isMarkdown(path),
        }));
        if (activeRef.current === path && viewRef.current) viewRef.current.setState(states.current.get(path)!);
      } catch (e) {
        patchTab(path, { status: 'error', error: e instanceof ApiError ? e.message : 'Lỗi tải file' });
      }
    },
    [project, makeState, patchTab, isMobile],
  );

  useImperativeHandle(ref, () => ({
    open(path: string) {
      if (!tabsRef.current.some((t) => t.path === path)) {
        setTabs((ts) => [...ts, { path, status: 'loading', base: '', dirty: false, externalChange: false, deleted: false, preview: isMarkdown(path), editing: !isMobile, saving: false }]);
        void load(path);
      }
      setActive(path);
    },
  }));

  // Mount one EditorView; swap EditorStates when switching tabs (keeps undo history per tab).
  useEffect(() => {
    if (!hostRef.current) return;
    const view = new EditorView({ parent: hostRef.current, state: EditorState.create({ doc: '' }) });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  const prevActive = useRef<string | null>(null);
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    if (prevActive.current && prevActive.current !== active && states.current.has(prevActive.current)) {
      states.current.set(prevActive.current, view.state);
    }
    prevActive.current = active;
    const st = active ? states.current.get(active) : undefined;
    if (st && view.state !== st) view.setState(st);
  }, [active, tabs]);

  // Ctrl+S anywhere in the editor pane (e.g. while focus is on a toolbar button).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's' && activeRef.current) {
        e.preventDefault();
        void save(activeRef.current);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [save]);

  // Warn before leaving with unsaved changes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (tabsRef.current.some((t) => t.dirty)) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

  // File changed on the server (Claude edited it, or our own save echoing back).
  useEffect(
    () =>
      props.subscribe((ev: StreamEvent) => {
        if (ev.kind !== 'fs') return;
        const p = ev.payload as { type: string; path: string };
        const tab = tabsRef.current.find((t) => t.path === p.path);
        if (!tab) return;
        if (p.type === 'unlink') {
          patchTab(p.path, { deleted: true });
          return;
        }
        if (p.type !== 'change' && p.type !== 'add') return;
        void (async () => {
          try {
            const f = await api<FileContent>('GET', `/api/projects/${enc(project)}/file?path=${enc(p.path)}`);
            const cur = tabsRef.current.find((t) => t.path === p.path);
            if (!cur || cur.file?.etag === f.etag) return; // our own save
            if (cur.dirty) patchTab(p.path, { externalChange: true, deleted: false });
            else void load(p.path, { keepPreview: true });
          } catch {
            /* ignore */
          }
        })();
      }),
    [props.subscribe, project, load, patchTab],
  );

  // Follow renames done from the file tree.
  useEffect(() => {
    const onRename = (e: Event) => {
      const { from, to } = (e as CustomEvent<{ from: string; to: string }>).detail;
      const map = (p: string) => (p === from ? to : p.startsWith(`${from}/`) ? to + p.slice(from.length) : p);
      for (const [k, v] of [...states.current]) {
        const nk = map(k);
        if (nk !== k) {
          states.current.delete(k);
          states.current.set(nk, v);
        }
      }
      setTabs((ts) => ts.map((t) => ({ ...t, path: map(t.path), deleted: false })));
      setActive((a) => (a ? map(a) : a));
    };
    window.addEventListener('cr:renamed', onRename);
    return () => window.removeEventListener('cr:renamed', onRename);
  }, []);

  const close = (path: string) => {
    const t = tabs.find((x) => x.path === path);
    if (t?.dirty && !confirm(`${basename(path)} có thay đổi chưa lưu. Đóng và bỏ thay đổi?`)) return;
    states.current.delete(path);
    const idx = tabs.findIndex((x) => x.path === path);
    const next = tabs.filter((x) => x.path !== path);
    setTabs(next);
    if (active === path) setActive(next[Math.max(0, idx - 1)]?.path ?? null);
  };

  const setEditing = (path: string, editing: boolean) => {
    patchTab(path, { editing });
    const view = viewRef.current;
    const reconf = readOnlyComp.current.reconfigure([EditorState.readOnly.of(!editing), EditorView.editable.of(editing)]);
    if (view && active === path) view.dispatch({ effects: reconf });
    else {
      const st = states.current.get(path);
      if (st) states.current.set(path, st.update({ effects: reconf }).state);
    }
  };

  const showDiff = async (c: Conflict) => {
    setConflict({ ...c, diff: 'loading' });
    try {
      const f = await api<FileContent>('GET', `/api/projects/${enc(project)}/file?path=${enc(c.path)}`);
      const local = (c.path === activeRef.current && viewRef.current ? viewRef.current.state : states.current.get(c.path))?.doc.toString() ?? '';
      const d = lineDiff(f.content ?? '', local);
      setConflict({ ...c, serverEtag: f.etag, diff: d ?? 'too-big' });
    } catch {
      setConflict({ ...c, diff: 'too-big' });
    }
  };

  const tab = tabs.find((t) => t.path === active) ?? null;
  const showCode = !!tab && tab.status === 'ready' && !!tab.file && !tab.file.binary && !tab.file.tooLarge && !(tab.preview && isMarkdown(tab.path));

  return (
    <div className="editor-area">
      <div className="tabs" role="tablist">
        {tabs.map((t) => (
          <div key={t.path} className={`tab ${t.path === active ? 'active' : ''}`} onClick={() => setActive(t.path)} title={t.path} role="tab">
            <span className="tab-name">{basename(t.path)}</span>
            {t.dirty ? <span className="tab-dirty" title="Chưa lưu">●</span> : null}
            <button
              className="tab-close"
              aria-label="Đóng"
              onClick={(e) => {
                e.stopPropagation();
                close(t.path);
              }}
            >
              ×
            </button>
          </div>
        ))}
      </div>
      {tab && (
        <div className="editor-toolbar">
          <span className="mono small truncate" title={tab.path}>
            {tab.path}
          </span>
          <div className="spacer" />
          {tab.file && <span className="muted small">{languageFor(tab.path).name} · {fmtBytes(tab.file.size)}{tab.file.eol === 'crlf' ? ' · CRLF' : ''}</span>}
          {isMarkdown(tab.path) && tab.status === 'ready' && (
            <button className="btn ghost sm" onClick={() => patchTab(tab.path, { preview: !tab.preview })}>
              {tab.preview ? 'Mã nguồn' : 'Xem trước'}
            </button>
          )}
          {tab.file?.editable && !(tab.preview && isMarkdown(tab.path)) && (
            <button className={`btn ghost sm ${tab.editing ? 'active' : ''}`} onClick={() => setEditing(tab.path, !tab.editing)}>
              {tab.editing ? 'Chỉ xem' : 'Sửa'}
            </button>
          )}
          <button className="btn ghost sm" title="Chèn @path vào prompt" onClick={() => props.onMention(tab.path)}>
            @
          </button>
          <button className="btn ghost sm" title="Copy path" onClick={() => void copyText(tab.path).then(() => flash('Đã copy path'))}>
            ⧉
          </button>
          {tab.file?.editable && (
            <button className="btn primary sm" disabled={!tab.dirty || tab.saving} onClick={() => void save(tab.path)} title="Ctrl+S">
              {tab.saving ? 'Đang lưu…' : 'Lưu'}
            </button>
          )}
        </div>
      )}
      {tab?.externalChange && (
        <div className="banner warn">
          File đã thay đổi trên server (có thể do Claude) trong lúc bạn đang sửa.
          <button className="btn sm" onClick={() => void showDiff({ path: tab.path, serverEtag: null, diff: null })}>
            Xem diff
          </button>
          <button className="btn sm" onClick={() => confirm('Bỏ thay đổi của bạn và tải bản trên server?') && void load(tab.path, { keepPreview: true })}>
            Tải bản mới
          </button>
        </div>
      )}
      {tab?.deleted && <div className="banner error">File đã bị xoá hoặc đổi tên trên server. Nội dung bạn đang thấy chỉ còn trong trình duyệt.</div>}
      {tab && !tab.file?.editable && tab.status === 'ready' && tab.file && !tab.file.binary && !tab.file.tooLarge && (
        <div className="banner">File không phải UTF-8 hoặc quá lớn để sửa — chỉ xem.</div>
      )}
      <div className="editor-body">
        <div ref={hostRef} className="cm-host" hidden={!showCode} />
        {!tab && (
          <div className="empty center">
            <div>
              <div className="big-icon">▤</div>
              Chọn một file bên cây thư mục để xem.
              <div className="muted small">Ctrl+S để lưu khi đang sửa.</div>
            </div>
          </div>
        )}
        {tab?.status === 'loading' && <div className="empty center muted">Đang tải…</div>}
        {tab?.status === 'error' && <div className="empty center error">{tab.error}</div>}
        {tab?.status === 'ready' && tab.file?.binary && <div className="empty center muted">File nhị phân — không hiển thị ({fmtBytes(tab.file.size)}).</div>}
        {tab?.status === 'ready' && tab.file?.tooLarge && <div className="empty center muted">File quá lớn để mở ({fmtBytes(tab.file.size)} &gt; FILE_MAX_VIEW_BYTES).</div>}
        {tab?.status === 'ready' && tab.preview && isMarkdown(tab.path) && tab.file && !tab.file.binary && !tab.file.tooLarge && (
          <div className="md-preview">
            <Markdown text={(states.current.get(tab.path)?.doc.toString() ?? tab.base) || ''} />
          </div>
        )}
      </div>
      {toast && <div className="toast">{toast}</div>}
      {conflict && (
        <Modal
          wide
          title={`Xung đột khi lưu ${basename(conflict.path)}`}
          onClose={() => setConflict(null)}
          actions={
            <>
              <button className="btn ghost" onClick={() => void showDiff(conflict)}>
                Xem diff
              </button>
              <button
                className="btn"
                onClick={() => {
                  setConflict(null);
                  void load(conflict.path, { keepPreview: true });
                }}
              >
                Tải bản mới (bỏ thay đổi của tôi)
              </button>
              <button
                className="btn danger"
                disabled={!conflict.serverEtag}
                onClick={() => {
                  const etag = conflict.serverEtag!;
                  setConflict(null);
                  void save(conflict.path, { overwriteEtag: etag });
                }}
              >
                Ghi đè bản trên server
              </button>
            </>
          }
        >
          <p>File trên server đã thay đổi kể từ lúc bạn mở (có thể Claude vừa sửa). Chọn cách xử lý:</p>
          {conflict.diff === 'loading' && <div className="muted">Đang tải diff…</div>}
          {conflict.diff === 'too-big' && <div className="muted">File quá lớn để hiển thị diff.</div>}
          {Array.isArray(conflict.diff) && (
            <>
              <div className="muted small">
                <span className="diff-del-sample">− bản trên server</span> <span className="diff-add-sample">+ bản của bạn</span>
              </div>
              <pre className="diff">
                {conflict.diff.map((l, i) => (
                  <div key={i} className={`diff-${l.type}`}>
                    {l.type === 'add' ? '+ ' : l.type === 'del' ? '- ' : '  '}
                    {l.text}
                  </div>
                ))}
              </pre>
            </>
          )}
        </Modal>
      )}
    </div>
  );
});
