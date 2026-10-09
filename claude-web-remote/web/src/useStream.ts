import { useEffect, useRef, useState } from 'react';
import type { StreamEvent } from './timeline';

export type StreamStatus = 'connecting' | 'open' | 'reconnecting';

/**
 * One EventSource per (project, session). The browser reconnects by itself and
 * sends Last-Event-ID, so the server replays only what we missed.
 */
export function useStream(project: string | null, session: string | null, onEvent: (ev: StreamEvent) => void): StreamStatus {
  const [status, setStatus] = useState<StreamStatus>('connecting');
  const handler = useRef(onEvent);
  handler.current = onEvent;

  useEffect(() => {
    const qs = new URLSearchParams();
    if (project) qs.set('project', project);
    if (session) qs.set('session', session);
    const es = new EventSource(`/api/stream?${qs.toString()}`);
    setStatus('connecting');
    es.onopen = () => setStatus('open');
    es.onerror = () => setStatus('reconnecting');
    es.onmessage = (m) => {
      try {
        const data = JSON.parse(m.data) as StreamEvent;
        handler.current(data);
      } catch {
        /* ignore malformed frame */
      }
    };
    return () => es.close();
  }, [project, session]);

  return status;
}

/** Re-render every `ms` while `active` (for countdowns). */
export function useTicker(active: boolean, ms = 1000): number {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [active, ms]);
  return now;
}
