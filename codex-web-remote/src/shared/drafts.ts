export type Draft = {
  text: string;
  base: string;
  version: string;
  dirty: boolean;
  changed?: boolean;
  missing?: boolean;
  conflict?: { text: string; version: string };
};
export function diskUpdate<T extends Draft>(
  tab: T,
  disk: { text: string; version: string },
): T & Draft {
  if (tab.dirty)
    return {
      ...tab,
      changed: tab.changed || disk.version !== tab.version,
      missing: false,
    };
  return {
    ...tab,
    text: disk.text,
    base: disk.text,
    version: disk.version,
    changed: disk.version !== tab.version,
    missing: false,
  };
}
export function savedUpdate<T extends Draft>(
  tab: T,
  sentText: string,
  saved: { text: string; version: string },
): T & Draft {
  const text = tab.text === sentText ? saved.text : tab.text;
  return {
    ...tab,
    text,
    base: saved.text,
    version: saved.version,
    dirty: text !== saved.text,
    changed: false,
    conflict: undefined,
  };
}
