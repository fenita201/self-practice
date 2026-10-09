import { css } from '@codemirror/lang-css';
import { go } from '@codemirror/lang-go';
import { html } from '@codemirror/lang-html';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { python } from '@codemirror/lang-python';
import { sql } from '@codemirror/lang-sql';
import { yaml } from '@codemirror/lang-yaml';
import { StreamLanguage, type LanguageSupport } from '@codemirror/language';
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile';
import { properties } from '@codemirror/legacy-modes/mode/properties';
import { shell } from '@codemirror/legacy-modes/mode/shell';
import { toml } from '@codemirror/legacy-modes/mode/toml';
import type { Extension } from '@codemirror/state';

/** Pick a CodeMirror language from a file name. Unknown types get plain text. */
export function languageFor(path: string): { ext: Extension | null; name: string } {
  const base = path.split('/').pop()!.toLowerCase();
  const ext = base.includes('.') ? base.slice(base.lastIndexOf('.') + 1) : '';
  const lang = (l: LanguageSupport | Extension, name: string) => ({ ext: l, name });
  if (base === 'dockerfile' || base.startsWith('dockerfile.') || ext === 'dockerfile') return lang(StreamLanguage.define(dockerFile), 'Dockerfile');
  if (base === 'makefile') return lang(StreamLanguage.define(shell), 'Makefile');
  if (base.startsWith('.env') || ext === 'env' || ext === 'properties' || ext === 'ini' || ext === 'conf' || ext === 'cfg') return lang(StreamLanguage.define(properties), 'Properties');
  switch (ext) {
    case 'js':
    case 'mjs':
    case 'cjs':
      return lang(javascript(), 'JavaScript');
    case 'jsx':
      return lang(javascript({ jsx: true }), 'JSX');
    case 'ts':
    case 'mts':
    case 'cts':
      return lang(javascript({ typescript: true }), 'TypeScript');
    case 'tsx':
      return lang(javascript({ jsx: true, typescript: true }), 'TSX');
    case 'py':
    case 'pyi':
      return lang(python(), 'Python');
    case 'go':
      return lang(go(), 'Go');
    case 'json':
    case 'jsonc':
    case 'json5':
      return lang(json(), 'JSON');
    case 'yaml':
    case 'yml':
      return lang(yaml(), 'YAML');
    case 'md':
    case 'markdown':
    case 'mdx':
      return lang(markdown(), 'Markdown');
    case 'html':
    case 'htm':
    case 'vue':
    case 'svelte':
      return lang(html(), 'HTML');
    case 'css':
    case 'scss':
    case 'less':
      return lang(css(), 'CSS');
    case 'sql':
      return lang(sql(), 'SQL');
    case 'sh':
    case 'bash':
    case 'zsh':
      return lang(StreamLanguage.define(shell), 'Shell');
    case 'toml':
      return lang(StreamLanguage.define(toml), 'TOML');
    default:
      return { ext: null, name: 'Text' };
  }
}

export const isMarkdown = (path: string) => /\.(md|markdown|mdx)$/i.test(path);
