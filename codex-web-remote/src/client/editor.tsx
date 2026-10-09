import React from "react";
import CodeMirror from "@uiw/react-codemirror";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { json } from "@codemirror/lang-json";
import { markdown } from "@codemirror/lang-markdown";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { sql } from "@codemirror/lang-sql";
import { yaml } from "@codemirror/lang-yaml";
import { StreamLanguage } from "@codemirror/language";
import { go } from "@codemirror/legacy-modes/mode/go";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { dockerFile } from "@codemirror/legacy-modes/mode/dockerfile";
function language(p: string) {
  if (/\.[jt]sx?$/.test(p))
    return javascript({ jsx: true, typescript: /\.tsx?$/.test(p) });
  if (p.endsWith(".py")) return python();
  if (p.endsWith(".json")) return json();
  if (/\.mdx?$/.test(p)) return markdown();
  if (p.endsWith(".html")) return html();
  if (p.endsWith(".css")) return css();
  if (/\.ya?ml$/.test(p)) return yaml();
  if (p.endsWith(".sql")) return sql();
  if (p.endsWith(".go")) return StreamLanguage.define(go);
  if (/\.(sh|bash)$/.test(p)) return StreamLanguage.define(shell);
  if (p.split("/").pop() === "Dockerfile")
    return StreamLanguage.define(dockerFile);
  return [];
}
export default function Editor({
  text,
  path,
  dark,
  editable,
  onChange,
}: {
  text: string;
  path: string;
  dark: boolean;
  editable: boolean;
  onChange: (text: string) => void;
}) {
  return (
    <CodeMirror
      value={text}
      height="100%"
      theme={dark ? "dark" : "light"}
      extensions={[language(path)].flat()}
      editable={editable}
      onChange={onChange}
    />
  );
}
