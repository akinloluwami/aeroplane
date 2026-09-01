import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import type { StringStream } from "@codemirror/language";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";

type EnvParserState = {
  inValue: boolean;
};

const envLanguage = StreamLanguage.define<EnvParserState>({
  name: "dotenv",
  startState: () => ({ inValue: false }),
  token(stream: StringStream, state) {
    if (stream.sol()) state.inValue = false;
    if (stream.eatSpace()) return null;

    const isComment = stream.peek() === "#" && (!state.inValue || /\s$/.test(stream.string.slice(0, stream.pos)));
    if (isComment) {
      stream.skipToEnd();
      return "comment";
    }

    if (!state.inValue) {
      if (stream.match(/^export\b/)) return "keyword";
      if (stream.match(/^[A-Z_][A-Z0-9_]*(?=\s*=)/i)) return "propertyName";
      if (stream.match(/^=/)) {
        state.inValue = true;
        return "operator";
      }

      stream.next();
      return null;
    }

    if (stream.match(/^\$\{[^}]*\}/)) return "variableName";
    if (stream.match(/^"(?:\\.|[^"\\])*"?/)) return "string";
    if (stream.match(/^'(?:[^']*)'?/)) return "string";
    if (stream.match(/^[^$#"']+/)) return "string";

    stream.next();
    return "string";
  },
  languageData: {
    commentTokens: { line: "#" }
  }
});

const envHighlightStyle = HighlightStyle.define([
  { tag: tags.comment, color: "#71717a", fontStyle: "italic" },
  { tag: tags.keyword, color: "#e879f9" },
  { tag: tags.propertyName, color: "#67e8f9" },
  { tag: tags.operator, color: "#a1a1aa" },
  { tag: tags.string, color: "#86efac" },
  { tag: tags.variableName, color: "#fbbf24" }
]);

const envEditorTheme = EditorView.theme(
  {
    "&": {
      height: "100%",
      backgroundColor: "rgba(255, 255, 255, 0.03)",
      color: "#e4e4e7",
      fontSize: "12px"
    },
    "&.cm-focused": {
      outline: "none"
    },
    ".cm-scroller": {
      fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      lineHeight: "24px"
    },
    ".cm-content": {
      padding: "12px",
      caretColor: "#f4f4f5"
    },
    ".cm-line": {
      padding: "0"
    },
    ".cm-cursor": {
      borderLeftColor: "#f4f4f5"
    },
    ".cm-placeholder": {
      color: "#3f3f46"
    },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": {
      backgroundColor: "rgba(255, 255, 255, 0.14)"
    },
    ".cm-activeLine": {
      backgroundColor: "rgba(39, 39, 42, 0.42)"
    },
    ".cm-gutters": {
      borderRight: "1px solid rgba(255, 255, 255, 0.1)",
      backgroundColor: "#09090b",
      color: "#52525b"
    }
  },
  { dark: true }
);

const envEditorBasicSetup = {
  foldGutter: false,
  highlightActiveLine: true,
  highlightActiveLineGutter: false,
  autocompletion: false,
  completionKeymap: false
};

export function EnvCodeEditor({
  value,
  onChange,
  disabled
}: {
  value: string;
  onChange: (value: string) => void;
  disabled: boolean;
}) {
  const extensions = useMemo(
    () => [
      envLanguage,
      syntaxHighlighting(envHighlightStyle),
      EditorView.editable.of(!disabled),
      EditorView.contentAttributes.of({
        id: "plain-environment-variables",
        "aria-label": "Environment variables",
        autocapitalize: "off",
        autocomplete: "off",
        autocorrect: "off",
        spellcheck: "false"
      }),
      envEditorTheme
    ],
    [disabled]
  );

  return (
    <div className={`mt-2 h-[28rem] min-h-64 resize-y overflow-hidden border border-white/15 bg-white/[0.03] transition focus-within:border-white focus-within:ring-2 focus-within:ring-white/10 ${disabled ? "opacity-50" : ""}`}>
      <CodeMirror
        value={value}
        height="100%"
        placeholder={"DATABASE_URL=postgres://...\nAPI_KEY=...\nNODE_ENV=production"}
        autoFocus
        basicSetup={envEditorBasicSetup}
        extensions={extensions}
        onChange={onChange}
        theme="dark"
      />
    </div>
  );
}
