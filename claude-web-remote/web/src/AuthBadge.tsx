import type { Meta } from './api';

/** Shows which credentials Claude is using on the server (never the secret itself). */
export function AuthBadge({ meta, onRefresh }: { meta: Meta | null; onRefresh: () => void }) {
  if (!meta) return null;
  const c = meta.capabilities;
  const label = !c.ok
    ? 'Claude chưa sẵn sàng'
    : c.auth.method === 'api_key'
      ? 'Claude: API key (tính phí API)'
      : `Claude: ${c.auth.subscriptionType ?? 'subscription'}`;
  const title = !c.ok ? (c.error ?? '') : [c.auth.email, c.auth.organization].filter(Boolean).join(' · ');
  return (
    <button className={`badge ${c.ok ? (c.auth.method === 'api_key' ? 'badge-warn' : 'badge-ok') : 'badge-err'}`} title={`${title}\nBấm để kiểm tra lại`} onClick={onRefresh}>
      {label}
    </button>
  );
}
