export type Item = {
  id: string;
  type: string;
  turnId?: string;
  [key: string]: any;
};
export function publicItem(item: Item): Item {
  if (item.type === "reasoning") {
    const { content, ...rest } = item;
    return { ...rest, summary: item.summary || [] };
  }
  return item;
}
export function reconcile(
  items: Item[],
  event: { method: string; params: any },
): Item[] {
  const { method, params: p } = event;
  if (!p) return items;
  const list = [...items];
  const upsert = (item: Item) => {
    item = publicItem(item);
    const i = list.findIndex(
      (v) => v.id === item.id && v.turnId === item.turnId,
    );
    if (i >= 0) list[i] = item;
    else list.push(item);
  };
  if (method === "item/started" || method === "item/completed")
    upsert({ ...p.item, turnId: p.turnId });
  else if (method === "turn/completed") {
    for (const it of p.turn.items || []) upsert({ ...it, turnId: p.turn.id });
    upsert({
      id: `turn-${p.turn.id}`,
      turnId: p.turn.id,
      type: "turnResult",
      status: p.turn.status,
      error: p.turn.error,
    });
  } else if (
    /(delta|Delta)$/.test(method) &&
    !method.includes("reasoning/text")
  ) {
    const id = p.itemId;
    const index = list.findIndex((i) => i.id === id && i.turnId === p.turnId);
    let it: Item =
      index >= 0
        ? { ...list[index] }
        : {
            id,
            turnId: p.turnId,
            type: method.includes("commandExecution")
              ? "commandExecution"
              : method.includes("reasoning")
                ? "reasoning"
                : method.includes("plan")
                  ? "plan"
                  : "agentMessage",
          };
    if (method.includes("reasoning/summary")) {
      const summary = [...(it.summary || [])];
      const n = p.summaryIndex || 0;
      summary[n] = (summary[n] || "") + (p.delta || "");
      it.summary = summary;
    } else {
      const field = method.includes("commandExecution")
        ? "aggregatedOutput"
        : "text";
      it[field] = (it[field] || "") + (p.delta || "");
    }
    if (index >= 0) list[index] = it;
    else list.push(it);
  } else if (method === "turn/diff/updated")
    upsert({
      id: `diff-${p.turnId}`,
      turnId: p.turnId,
      type: "diff",
      text: p.diff,
    });
  else if (method === "turn/plan/updated")
    upsert({
      id: `plan-${p.turnId}`,
      turnId: p.turnId,
      type: "plan",
      text: p.explanation,
      plan: p.plan,
    });
  else if (method === "error" || method.startsWith("web/")) {
    if (["web/requestResolved", "web/runtimeStatus"].includes(method))
      return list;
    upsert({
      id: `${method}-${p.turnId || ""}`,
      turnId: p.turnId,
      type: "warning",
      text: p.message || JSON.stringify(p),
    });
  }
  return list;
}
export function itemText(i: Item): string {
  if (i.type === "userMessage")
    return (i.content || []).map((c: any) => c.text || c.path || "").join("\n");
  if (i.type === "reasoning") return (i.summary || []).join("\n");
  if (i.type === "commandExecution")
    return `${i.command || ""}\n${i.aggregatedOutput || ""}${i.exitCode === null || i.exitCode === undefined ? "" : `\nExit: ${i.exitCode}`}`;
  return i.text || JSON.stringify(i, null, 2);
}

export function publicEvent(event: any): any {
  if (event.method?.startsWith("item/reasoning/text")) return null;
  const p = { ...(event.params || {}) };
  if (p.item) p.item = publicItem(p.item);
  if (p.turn)
    p.turn = { ...p.turn, items: (p.turn.items || []).map(publicItem) };
  return { ...event, params: p };
}
export function publicHistory(result: any): any {
  return {
    ...result,
    data: result.data.map((turn: any) => ({
      ...turn,
      items: turn.items.map(publicItem),
    })),
  };
}
