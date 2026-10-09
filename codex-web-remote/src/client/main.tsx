import React, {
  useState,
  useEffect,
  useRef,
  useCallback,
  lazy,
  Suspense,
} from "react";
import { createRoot } from "react-dom/client";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { reconcile, itemText, type Item } from "../shared/timeline";
import "./style.css";
import { diskUpdate, savedUpdate } from "../shared/drafts";
import { requestId } from "../shared/request-id";
import { Icon, type IconName } from "./icon";
import { StatusPanel } from "./status-panel";
import { copyText } from "./clipboard";
import {
  sessionModel,
  effortLabel,
  contextUsage,
  quotaWindows,
  number,
} from "./usage";
const Editor = lazy(() => import("./editor"));
let csrf = "";
async function api(
  url: string,
  body?: unknown,
  method = body ? "POST" : "GET",
) {
  const res = await fetch("/api" + url, {
    method,
    headers: {
      ...(body
        ? { "Content-Type": "application/json", "X-CSRF-Token": csrf }
        : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}
const qs = (v: Record<string, string>) => new URLSearchParams(v).toString();
const stateLabel = (state: string) =>
  (
    ({
      running: "Đang chạy",
      waiting_input: "Chờ trả lời",
      waiting_approval: "Chờ duyệt",
      idle: "Sẵn sàng",
      unknown: "Chưa xác định",
      failed: "Có lỗi",
      interrupted: "Đã dừng",
    }) as Record<string, string>
  )[state] || state;
type Tab = {
  project: string;
  path: string;
  text: string;
  base: string;
  version: string;
  dirty: boolean;
  changed?: boolean;
  missing?: boolean;
  conflict?: { text: string; version: string };
  preview?: boolean;
};
const tabId = (t: { project: string; path: string }) =>
  t.project + "::" + t.path;
function App() {
  const [auth, setAuth] = useState<any>(null),
    [boot, setBoot] = useState(true),
    [password, setPassword] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [loginBusy, setLoginBusy] = useState(false),
    [newChatBusy, setNewChatBusy] = useState(false);
  const [projects, setProjects] = useState<any>({ roots: [], data: [] }),
    [project, setProject] = useState(""),
    [page, setPage] = useState("Sessions"),
    [status, setStatus] = useState<any>(null),
    [showStatus, setShowStatus] = useState(false),
    [dark, setDark] = useState(() => {
      try {
        const saved = localStorage.getItem("codex-remote-theme");
        return saved
          ? saved === "dark"
          : window.matchMedia("(prefers-color-scheme: dark)").matches;
      } catch {
        return true;
      }
    }),
    [hiddenPanels, setHiddenPanels] = useState<string[]>([]);
  const [threads, setThreads] = useState<any[]>([]),
    [listCursor, setListCursor] = useState<string | null>(null),
    [filters, setFilters] = useState({
      mode: "all",
      search: "",
      state: "",
      source: "",
      archived: false,
    }),
    [listBusy, setListBusy] = useState(false);
  const [selected, setSelected] = useState<any>(null),
    [items, setItems] = useState<Item[]>([]),
    [historyCursor, setHistoryCursor] = useState<string | null>(null),
    [snapshotReady, setSnapshotReady] = useState(false),
    [pending, setPending] = useState<any[]>([]),
    [streamState, setStreamState] = useState("Chỉ lịch sử"),
    [gap, setGap] = useState(false),
    [prompt, setPrompt] = useState(""),
    [model, setModel] = useState(""),
    [effort, setEffort] = useState(""),
    [sendBusy, setSendBusy] = useState(false),
    [searchLog, setSearchLog] = useState(""),
    [visibleItems, setVisibleItems] = useState(400),
    [clock, setClock] = useState(Date.now());
  const [tree, setTree] = useState<Record<string, any[]>>({}),
    [hidden, setHidden] = useState(false),
    [tabs, setTabs] = useState<Tab[]>([]),
    [current, setCurrent] = useState(""),
    [editing, setEditing] = useState(false),
    [fileMenu, setFileMenu] = useState<string | null>(null),
    [dialog, setDialog] = useState<any>(null),
    [answer, setAnswer] = useState<Record<string, string>>({});
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;
  const selectionRef = useRef(selected);
  selectionRef.current = selected;
  const listEpoch = useRef(0);
  const threadsRef = useRef(threads);
  threadsRef.current = threads;
  const listBusyRef = useRef(listBusy);
  listBusyRef.current = listBusy;
  const cursorRef = useRef(0),
    epoch = useRef(0),
    bottom = useRef(true),
    timeline = useRef<HTMLDivElement>(null);
  const [newOutput, setNewOutput] = useState(false);
  const tab = tabs.find((t) => tabId(t) === current);
  const running = ["running", "waiting_input", "waiting_approval"].includes(
    selected?.state,
  );
  const overlaps = (a: string, b: string) =>
    !!a && !!b && (a === b || a.startsWith(b + "/") || b.startsWith(a + "/"));
  const isBusy = (cwd: string) =>
    threads.some(
      (t) =>
        overlaps(t.cwd, cwd) &&
        ["running", "waiting_input", "waiting_approval"].includes(t.state),
    ) ||
    (running && overlaps(selected?.cwd, cwd));
  const projectBusy = isBusy(project);
  const readonly =
    selected?.cwd === project && selected?.projectAllowed === false;
  const activeModel = sessionModel(selected, status?.models);
  const nextModel = model || activeModel.model;
  const nextCatalog = status?.models?.find((m: any) => m.model === nextModel);
  const nextEffort = effort || activeModel.effort;
  const usageForSelection =
    status?.threadId === selected?.id ? status?.sessionUsage : null;
  const context = contextUsage(usageForSelection?.value);
  const quotas = quotaWindows(status?.quota);
  const canChat = !!(
    status?.ready &&
    (status?.account?.type || status?.account?.requiresOpenaiAuth === false)
  );
  const logout = () =>
    safe(async () => {
      await api("/logout", {});
      csrf = "";
      setAuth(null);
      setSelected(null);
      setShowStatus(false);
    });
  const safe = async (fn: () => Promise<any>) => {
    setError("");
    try {
      return await fn();
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", dark ? "#101317" : "#f6f7f9");
    try {
      localStorage.setItem("codex-remote-theme", dark ? "dark" : "light");
    } catch {}
  }, [dark]);
  useEffect(() => {
    if (!dialog && !showStatus) return;
    const previous = document.activeElement as HTMLElement | null;
    const modal = document.querySelector<HTMLElement>(".overlay [role=dialog]");
    const controls = () =>
      Array.from(
        modal?.querySelectorAll<HTMLElement>(
          'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],summary,[tabindex="0"]',
        ) || [],
      ).filter((el) => el.getClientRects().length);
    (controls()[0] || modal)?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setDialog(null);
        setShowStatus(false);
      }
      if (e.key !== "Tab") return;
      const els = controls(),
        first = els[0],
        last = els.at(-1);
      if (!first) {
        e.preventDefault();
        modal?.focus();
        return;
      }
      if (
        e.shiftKey &&
        (document.activeElement === first || document.activeElement === modal)
      ) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("keydown", key);
      previous?.focus();
    };
  }, [dialog?.type, showStatus]);
  useEffect(() => {
    const t = setInterval(() => setClock(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    api("/me")
      .then((m) => {
        csrf = m.csrf;
        setAuth(m);
      })
      .catch(() => {})
      .finally(() => setBoot(false));
  }, []);
  const refreshProjects = useCallback(async () => {
    setProjects(await api("/projects"));
  }, []);
  const statusEpoch = useRef(0);
  const usageRevision = useRef(0);
  const refreshStatus = useCallback(async () => {
    const request = ++statusEpoch.current;
    const id = selectionRef.current?.id;
    const revision = usageRevision.current;
    try {
      const result = await api(
        "/status" + (id ? "?thread=" + encodeURIComponent(id) : ""),
      );
      if (request !== statusEpoch.current || selectionRef.current?.id !== id)
        return;
      setStatus((previous: any) => ({
        ...result,
        sessionUsage:
          previous?.threadId === id && revision !== usageRevision.current
            ? previous.sessionUsage
            : result.sessionUsage,
      }));
    } catch (e) {
      if (request !== statusEpoch.current || selectionRef.current?.id !== id)
        return;
      setStatus((s: any) =>
        s
          ? { ...s, ready: false, stale: true, error: (e as Error).message }
          : null,
      );
    }
  }, []);
  useEffect(() => {
    if (auth) void refreshStatus();
  }, [selected?.id, auth, refreshStatus]);
  const loadThreads = useCallback(
    async (more = false, background = false) => {
      if (!auth) return;
      const requestEpoch = ++listEpoch.current;
      setListBusy(true);
      try {
        const q: any = {
          search: filters.search,
          state: filters.state,
          source: filters.source,
          archived: String(filters.archived),
        };
        if (filters.mode === "project" && project) q.project = project;
        if (more && listCursor) q.cursor = listCursor;
        const r = await api("/threads?" + qs(q));
        if (background) {
          const target = threadsRef.current.length;
          const visited = new Set<string>();
          while (r.nextCursor && r.data.length < target && visited.size < 50) {
            if (requestEpoch !== listEpoch.current || visited.has(r.nextCursor))
              return;
            visited.add(r.nextCursor);
            const next = await api(
              "/threads?" + qs({ ...q, cursor: r.nextCursor }),
            );
            r.data.push(...next.data);
            r.nextCursor = next.nextCursor;
          }
        }
        if (requestEpoch !== listEpoch.current) return;
        setThreads((prev) => {
          const rows = more ? [...prev, ...r.data] : r.data;
          return [
            ...new Map(rows.map((t: any) => [t.id, t])).values(),
          ] as any[];
        });
        setListCursor(r.nextCursor);
      } catch (e) {
        if (requestEpoch !== listEpoch.current) return;
        setError((e as Error).message);
      } finally {
        if (requestEpoch === listEpoch.current) setListBusy(false);
      }
    },
    [auth, filters, project, listCursor],
  );
  const loadThreadsRef = useRef(loadThreads);
  loadThreadsRef.current = loadThreads;
  useEffect(() => {
    if (!auth) return;
    void refreshProjects();
    void refreshStatus();
    const timer = setInterval(() => void refreshStatus(), 15000);
    return () => clearInterval(timer);
  }, [auth]);
  useEffect(() => {
    if (auth) void loadThreads();
  }, [auth, filters, project]);
  useEffect(() => {
    if (!auth) return;
    const refresh = () => {
      if (!document.hidden && !listBusyRef.current)
        void loadThreadsRef.current(false, true);
    };
    const timer = setInterval(refresh, 5000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, [auth]);
  const loadTree = useCallback(
    async (p = "", cwd = project) => {
      if (!cwd) return;
      try {
        const r = await api(
          "/tree?" + qs({ project: cwd, path: p, hidden: String(hidden) }),
        );
        setTree((prev) => ({ ...prev, [p]: r }));
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [project, hidden],
  );
  useEffect(() => {
    setTree({});
    if (project && !readonly) void loadTree();
  }, [project, hidden, readonly]);
  useEffect(() => {
    if (!auth || !project || readonly) return;
    const es = new EventSource("/api/watch?" + qs({ project }));
    es.onmessage = (e) => {
      const v = JSON.parse(e.data);
      if (v.error) {
        setNotice(v.error);
        return;
      }
      void loadTree();
      for (const t of tabsRef.current.filter(
        (t) =>
          t.project === project &&
          (t.path === v.path || t.path.startsWith(v.path + "/")),
      )) {
        if (v.type === "unlink" || v.type === "unlinkDir") {
          setTabs((prev) =>
            prev.map((x) =>
              tabId(x) === tabId(t)
                ? { ...x, changed: true, missing: true }
                : x,
            ),
          );
          continue;
        }
        api("/file?" + qs({ project: t.project, path: t.path }))
          .then((f) =>
            setTabs((prev) =>
              prev.map((x) => (tabId(x) === tabId(t) ? diskUpdate(x, f) : x)),
            ),
          )
          .catch(() =>
            setTabs((prev) =>
              prev.map((x) =>
                tabId(x) === tabId(t)
                  ? { ...x, changed: true, missing: true }
                  : x,
              ),
            ),
          );
      }
    };
    return () => es.close();
  }, [auth, project, readonly, loadTree]);
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent) => {
      if (tabsRef.current.some((t) => t.dirty)) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, []);
  const updateTab = (id: string, patch: Partial<Tab>) => {
    tabsRef.current = tabsRef.current.map((t) =>
      tabId(t) === id ? { ...t, ...patch } : t,
    );
    setTabs((prev) =>
      prev.map((t) => (tabId(t) === id ? { ...t, ...patch } : t)),
    );
  };
  const openFile = async (p: string, cwd = project) => {
    await safe(async () => {
      const id = tabId({ project: cwd, path: p });
      if (!tabsRef.current.some((t) => tabId(t) === id)) {
        const f = await api("/file?" + qs({ project: cwd, path: p }));
        setTabs((prev) =>
          prev.some((t) => tabId(t) === id)
            ? prev
            : [
                ...prev,
                {
                  project: cwd,
                  path: p,
                  text: f.text,
                  base: f.text,
                  version: f.version,
                  dirty: false,
                },
              ],
        );
      }
      setCurrent(id);
      setPage("Code");
      setEditing(false);
    });
  };
  const save = async () => {
    const tab = tabsRef.current.find((t) => tabId(t) === current);
    if (!tab || !tab.dirty) return;
    await safe(async () => {
      try {
        const r = await api(
          "/file",
          {
            project: tab.project,
            path: tab.path,
            text: tab.text,
            version: tab.version,
          },
          "PUT",
        );
        setTabs((prev) =>
          prev.map((x) =>
            tabId(x) === tabId(tab) ? savedUpdate(x, tab.text, r) : x,
          ),
        );
        setNotice("Đã lưu " + tab.path);
      } catch (e) {
        if (
          (e as Error).message.includes("đổi") ||
          (e as Error).message.includes("draft")
        ) {
          const latest = await api(
            "/file?" + qs({ project: tab.project, path: tab.path }),
          );
          updateTab(current, { conflict: latest, changed: true });
        }
        throw e;
      }
    });
  };
  const saveRef = useRef(save);
  saveRef.current = save;
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        void saveRef.current();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, []);
  const closeTab = (t: Tab) => {
    if (t.dirty) {
      setDialog({ type: "close", tab: t });
      return;
    }
    setTabs((prev) => prev.filter((x) => tabId(x) !== tabId(t)));
    if (current === tabId(t)) setCurrent("");
  };
  const selectThread = async (t: any) => {
    const n = ++epoch.current;
    setSnapshotReady(false);
    setSelected(t);
    setModel("");
    setEffort("");
    setProject(t.cwd || "");
    setPage("Chat");
    setItems([]);
    setVisibleItems(400);
    setPending([]);
    setGap(false);
    setStreamState("Đang kết nối lại");
    cursorRef.current = 0;
    await safe(async () => {
      const [meta, h] = await Promise.all([
        api("/threads/" + t.id),
        api("/threads/" + t.id + "/history"),
      ]);
      if (epoch.current !== n) return;
      setSelected(meta);
      const historical = h.data
        .slice()
        .reverse()
        .flatMap((turn: any) =>
          turn.items.map((i: any) => ({ ...i, turnId: turn.id })),
        );
      let live: Item[] = [];
      let cursor = 0;
      let gap = false;
      for (let page = 0; page < 1000; page++) {
        const j = await api("/threads/" + t.id + "/journal?after=" + cursor);
        if (epoch.current !== n) return;
        gap ||= j.gap;
        for (const row of j.data) {
          live = reconcile(live, row.event);
          cursor = row.seq;
        }
        if (j.data.length < 500) break;
        if (page === 999) gap = true;
      }
      const canonical = new Map(
        historical.map((i: Item) => [i.turnId + "::" + i.id, i]),
      );
      for (const i of live) canonical.set(i.turnId + "::" + i.id, i);
      setItems([...canonical.values()] as Item[]);
      setGap(gap);
      cursorRef.current = cursor;
      setHistoryCursor(h.nextCursor);
      const [latest, requests] = await Promise.all([
        api("/threads/" + t.id),
        api("/threads/" + t.id + "/pending"),
      ]);
      if (epoch.current !== n) return;
      setSelected(latest);
      setPending(requests);
      setStreamState(latest.readonly ? "Chỉ lịch sử" : "Live");
      setSnapshotReady(true);
    });
  };
  useEffect(() => {
    if (!selected?.id || !snapshotReady) return;
    const id = selected.id;
    if (selected.readonly) return;
    const es = new EventSource(
      "/api/threads/" + id + "/events?after=" + cursorRef.current,
    );
    es.onopen = () => setStreamState("Live");
    es.onerror = () => setStreamState("Đang kết nối lại");
    es.onmessage = (e) => {
      const row = JSON.parse(e.data);
      if (row.seq && row.seq <= cursorRef.current) return;
      if (row.seq) cursorRef.current = row.seq;
      const v = row.event;
      setItems((prev) => reconcile(prev, v));
      if (
        v.method === "thread/tokenUsage/updated" &&
        v.params.threadId === id
      ) {
        usageRevision.current++;
        setStatus((previous: any) => ({
          ...previous,
          threadId: id,
          sessionUsage: {
            source: v.method,
            at: Date.now(),
            stale: false,
            value: v.params.tokenUsage,
          },
        }));
      }
      if (v.method === "web/gap" || v.method === "web/storageError") {
        setGap(true);
        setNotice(v.params.message);
      }
      if (v.method === "web/runtimeStatus" && !v.params.ready) {
        setStreamState("Chỉ lịch sử");
        setSelected((p: any) => ({ ...p, state: "unknown" }));
        setPending([]);
        setStatus((p: any) => ({
          ...p,
          ready: false,
          stale: true,
          error: v.params.error,
        }));
        setThreads((prev) =>
          prev.map((t) =>
            t.ownership === "Web quản lý" ? { ...t, state: "unknown" } : t,
          ),
        );
      }
      if (v.id !== undefined) {
        setPending((prev) => [...prev.filter((p) => p.id !== v.id), v]);
        setSelected((prev: any) => ({
          ...prev,
          state: v.method.includes("requestUserInput")
            ? "waiting_input"
            : "waiting_approval",
        }));
      }
      if (v.method === "web/requestResolved")
        setPending((prev) => prev.filter((p) => p.id !== v.params.id));
      if (v.method === "turn/started")
        setSelected((prev: any) => ({
          ...prev,
          state: "running",
          startedAt: v.params.turn.startedAt
            ? v.params.turn.startedAt * 1000
            : Date.now(),
          lastTurn: v.params.turn.id,
        }));
      if (v.method === "turn/completed") {
        setThreads((prev) =>
          prev.map((t) =>
            t.id === id
              ? {
                  ...t,
                  state:
                    v.params.turn.status === "completed"
                      ? "idle"
                      : v.params.turn.status,
                }
              : t,
          ),
        );
        setSelected((prev: any) => ({
          ...prev,
          state:
            v.params.turn.status === "completed"
              ? "idle"
              : v.params.turn.status,
        }));
        setPending([]);
        void loadThreads();
        void loadTree();
        void refreshStatus();
      }
    };
    return () => es.close();
  }, [selected?.id, selected?.readonly, snapshotReady]);
  useEffect(() => {
    if (bottom.current)
      timeline.current?.scrollTo({ top: timeline.current.scrollHeight });
    else setNewOutput(true);
  }, [items, pending]);
  const historyMore = async () =>
    safe(async () => {
      const r = await api(
        "/threads/" +
          selected.id +
          "/history?cursor=" +
          encodeURIComponent(historyCursor!),
      );
      const older = r.data
        .slice()
        .reverse()
        .flatMap((t: any) => t.items.map((i: any) => ({ ...i, turnId: t.id })));
      setItems((prev) => {
        const map = new Map(
          [...older, ...prev].map((i: Item) => [i.turnId + "::" + i.id, i]),
        );
        return [...map.values()];
      });
      setHistoryCursor(r.nextCursor);
    });
  const send = async () => {
    if (sendBusy || newChatBusy || !snapshotReady) return;
    const id = selected.id;
    setSendBusy(true);
    await safe(async () => {
      const text = prompt;
      const r = await api("/threads/" + id + "/turn", {
        prompt: text,
        clientRequestId: requestId(),
        model: model || undefined,
        effort: effort || undefined,
      });
      if (r.state === "unknown")
        setNotice("Kết quả dispatch chưa xác minh; không tự gửi lại");
      else {
        if (selectionRef.current?.id === id) {
          setPrompt((current) => (current === text ? "" : current));
          setSelected((p: any) =>
            p.id !== id
              ? p
              : {
                  ...p,
                  state:
                    p.lastTurn === r.turn?.id &&
                    ["idle", "interrupted", "failed"].includes(p.state)
                      ? p.state
                      : "running",
                  policy: r.policy || p.policy,
                  lastTurn: r.turn?.id,
                },
          );
        }
      }
    });
    setSendBusy(false);
  };
  const newChat = async () => {
    if (newChatBusy) return;
    const previousSnapshot = snapshotReady;
    const previousId = selectionRef.current?.id;
    setNewChatBusy(true);
    setSnapshotReady(false);
    try {
      const created = await safe(async () => {
        const t = await api("/threads", { project, model: model || undefined });
        await loadThreads();
        await selectThread(t);
        return true;
      });
      if (!created && selectionRef.current?.id === previousId)
        setSnapshotReady(previousSnapshot);
    } finally {
      setNewChatBusy(false);
    }
  };
  const steer = async () => {
    if (sendBusy || !prompt.trim() || !running || selected?.readonly) return;
    setSendBusy(true);
    const id = selected.id;
    const text = prompt;
    try {
      await safe(async () => {
        const r = await api("/threads/" + id + "/steer", {
          prompt: text,
          clientRequestId: requestId(),
        });
        if (r.state === "unknown") {
          setNotice("Kết quả Steer chưa xác minh; không tự gửi lại");
          return;
        }
        if (selectionRef.current?.id === id)
          setPrompt((current) => (current === text ? "" : current));
        setNotice("Đã gửi hướng dẫn bổ sung cho turn đang chạy");
      });
    } finally {
      setSendBusy(false);
    }
  };
  const submitDialog = async (e: React.FormEvent) => {
    e.preventDefault();
    await safe(async () => {
      const d = dialog;
      if (d.type === "project") {
        const r = await api("/projects", {
          root: d.root,
          name: d.value,
          git: d.git,
        });
        await refreshProjects();
        setProject(r.path);
      }
      if (d.type === "create")
        await api("/files", {
          project,
          path: (d.parent ? d.parent + "/" : "") + d.value,
          folder: d.folder,
        });
      if (d.type === "rename") {
        const parent = d.path.includes("/")
          ? d.path.slice(0, d.path.lastIndexOf("/"))
          : "";
        const to = (parent ? parent + "/" : "") + d.value;
        await api("/rename", { project, from: d.path, to });
        setTabs((prev) =>
          prev.map((t) =>
            t.project === project &&
            (t.path === d.path || t.path.startsWith(d.path + "/"))
              ? { ...t, path: to + t.path.slice(d.path.length) }
              : t,
          ),
        );
        setCurrent((cur) =>
          cur === tabId({ project, path: d.path }) ||
          cur.startsWith(tabId({ project, path: d.path }) + "/")
            ? tabId({ project, path: to }) +
              cur.slice(tabId({ project, path: d.path }).length)
            : cur,
        );
      }
      if (d.type === "threadName") {
        await api("/threads/" + selected.id + "/name", { name: d.value });
        setSelected((prev: any) => ({ ...prev, name: d.value }));
        void loadThreads();
      }
      setDialog(null);
      void loadTree();
    });
  };
  const respond = async (p: any, decision?: string) =>
    safe(async () => {
      const answers = Object.fromEntries(
        (p.params.questions || []).map((q: any) => [
          q.id,
          { answers: [answer[q.id] || ""] },
        ]),
      );
      await api("/threads/" + selected.id + "/respond", {
        id: p.id,
        ...(decision ? { decision } : { answers }),
      });
      setPending((prev) => prev.filter((x) => x.id !== p.id));
    });
  const renderTree = (p = ""): React.ReactNode =>
    (tree[p] || []).map((e) => (
      <div key={e.path} className="tree-entry">
        <div className="tree-row">
          <button
            className="tree-name"
            onClick={() =>
              e.type === "folder"
                ? tree[e.path]
                  ? setTree((prev) => {
                      const n = { ...prev };
                      delete n[e.path];
                      return n;
                    })
                  : void loadTree(e.path)
                : void openFile(e.path)
            }
          >
            <Icon name={e.type === "folder" ? "folder" : "file"} />
            <span>{e.name}</span>
          </button>
          <button
            aria-label={"Thao tác " + e.name}
            onClick={() => setFileMenu(fileMenu === e.path ? null : e.path)}
          >
            <Icon name="more" />
          </button>
        </div>
        {fileMenu === e.path && (
          <div className="context">
            <button
              onClick={() => {
                setDialog({
                  type: "create",
                  parent: e.type === "folder" ? e.path : p,
                  folder: false,
                  value: "",
                });
                setFileMenu(null);
              }}
            >
              Tạo file
            </button>
            <button
              onClick={() => {
                setDialog({
                  type: "create",
                  parent: e.type === "folder" ? e.path : p,
                  folder: true,
                  value: "",
                });
                setFileMenu(null);
              }}
            >
              Tạo folder
            </button>
            <button
              onClick={() => {
                setDialog({ type: "rename", path: e.path, value: e.name });
                setFileMenu(null);
              }}
            >
              Đổi tên
            </button>
            <button
              onClick={() =>
                void safe(async () => {
                  await copyText(project + "/" + e.path);
                  setNotice("Đã copy đường dẫn");
                })
              }
            >
              Copy path
            </button>
            <button
              onClick={() => {
                setPrompt((v) => v + " " + e.path);
                setPage("Chat");
              }}
            >
              Chèn vào prompt
            </button>
          </div>
        )}
        {tree[e.path] && (
          <div className="tree-children">{renderTree(e.path)}</div>
        )}
      </div>
    ));
  if (boot)
    return (
      <main className="login">
        <p>Đang kết nối…</p>
      </main>
    );
  if (!auth)
    return (
      <main className="login">
        <button
          className="login-theme theme-toggle"
          aria-label="Đổi theme"
          onClick={() => setDark((v) => !v)}
        >
          <Icon name={dark ? "sun" : "moon"} />
          {dark ? "Sáng" : "Tối"}
        </button>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (loginBusy) return;
            setLoginBusy(true);
            void safe(async () => {
              const r = await api("/login", { password });
              csrf = r.csrf;
              setAuth(await api("/me"));
              setPassword("");
            }).finally(() => setLoginBusy(false));
          }}
        >
          <div className="logo">
            <Icon name="terminal" />
          </div>
          <span className="eyebrow">KHÔNG GIAN LÀM VIỆC</span>
          <h1>Codex Remote</h1>
          <p>
            Mở workspace. Tiếp tục công việc.
            <br />Ở bất cứ đâu bạn cần.
          </p>
          <label>
            Mật khẩu
            <input
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </label>
          <button
            className="primary"
            disabled={loginBusy}
            aria-label="Đăng nhập"
          >
            {loginBusy ? "Đang đăng nhập…" : "Đăng nhập"}{" "}
            <Icon name="chevron" />
          </button>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <small className="login-note">
            <Icon name="shield" /> Dùng mật khẩu của workspace này.
          </small>
        </form>
      </main>
    );
  return (
    <div
      className={
        "app " +
        (dark ? "dark" : "light") +
        " " +
        hiddenPanels.map((p) => "hide-" + p).join(" ")
      }
    >
      <header>
        <div className="brand">
          <span className="logo small">
            <Icon name="terminal" />
          </span>
          <div>
            <strong>{auth.name}</strong>
            <small>{auth.label} · Không gian làm việc</small>
          </div>
        </div>
        <div className="header-actions">
          <div className="desktop-panels">
            {["sessions", "files", "chat"].map((p) => (
              <button
                key={p}
                aria-label={"Ẩn/hiện " + p}
                aria-pressed={!hiddenPanels.includes(p)}
                className={
                  !hiddenPanels.includes(p)
                    ? "panel-toggle active"
                    : "panel-toggle"
                }
                onClick={() =>
                  setHiddenPanels((prev) =>
                    prev.includes(p)
                      ? prev.filter((v) => v !== p)
                      : [...prev, p],
                  )
                }
              >
                <Icon name={p === "files" ? "folder" : (p as IconName)} />
                {p === "sessions"
                  ? "Sessions"
                  : p === "files"
                    ? "Files"
                    : "Chat"}
              </button>
            ))}
          </div>
          <button
            aria-label="Mức sử dụng / Trạng thái"
            title="Mức sử dụng / Trạng thái"
            onClick={() => {
              setShowStatus(true);
              void refreshStatus();
            }}
          >
            <span className={"dot " + (status?.ready ? "online" : "")} />
            <span className="status-button-label">
              Mức sử dụng / Trạng thái
            </span>
          </button>
          <button
            className="theme-toggle"
            aria-label="Đổi theme"
            title={
              dark ? "Chuyển sang giao diện sáng" : "Chuyển sang giao diện tối"
            }
            onClick={() => setDark((v) => !v)}
          >
            <Icon name={dark ? "sun" : "moon"} />
            <span>{dark ? "Sáng" : "Tối"}</span>
          </button>
          <button
            onClick={() =>
              void safe(async () => {
                await api("/logout", {});
                csrf = "";
                setAuth(null);
                setSelected(null);
              })
            }
          >
            <Icon name="logout" />
            <span className="logout-label">Đăng xuất</span>
          </button>
        </div>
      </header>
      <div className="project-bar">
        <span className="project-label">
          <Icon name="folder" /> Workspace
        </span>
        <select
          aria-label="Project"
          value={project}
          onChange={(e) => setProject(e.target.value)}
        >
          <option value="">Chọn project…</option>
          {projects.data.map((p: any) => (
            <option key={p.path} value={p.path}>
              {p.name}
            </option>
          ))}
          {project && !projects.data.some((p: any) => p.path === project) && (
            <option value={project}>{project} (session chỉ đọc)</option>
          )}
        </select>
        <button
          aria-label="＋ Project"
          onClick={() =>
            setDialog({
              type: "project",
              root: projects.roots[0],
              value: "",
              git: false,
            })
          }
        >
          <Icon name="plus" />
          Project
        </button>
        <button
          className="primary"
          aria-label="＋ Chat mới"
          disabled={
            !project || readonly || !canChat || projectBusy || newChatBusy
          }
          title={
            !project
              ? "Chọn workspace trước"
              : projectBusy
                ? "Đang có turn chạy hoặc chờ phản hồi trong workspace"
                : !canChat
                  ? "Codex chưa sẵn sàng"
                  : "Tạo một cuộc trò chuyện mới"
          }
          onClick={() => void newChat()}
        >
          <Icon name="plus" />
          {newChatBusy ? "Đang tạo…" : "Chat mới"}
        </button>
        <small className="project-path">
          {project || "View all · cùng Codex home"}
        </small>
      </div>
      {error && (
        <div role="alert" className="banner error">
          {error}
          <button aria-label="Đóng lỗi" onClick={() => setError("")}>
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="banner" role="status">
          {notice}
          <button aria-label="Đóng thông báo" onClick={() => setNotice("")}>
            <Icon name="close" />
          </button>
        </div>
      )}
      <nav className="mobile-nav">
        {["Sessions", "Files", "Code", "Chat"].map((p) => (
          <button
            key={p}
            className={page === p ? "active" : ""}
            aria-current={page === p ? "page" : undefined}
            onClick={() => setPage(p)}
          >
            <Icon
              name={p === "Files" ? "folder" : (p.toLowerCase() as IconName)}
            />
            {p}
          </button>
        ))}
      </nav>
      <main className={"workspace show-" + page.toLowerCase()}>
        <aside className="sessions panel">
          <div className="panel-title">
            <h2>
              <Icon name="sessions" />
              Sessions <span className="panel-count">{threads.length}</span>
            </h2>
            <button
              aria-label="Refresh sessions"
              onClick={() => void loadThreads()}
            >
              <Icon name="refresh" className={listBusy ? "refreshing" : ""} />
            </button>
          </div>
          <div className="segmented">
            <button
              className={filters.mode === "all" ? "active" : ""}
              onClick={() => setFilters({ ...filters, mode: "all" })}
            >
              View all
            </button>
            <button
              className={filters.mode === "project" ? "active" : ""}
              disabled={!project}
              onClick={() => setFilters({ ...filters, mode: "project" })}
            >
              Project hiện tại
            </button>
          </div>
          <input
            aria-label="Tìm session"
            placeholder="Tìm tên / preview…"
            value={filters.search}
            onChange={(e) => setFilters({ ...filters, search: e.target.value })}
          />
          <div className="filters">
            <select
              aria-label="Trạng thái session"
              value={filters.state}
              onChange={(e) =>
                setFilters({ ...filters, state: e.target.value })
              }
            >
              <option value="">Mọi trạng thái</option>
              {[
                "running",
                "waiting_input",
                "waiting_approval",
                "idle",
                "unknown",
                "failed",
                "interrupted",
              ].map((s) => (
                <option key={s} value={s}>
                  {stateLabel(s)}
                </option>
              ))}
            </select>
            <select
              aria-label="Nguồn session"
              value={filters.source}
              onChange={(e) =>
                setFilters({ ...filters, source: e.target.value })
              }
            >
              <option value="">Mọi nguồn</option>
              {["cli", "appServer", "exec", "vscode", "subAgent"].map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={filters.archived}
              onChange={(e) =>
                setFilters({ ...filters, archived: e.target.checked })
              }
            />{" "}
            Archived
          </label>
          <div className="session-list">
            {threads.map((t) => (
              <button
                key={t.id}
                data-thread-id={t.id}
                className={
                  "session " + (selected?.id === t.id ? "selected" : "")
                }
                onClick={() => void selectThread(t)}
              >
                <span className="session-top">
                  <strong>{t.name || t.preview || "Chat mới"}</strong>
                  <span className={"badge " + t.state}>
                    {stateLabel(t.state)}
                  </span>
                </span>
                <span className="cwd" title={t.cwd}>
                  {t.cwd?.split("/").slice(-2).join("/") || "Chưa có workspace"}
                </span>
                <small>
                  {typeof t.source === "string" ? t.source : "Sub-agent"} ·{" "}
                  {t.ownership}
                </small>
                <small>
                  {new Date(t.updatedAt * 1000).toLocaleString("vi-VN")}
                  {t.parentThreadId ? " · Session con" : ""}
                </small>
                {t.reason && (
                  <small className="muted" title={t.reason}>
                    {t.projectAllowed ? "Chỉ đọc" : "Ngoài workspace cho phép"}
                  </small>
                )}
              </button>
            ))}
            {!threads.length && (
              <div className="empty">
                {listBusy ? "Đang tải…" : "Chưa có session trong phạm vi này."}
              </div>
            )}
            {listCursor && (
              <button
                disabled={listBusy}
                onClick={() => void loadThreads(true)}
              >
                Tải thêm session
              </button>
            )}
          </div>
        </aside>
        <section className="files panel">
          <div className="panel-title">
            <h2>
              <Icon name="folder" />
              Files
            </h2>
            <button aria-label="Refresh files" onClick={() => void loadTree()}>
              <Icon name="refresh" />
            </button>
          </div>
          {!project || readonly ? (
            <div className="empty">
              {readonly
                ? "Session chỉ đọc; chưa được truy cập project."
                : "Chọn project để mở IDE."}
            </div>
          ) : (
            <>
              <div className="file-tools">
                <button
                  aria-label="＋ File"
                  disabled={projectBusy}
                  onClick={() =>
                    setDialog({
                      type: "create",
                      parent: "",
                      folder: false,
                      value: "",
                    })
                  }
                >
                  <Icon name="plus" />
                  File
                </button>
                <button
                  aria-label="＋ Folder"
                  disabled={projectBusy}
                  onClick={() =>
                    setDialog({
                      type: "create",
                      parent: "",
                      folder: true,
                      value: "",
                    })
                  }
                >
                  <Icon name="plus" />
                  Folder
                </button>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={hidden}
                  onChange={(e) => setHidden(e.target.checked)}
                />{" "}
                Hiện thư mục ẩn
              </label>
              <small className="muted">File trong workspace đã chọn.</small>
              {projectBusy && (
                <div className="banner">
                  Codex đang chạy: khóa ghi file, giữ draft.
                </div>
              )}
              <div className="tree">{renderTree()}</div>
            </>
          )}
        </section>
        <section className="code panel">
          <div className="panel-title">
            <h2>
              <Icon name="code" />
              Editor
            </h2>
            {tab && (
              <div>
                <button
                  className="edit-mode-button"
                  onClick={() => setEditing((v) => !v)}
                >
                  {editing ? "Xem" : "Sửa"}
                </button>
                {/\.md$/.test(tab.path) && (
                  <button
                    onClick={() =>
                      updateTab(current, { preview: !tab.preview })
                    }
                  >
                    {tab.preview ? "Mã nguồn" : "Xem trước"}
                  </button>
                )}
                <button
                  className="primary"
                  disabled={!tab.dirty || isBusy(tab.project) || tab.missing}
                  onClick={() => void save()}
                >
                  <Icon name="save" />
                  Lưu
                </button>
              </div>
            )}
          </div>
          <div className="tabs">
            {tabs.map((t) => (
              <div
                key={tabId(t)}
                className={current === tabId(t) ? "active" : ""}
              >
                <button
                  onClick={() => {
                    setCurrent(tabId(t));
                    setPage("Code");
                  }}
                  title={t.project + "/" + t.path}
                >
                  {t.path.split("/").pop()}
                  {t.dirty ? " ●" : ""}
                </button>
                <button
                  aria-label={"Đóng " + t.path}
                  onClick={() => closeTab(t)}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {tab ? (
            <>
              <div className="file-info">
                {tab.project}/{tab.path} · UTF-8 · Ctrl+S
                {tab.changed ? " · File đã thay đổi trên đĩa" : ""}
              </div>
              {tab.missing && (
                <div className="banner error">
                  File đã bị xóa/đổi tên. Draft được giữ; không tự tạo lại.
                </div>
              )}
              {tab.conflict && (
                <div className="conflict">
                  <strong>Conflict · Draft được giữ</strong>
                  <details>
                    <summary>Xem diff</summary>
                    <div className="diff-columns">
                      <pre>
                        Đĩa mới:{"\n"}
                        {tab.conflict.text}
                      </pre>
                      <pre>
                        Draft:{"\n"}
                        {tab.text}
                      </pre>
                    </div>
                  </details>
                  <button onClick={() => setDialog({ type: "reload", tab })}>
                    Tải bản mới
                  </button>
                  <button onClick={() => setDialog({ type: "overwrite", tab })}>
                    Ghi đè có xác nhận
                  </button>
                </div>
              )}
              {tab.preview ? (
                <article className="markdown preview">
                  <Markdown remarkPlugins={[remarkGfm]}>{tab.text}</Markdown>
                </article>
              ) : (
                <Suspense
                  fallback={
                    <div className="empty" role="status">
                      Đang mở trình soạn thảo…
                    </div>
                  }
                >
                  <Editor
                    text={tab.text}
                    path={tab.path}
                    dark={dark}
                    editable={
                      editing ||
                      window.matchMedia("(min-width: 1101px)").matches
                    }
                    onChange={(text) =>
                      updateTab(current, { text, dirty: text !== tab.base })
                    }
                  />
                </Suspense>
              )}
            </>
          ) : (
            <div className="empty editor-empty">
              <span className="empty-icon">
                <Icon name="code" />
              </span>
              <h3>Mở một file để bắt đầu</h3>
              <p>
                Chọn file từ Files để đọc và chỉnh sửa.
                <br />
                Lưu nhanh với <kbd>Ctrl</kbd> + <kbd>S</kbd>.
              </p>
            </div>
          )}
        </section>
        <section className="chat panel">
          <div className="panel-title">
            <h2>
              <Icon name="chat" />
              Chat
            </h2>
            <span className={"badge " + (selected?.state || "")}>
              {stateLabel(selected?.state || "Chưa chọn")}
            </span>
          </div>
          {selected ? (
            <>
              <div className="chat-meta">
                <strong>
                  {selected.name || selected.preview || "Chat mới"}
                </strong>
                <div className="session-metrics" aria-label="Thông số session">
                  <span
                    className="meta-chip model-chip"
                    title="Model hiện tại của session"
                  >
                    <Icon name="chat" />
                    {activeModel.name}
                  </span>
                  <span
                    className="meta-chip effort-chip"
                    title="Mức suy luận hiện tại"
                  >
                    Suy luận: {effortLabel(activeModel.effort)}
                  </span>
                  <span
                    className="meta-chip context-chip"
                    title={
                      context
                        ? `Token trong context gần nhất: ${number(context.used)} / ${number(context.window)}. Tỷ lệ trên toàn bộ cửa sổ context, gồm hướng dẫn hệ thống; không phải tổng tích lũy. Cập nhật ${new Date(usageForSelection.at).toLocaleString("vi-VN")}`
                        : "Codex chưa cung cấp số token và kích thước cửa sổ context của session này"
                    }
                  >
                    Context:{" "}
                    {context
                      ? `${number(context.percent)}% đã dùng`
                      : "Chưa có dữ liệu"}
                    {usageForSelection?.stale ? " · Đã cũ" : ""}
                  </span>
                  {[300, 10080].map((minutes) => {
                    const quota = quotas.find(
                      (q) => q.windowDurationMins === minutes,
                    );
                    return (
                      <span
                        key={minutes}
                        className={
                          "meta-chip quota-chip" +
                          (quota?.remaining != null && quota.remaining < 20
                            ? " low"
                            : "")
                        }
                        title={
                          quota?.resetsAt
                            ? `Đặt lại vào ${new Date(quota.resetsAt * 1000).toLocaleString("vi-VN")}`
                            : "Codex chưa cung cấp hạn mức này"
                        }
                      >
                        {minutes === 300 ? "5 giờ" : "1 tuần"}:{" "}
                        {quota?.remaining != null
                          ? `${number(quota.remaining)}% còn lại`
                          : "Chưa có dữ liệu"}
                        {status?.stale ? " · Đã cũ" : ""}
                      </span>
                    );
                  })}
                </div>
                <small>
                  {streamState}
                  {running && selected.startedAt
                    ? " · " +
                      Math.max(
                        0,
                        Math.floor((clock - selected.startedAt) / 1000),
                      ) +
                      "s"
                    : ""}
                  {gap ? " · Dữ liệu chưa đầy đủ" : ""} ·{" "}
                  {new Date(selected.updatedAt * 1000).toLocaleString("vi-VN")}
                </small>
                <details className="session-details">
                  <summary>Thông tin & thao tác session</summary>
                  <small>
                    Policy:{" "}
                    {selected.policy
                      ? JSON.stringify(selected.policy)
                      : "Runtime / chưa biết"}
                  </small>
                </details>
                {selected.reason && (
                  <div className="banner">{selected.reason}</div>
                )}
                <div className="session-actions">
                  <button
                    disabled={selected.readonly || running}
                    onClick={() =>
                      setDialog({
                        type: "threadName",
                        value: selected.name || "",
                      })
                    }
                  >
                    Đổi tên
                  </button>
                  <button
                    disabled={selected.readonly || running}
                    onClick={() =>
                      void safe(async () => {
                        await api("/threads/" + selected.id + "/archive", {});
                        setSelected(null);
                        void loadThreads();
                      })
                    }
                  >
                    Archive
                  </button>
                  <a
                    className="button"
                    href={"/api/threads/" + selected.id + "/log"}
                  >
                    Tải log
                  </a>
                </div>
                <input
                  placeholder="Tìm trong output đã tải…"
                  aria-label="Tìm output"
                  value={searchLog}
                  onChange={(e) => setSearchLog(e.target.value)}
                />
              </div>
              <div
                ref={timeline}
                className="timeline"
                onScroll={() => {
                  const el = timeline.current!;
                  bottom.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 60;
                  if (bottom.current) setNewOutput(false);
                }}
              >
                {!items.length && snapshotReady && !running && (
                  <div className="empty chat-welcome">
                    <span className="empty-icon">
                      <Icon name="terminal" />
                    </span>
                    <h3>Bạn muốn làm gì hôm nay?</h3>
                    <p>
                      Mô tả công việc trong ô bên dưới.
                      <br />
                      Codex sẽ làm việc trong workspace đã chọn.
                    </p>
                  </div>
                )}
                {historyCursor && (
                  <button onClick={() => void historyMore()}>
                    Tải lịch sử trước
                  </button>
                )}
                {items
                  .filter(
                    (i) =>
                      !searchLog ||
                      itemText(i)
                        .toLowerCase()
                        .includes(searchLog.toLowerCase()),
                  )
                  .slice(-visibleItems)
                  .map((i) => (
                    <article
                      key={i.turnId + "::" + i.id}
                      className={"item " + i.type}
                    >
                      <div className="item-head">
                        <strong>
                          {i.type === "userMessage"
                            ? "Bạn"
                            : i.type === "agentMessage"
                              ? "Codex"
                              : (
                                  {
                                    commandExecution: "Lệnh & output",
                                    fileChange: "Thay đổi file",
                                    plan: "Kế hoạch",
                                    reasoning: "Tóm tắt",
                                    turnResult: "Kết quả",
                                  } as Record<string, string>
                                )[i.type] || i.type}
                        </strong>
                        {i.phase && (
                          <small>
                            {i.phase === "commentary"
                              ? "Đang xử lý"
                              : i.phase === "final_answer"
                                ? "Trả lời"
                                : i.phase}
                          </small>
                        )}
                        <button
                          aria-label="Copy output"
                          onClick={() =>
                            void safe(async () => {
                              await copyText(itemText(i));
                              setNotice("Đã copy nội dung");
                            })
                          }
                        >
                          <Icon name="copy" />
                        </button>
                      </div>
                      {i.type === "turnResult" ? (
                        <p className="turn-summary">
                          <Icon
                            name={i.status === "completed" ? "shield" : "stop"}
                          />
                          {i.status === "completed"
                            ? "Công việc đã hoàn thành."
                            : i.status === "interrupted"
                              ? "Turn đã được dừng."
                              : "Turn kết thúc với lỗi."}
                          {i.error?.message && (
                            <span className="error"> {i.error.message}</span>
                          )}
                        </p>
                      ) : [
                          "agentMessage",
                          "userMessage",
                          "plan",
                          "reasoning",
                        ].includes(i.type) ? (
                        <div className="markdown">
                          <Markdown remarkPlugins={[remarkGfm]}>
                            {itemText(i)}
                          </Markdown>
                        </div>
                      ) : (
                        <details open={itemText(i).length < 1500}>
                          <summary>
                            {i.type === "commandExecution"
                              ? i.command || "Command / output"
                              : i.type === "fileChange"
                                ? "File changes / diff"
                                : i.type === "turnResult"
                                  ? "Kết quả: " + i.status
                                  : "Xem đầy đủ"}
                          </summary>
                          <pre>{itemText(i)}</pre>
                          {i.type === "fileChange" &&
                            (i.changes || []).map((c: any) => (
                              <button
                                key={c.path}
                                disabled={selected.readonly}
                                onClick={() => {
                                  const p = c.path.startsWith(project + "/")
                                    ? c.path.slice(project.length + 1)
                                    : c.path;
                                  void openFile(p);
                                }}
                              >
                                Mở {c.path} (bản trên đĩa)
                              </button>
                            ))}
                        </details>
                      )}
                    </article>
                  ))}
                {items.length > visibleItems && (
                  <button onClick={() => setVisibleItems((v) => v + 400)}>
                    Tải 400 item trước ({items.length - visibleItems} còn lại)
                  </button>
                )}
                {!items.length && (
                  <div className="empty">
                    Gửi prompt để bắt đầu. Không tự gọi model khi mở lịch sử.
                  </div>
                )}
                {pending.map((p) => (
                  <article key={p.id} className="approval">
                    <strong>
                      {p.method.includes("requestUserInput")
                        ? "Codex cần thông tin"
                        : "Yêu cầu approval"}
                    </strong>
                    <pre>{JSON.stringify(p.params, null, 2)}</pre>
                    {p.method === "item/tool/requestUserInput" ? (
                      <>
                        {(p.params.questions || []).map((q: any) => (
                          <label key={q.id}>
                            {q.header}: {q.question}
                            {q.options?.map((o: any) => (
                              <button
                                key={o.label}
                                onClick={() =>
                                  setAnswer((prev) => ({
                                    ...prev,
                                    [q.id]: o.label,
                                  }))
                                }
                              >
                                {o.label} — {o.description}
                              </button>
                            ))}
                            <input
                              type={q.isSecret ? "password" : "text"}
                              readOnly={!!q.options?.length && !q.isOther}
                              aria-label={q.id}
                              value={answer[q.id] || ""}
                              onChange={(e) =>
                                setAnswer((prev) => ({
                                  ...prev,
                                  [q.id]: e.target.value,
                                }))
                              }
                            />
                          </label>
                        ))}
                        <button onClick={() => void respond(p)}>
                          Gửi trả lời
                        </button>
                      </>
                    ) : [
                        "item/commandExecution/requestApproval",
                        "item/fileChange/requestApproval",
                      ].includes(p.method) ? (
                      <>
                        <button onClick={() => void respond(p, "accept")}>
                          Cho phép một lần
                        </button>
                        <button onClick={() => void respond(p, "decline")}>
                          Từ chối
                        </button>
                        <button onClick={() => void respond(p, "cancel")}>
                          Hủy
                        </button>
                      </>
                    ) : (
                      <p>
                        Capability trả lời request này chưa hỗ trợ; không tự
                        approve.
                      </p>
                    )}
                  </article>
                ))}
              </div>
              {newOutput && (
                <button
                  className="new-output"
                  onClick={() => {
                    bottom.current = true;
                    timeline.current?.scrollTo({
                      top: timeline.current.scrollHeight,
                    });
                    setNewOutput(false);
                  }}
                >
                  ↓ Đến output mới nhất
                </button>
              )}
              <div className="composer">
                <div className="model-controls">
                  <select
                    aria-label="Model"
                    title="Model cho lượt tiếp theo"
                    value={model}
                    onChange={(e) => {
                      setModel(e.target.value);
                      setEffort("");
                    }}
                  >
                    <option value="">{activeModel.name} · theo session</option>
                    {status?.models?.map((m: any) => (
                      <option key={m.id} value={m.model}>
                        {m.displayName || m.model}
                      </option>
                    ))}
                  </select>
                  <select
                    aria-label="Effort"
                    title="Mức suy luận cho lượt tiếp theo"
                    value={effort}
                    onChange={(e) => setEffort(e.target.value)}
                  >
                    <option value="">
                      {effortLabel(nextEffort)} · theo session
                    </option>
                    {(nextCatalog?.supportedReasoningEfforts || []).map(
                      (e: any) => (
                        <option
                          key={e.reasoningEffort}
                          value={e.reasoningEffort}
                        >
                          {effortLabel(e.reasoningEffort)}
                        </option>
                      ),
                    )}
                  </select>
                </div>
                <textarea
                  aria-label="Prompt"
                  placeholder={
                    selected.readonly
                      ? "Session chỉ đọc"
                      : !canChat
                        ? "Codex/auth chưa sẵn sàng"
                        : "Yêu cầu Codex làm việc trong project…"
                  }
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  disabled={
                    selected.readonly ||
                    !canChat ||
                    !snapshotReady ||
                    newChatBusy
                  }
                />
                <div className="composer-footer">
                  <small>
                    {running
                      ? "Nhập hướng dẫn bổ sung rồi bấm Steer"
                      : "Model/effort áp dụng cho turn tiếp theo"}
                  </small>
                  {running && (
                    <>
                      <button
                        className="danger-action"
                        disabled={selected.readonly}
                        onClick={() =>
                          void safe(() =>
                            api("/threads/" + selected.id + "/interrupt", {}),
                          )
                        }
                      >
                        <Icon name="stop" />
                        Dừng
                      </button>
                      <button
                        disabled={
                          selected.readonly || sendBusy || !prompt.trim()
                        }
                        onClick={() => void steer()}
                      >
                        Steer
                      </button>
                    </>
                  )}
                  <button
                    className="primary"
                    disabled={
                      selected.readonly ||
                      !canChat ||
                      !snapshotReady ||
                      newChatBusy ||
                      running ||
                      sendBusy ||
                      !prompt.trim()
                    }
                    onClick={() => void send()}
                  >
                    <Icon name="send" />
                    Gửi ↑
                  </button>
                </div>
              </div>
            </>
          ) : (
            <div className="empty">
              <span className="empty-icon">
                <Icon name="chat" />
              </span>
              <h3>Chọn một session</h3>
              <p>
                Tiếp tục từ Sessions, hoặc chọn workspace
                <br />
                và bấm Chat mới để bắt đầu.
              </p>
            </div>
          )}
        </section>
      </main>
      {showStatus && (
        <div className="overlay">
          <StatusPanel
            status={status}
            close={() => setShowStatus(false)}
            refresh={() => void refreshStatus()}
            logout={() => void logout()}
          />
        </div>
      )}
      {dialog && (
        <div className="overlay">
          <form
            className="dialog"
            onSubmit={submitDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="dialog-heading"
            tabIndex={-1}
          >
            <h2 id="dialog-heading">
              {dialog.type === "project"
                ? "Tạo project"
                : dialog.type === "create"
                  ? dialog.folder
                    ? "Tạo folder"
                    : "Tạo file"
                  : dialog.type === "rename"
                    ? "Đổi tên"
                    : dialog.type === "threadName"
                      ? "Đổi tên session"
                      : "Xử lý draft"}
            </h2>
            {["close", "reload", "overwrite"].includes(dialog.type) ? (
              <>
                <p>
                  {dialog.type === "close"
                    ? "Bỏ draft chưa lưu và đóng tab?"
                    : dialog.type === "reload"
                      ? "Bỏ draft để tải bản mới trên đĩa?"
                      : "Ghi đè bản đĩa bằng draft? Version mới vẫn được kiểm tra."}
                </p>
                <button
                  type="button"
                  className="primary"
                  onClick={() => {
                    const t = dialog.tab as Tab;
                    if (dialog.type === "close") {
                      setTabs((prev) =>
                        prev.filter((x) => tabId(x) !== tabId(t)),
                      );
                      if (current === tabId(t)) setCurrent("");
                    } else if (dialog.type === "reload") {
                      updateTab(tabId(t), {
                        text: t.conflict!.text,
                        base: t.conflict!.text,
                        version: t.conflict!.version,
                        dirty: false,
                        conflict: undefined,
                        changed: false,
                      });
                    } else {
                      void safe(async () => {
                        const r = await api(
                          "/file",
                          {
                            project: t.project,
                            path: t.path,
                            text: t.text,
                            version: t.conflict!.version,
                          },
                          "PUT",
                        );
                        setTabs((prev) =>
                          prev.map((x) =>
                            tabId(x) === tabId(t)
                              ? savedUpdate(x, t.text, r)
                              : x,
                          ),
                        );
                      });
                    }
                    setDialog(null);
                  }}
                >
                  Xác nhận
                </button>
              </>
            ) : (
              <>
                {dialog.type === "project" && (
                  <>
                    <label>
                      Root
                      <select
                        value={dialog.root}
                        onChange={(e) =>
                          setDialog({ ...dialog, root: e.target.value })
                        }
                      >
                        {projects.roots.map((r: string) => (
                          <option key={r}>{r}</option>
                        ))}
                      </select>
                    </label>
                    <label className="check">
                      <input
                        type="checkbox"
                        checked={dialog.git}
                        onChange={(e) =>
                          setDialog({ ...dialog, git: e.target.checked })
                        }
                      />{" "}
                      git init
                    </label>
                  </>
                )}
                <label>
                  Tên
                  <input
                    autoFocus
                    required
                    value={dialog.value}
                    onChange={(e) =>
                      setDialog({ ...dialog, value: e.target.value })
                    }
                  />
                </label>
                <button className="primary">Thực hiện</button>
              </>
            )}
            <button type="button" onClick={() => setDialog(null)}>
              Hủy
            </button>
            {error && <p className="error">{error}</p>}
          </form>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
