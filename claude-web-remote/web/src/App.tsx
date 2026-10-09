import { useCallback, useEffect, useState } from 'react';
import { api, onUnauthenticated, setCsrf, type Meta } from './api';
import { Login } from './Login';
import { ProjectList } from './ProjectList';
import { Workspace } from './Workspace';

type Route = { name: 'projects' } | { name: 'project'; project: string; session: string | null };

function parseHash(): Route {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const m = /^p\/([^/]+)(?:\/s\/([0-9a-fA-F-]{36}))?/.exec(h);
  if (m) return { name: 'project', project: m[1]!, session: m[2] ?? null };
  return { name: 'projects' };
}

export function App() {
  const [auth, setAuth] = useState<{ checked: boolean; ok: boolean; passwordSet: boolean; appName: string; serverLabel: string }>({
    checked: false,
    ok: false,
    passwordSet: true,
    appName: 'Claude Remote',
    serverLabel: '',
  });
  const [route, setRoute] = useState<Route>(parseHash);
  const [meta, setMeta] = useState<Meta | null>(null);

  const checkAuth = useCallback(async () => {
    try {
      const me = await api<{ authenticated: boolean; csrf: string | null; passwordSet: boolean; appName: string; serverLabel: string }>('GET', '/api/auth/me');
      setCsrf(me.csrf);
      setAuth({ checked: true, ok: me.authenticated, passwordSet: me.passwordSet, appName: me.appName, serverLabel: me.serverLabel });
    } catch {
      setAuth((a) => ({ ...a, checked: true }));
    }
  }, []);

  useEffect(() => {
    void checkAuth();
    const off = onUnauthenticated(() => setAuth((a) => ({ ...a, ok: false })));
    const onHash = () => setRoute(parseHash());
    window.addEventListener('hashchange', onHash);
    return () => {
      off();
      window.removeEventListener('hashchange', onHash);
    };
  }, [checkAuth]);

  useEffect(() => {
    document.title = auth.serverLabel ? `${auth.appName} · ${auth.serverLabel}` : auth.appName;
  }, [auth.appName, auth.serverLabel]);

  const loadMeta = useCallback(async (refresh = false) => {
    try {
      setMeta(await api<Meta>('GET', `/api/meta${refresh ? '?refresh=1' : ''}`));
    } catch {
      /* shown elsewhere */
    }
  }, []);

  useEffect(() => {
    if (auth.ok) void loadMeta();
  }, [auth.ok, loadMeta]);

  if (!auth.checked) return <div className="center muted">Đang tải…</div>;
  if (!auth.ok) return <Login appName={auth.appName} serverLabel={auth.serverLabel} passwordSet={auth.passwordSet} onLoggedIn={checkAuth} />;

  const logout = async () => {
    await api('POST', '/api/auth/logout').catch(() => undefined);
    setCsrf(null);
    setAuth((a) => ({ ...a, ok: false }));
  };

  if (route.name === 'project') {
    return <Workspace key={route.project} project={route.project} sessionId={route.session} meta={meta} onRefreshMeta={() => loadMeta(true)} onLogout={logout} />;
  }
  return <ProjectList meta={meta} appName={auth.appName} serverLabel={auth.serverLabel} onRefreshMeta={() => loadMeta(true)} onLogout={logout} />;
}
