import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react';
import { enc, type Meta } from './api';
import { AuthBadge } from './AuthBadge';
import { Chat, type ChatHandle } from './Chat';
import { EditorArea, type EditorHandle } from './EditorArea';
import { FileTree } from './FileTree';
import type { StreamEvent } from './timeline';
import { useStream } from './useStream';
import { storageGet, storageSet } from './util';

export type Subscribe = (fn: (ev: StreamEvent) => void) => () => void;

type MobileTab = 'files' | 'code' | 'chat';

function useIsMobile(): boolean {
  const q = '(max-width: 820px)';
  const [m, setM] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const mq = window.matchMedia(q);
    const on = () => setM(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return m;
}

export function Workspace(props: { project: string; sessionId: string | null; meta: Meta | null; onRefreshMeta: () => void; onLogout: () => void }) {
  const { project, sessionId } = props;
  const isMobile = useIsMobile();
  const [tab, setTab] = useState<MobileTab>(sessionId ? 'chat' : 'files');
  const [treeW, setTreeW] = useState(() => Number(storageGet('cr.treeW')) || 260);
  const [chatW, setChatW] = useState(() => Number(storageGet('cr.chatW')) || 460);
  const [chatCollapsed, setChatCollapsed] = useState(() => storageGet('cr.chatCollapsed') === '1');
  const editor = useRef<EditorHandle>(null);
  const chat = useRef<ChatHandle>(null);
  const listeners = useRef(new Set<(ev: StreamEvent) => void>());
  const [badge, setBadge] = useState(0); // pending questions in other tabs (mobile)

  const subscribe: Subscribe = useCallback((fn) => {
    listeners.current.add(fn);
    return () => listeners.current.delete(fn);
  }, []);

  const streamStatus = useStream(project, sessionId, (ev) => {
    for (const l of listeners.current) l(ev);
  });

  useEffect(() => {
    storageSet('cr.treeW', String(treeW));
    storageSet('cr.chatW', String(chatW));
    storageSet('cr.chatCollapsed', chatCollapsed ? '1' : '0');
  }, [treeW, chatW, chatCollapsed]);

  const openFile = useCallback(
    (path: string) => {
      editor.current?.open(path);
      if (isMobile) setTab('code');
    },
    [isMobile],
  );
  const mention = useCallback(
    (path: string) => {
      chat.current?.insert(`@${path} `);
      if (isMobile) setTab('chat');
      else setChatCollapsed(false);
    },
    [isMobile],
  );

  const drag = (which: 'tree' | 'chat') => (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const start = which === 'tree' ? treeW : chatW;
    const move = (ev: PointerEvent) => {
      const dx = ev.clientX - startX;
      if (which === 'tree') setTreeW(Math.min(600, Math.max(160, start + dx)));
      else setChatW(Math.min(900, Math.max(300, start - dx)));
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const show = (t: MobileTab) => !isMobile || tab === t;

  return (
    <div className={`workspace ${isMobile ? 'mobile' : ''}`}>
      <header className="topbar">
        <a className="btn ghost icon" href="#/" title="Danh sách project">
          ←
        </a>
        <div className="title truncate" title={project}>
          {project}
        </div>
        {streamStatus !== 'open' && <span className="badge badge-warn">{streamStatus === 'connecting' ? 'Đang kết nối…' : 'Mất kết nối, đang thử lại…'}</span>}
        <div className="spacer" />
        {!isMobile && <AuthBadge meta={props.meta} onRefresh={props.onRefreshMeta} />}
        {!isMobile && (
          <button className="btn ghost" onClick={() => setChatCollapsed((c) => !c)}>
            {chatCollapsed ? 'Hiện chat' : 'Ẩn chat'}
          </button>
        )}
        <button className="btn ghost" onClick={props.onLogout} title="Đăng xuất">
          {isMobile ? '⎋' : 'Đăng xuất'}
        </button>
      </header>
      <div className="panes" style={isMobile ? undefined : { gridTemplateColumns: `${treeW}px 6px 1fr ${chatCollapsed ? '' : `6px ${chatW}px`}` }}>
        <section className="pane tree-pane" hidden={!show('files')}>
          <FileTree project={project} subscribe={subscribe} onOpen={openFile} onMention={mention} />
        </section>
        {!isMobile && <div className="resizer" onPointerDown={drag('tree')} />}
        <section className="pane editor-pane" hidden={!show('code')}>
          <EditorArea ref={editor} project={project} subscribe={subscribe} isMobile={isMobile} onMention={mention} />
        </section>
        {!isMobile && !chatCollapsed && <div className="resizer" onPointerDown={drag('chat')} />}
        <section className="pane chat-pane" hidden={isMobile ? tab !== 'chat' : chatCollapsed}>
          <Chat
            ref={chat}
            project={project}
            sessionId={sessionId}
            meta={props.meta}
            subscribe={subscribe}
            onOpenFile={openFile}
            onSelectSession={(id) => (location.hash = id ? `/p/${enc(project)}/s/${id}` : `/p/${enc(project)}`)}
            onPendingChange={setBadge}
          />
        </section>
      </div>
      {isMobile && (
        <nav className="tabbar">
          {(['files', 'code', 'chat'] as const).map((t) => (
            <button key={t} className={tab === t ? 'active' : ''} onClick={() => setTab(t)}>
              {t === 'files' ? 'Files' : t === 'code' ? 'Code' : 'Chat'}
              {t === 'chat' && badge > 0 && tab !== 'chat' && <span className="pill">{badge}</span>}
            </button>
          ))}
        </nav>
      )}
    </div>
  );
}
