import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { api, ApiError, enc, type Meta, type ProjectInfo } from './api';
import { AuthBadge } from './AuthBadge';
import { useStream } from './useStream';
import { navigate, timeAgo } from './util';

export function ProjectList(props: { meta: Meta | null; appName: string; serverLabel: string; onRefreshMeta: () => void; onLogout: () => void }) {
  const [projects, setProjects] = useState<ProjectInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [name, setName] = useState('');
  const [gitInit, setGitInit] = useState(true);
  const [busy, setBusy] = useState<string[]>([]);

  const load = useCallback(async () => {
    try {
      setProjects((await api<{ projects: ProjectInfo[] }>('GET', '/api/projects')).projects);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Lỗi tải danh sách project');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useStream(null, null, (ev) => {
    if (ev.kind === 'projects_changed') void load();
    if (ev.kind === 'session_state') {
      const p = ev.payload as { project: string; state: string };
      setBusy((b) => {
        const active = p.state === 'running' || p.state === 'waiting_input';
        const others = b.filter((x) => x !== p.project);
        return active ? [...others, p.project] : others;
      });
    }
  });

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api<ProjectInfo & { gitError?: string }>('POST', '/api/projects', { name: name.trim(), gitInit });
      if (r.gitError) alert(r.gitError);
      navigate(`/p/${enc(r.name)}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Không tạo được project');
    }
  };

  return (
    <div className="page">
      <header className="topbar">
        <div className="brand">
          <span className="logo" aria-hidden>
            ◆
          </span>
          <div>
            <div className="title">{props.appName}</div>
            <div className="muted small">{props.serverLabel}</div>
          </div>
        </div>
        <div className="spacer" />
        <AuthBadge meta={props.meta} onRefresh={props.onRefreshMeta} />
        <button className="btn ghost" onClick={props.onLogout}>
          Đăng xuất
        </button>
      </header>
      <main className="projects">
        <div className="projects-head">
          <div>
            <h2>Projects</h2>
            {props.meta && <div className="muted small mono">{props.meta.workspaceRoot}</div>}
          </div>
          <button className="btn primary" onClick={() => setCreating((c) => !c)}>
            + Project mới
          </button>
        </div>
        {creating && (
          <form className="card create-project" onSubmit={create}>
            <label className="field">
              <span>Tên thư mục</span>
              <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="vd. my-api" pattern="[A-Za-z0-9][A-Za-z0-9._\-]*" />
            </label>
            <label className="check">
              <input type="checkbox" checked={gitInit} onChange={(e) => setGitInit(e.target.checked)} /> Chạy <code>git init</code>
            </label>
            <div className="row gap">
              <button className="btn primary" disabled={!name.trim()}>
                Tạo
              </button>
              <button type="button" className="btn ghost" onClick={() => setCreating(false)}>
                Huỷ
              </button>
            </div>
          </form>
        )}
        {error && <div className="error-box">{error}</div>}
        {!projects ? (
          <div className="muted">Đang tải…</div>
        ) : projects.length === 0 ? (
          <div className="empty">Workspace chưa có project nào. Tạo project mới để bắt đầu.</div>
        ) : (
          <ul className="project-grid">
            {projects.map((p) => (
              <li key={p.name}>
                <a className="card project-card" href={`#/p/${enc(p.name)}`}>
                  <div className="project-name">
                    <span className="folder-icon" aria-hidden>
                      ▣
                    </span>
                    {p.name}
                    {busy.includes(p.name) && <span className="dot running" title="Có session đang chạy" />}
                  </div>
                  <div className="muted small">
                    {p.git ? 'git · ' : ''}cập nhật {timeAgo(p.mtime)}
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
