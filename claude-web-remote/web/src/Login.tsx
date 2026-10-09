import { useState, type FormEvent } from 'react';
import { api, ApiError, setCsrf } from './api';

export function Login(props: { appName: string; serverLabel: string; passwordSet: boolean; onLoggedIn: () => void }) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ csrf: string }>('POST', '/api/auth/login', { password });
      setCsrf(r.csrf);
      props.onLoggedIn();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Lỗi đăng nhập');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="login">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand">
          <span className="logo" aria-hidden>
            ◆
          </span>
          <div>
            <h1>{props.appName}</h1>
            {props.serverLabel && <div className="muted small">{props.serverLabel}</div>}
          </div>
        </div>
        {!props.passwordSet ? (
          <p className="warn-box">
            Chưa đặt password. Trên server chạy <code>npm run set-password</code> rồi tải lại trang.
          </p>
        ) : (
          <>
            <label className="field">
              <span>Password</span>
              <input type="password" autoFocus autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            </label>
            {error && <div className="error-box">{error}</div>}
            <button className="btn primary block" disabled={busy || !password}>
              {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
            </button>
          </>
        )}
      </form>
    </div>
  );
}
