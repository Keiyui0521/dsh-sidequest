import { visualizationParts } from "./visualization.js";
export function createRenderer(R, api) {
  const h = R.createElement;
  function html(text) {
    if (!window.marked || !window.DOMPurify) return null;
    const maths = [];
    const source = text.replace(
      /```[\s\S]*?```|`[^`\n]*`|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$/g,
      (m) =>
        m.startsWith("`") ? m : "MATHPLACE" + (maths.push(m) - 1) + "END",
    );
    let out = window.DOMPurify.sanitize(window.marked.parse(source));
    return out.replace(/MATHPLACE(\d+)END/g, (_, i) => {
      const raw = maths[i],
        display = raw.startsWith("\\[") || raw.startsWith("$$");
      return window.katex
        ? window.katex.renderToString(raw.slice(2, -2), {
            displayMode: display,
            throwOnError: false,
            trust: false,
            output: "htmlAndMathml",
          })
        : window.DOMPurify.sanitize(raw);
    });
  }
  function Visualization({ file, inlineHtml }) {
    const [doc, setDoc] = R.useState(null),
      [error, setError] = R.useState("");
    R.useEffect(() => {
      const c = new AbortController();
      setDoc(null);
      setError("");
      (inlineHtml !== undefined
        ? Promise.resolve({ html: inlineHtml })
        : fetch(api() + "visualization?path=" + encodeURIComponent(file), {
            signal: c.signal,
          }).then(async (r) => {
            if (!r.ok) throw Error("图表读取失败（" + r.status + "）");
            return r.json();
          })
      )
        .then((v) => {
          const policy =
            "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; connect-src 'none'; base-uri 'none'; form-action 'none'";
          const defaults =
            "<style>:root{--font-size-base:16px;--foreground:#172033;--background:#fff;--muted-foreground:#64748b;--border:#cbd5e1;--viz-series-1:#2563eb;--viz-series-2:#ea580c}body{margin:12px;font:16px/1.5 system-ui,sans-serif;color:var(--foreground);background:var(--background)}input[type=range]{width:100%;accent-color:#2563eb}canvas,svg{max-width:100%}</style>";
          setDoc(
            '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="' +
              policy +
              '">' +
              defaults +
              v.html,
          );
        })
        .catch((e) => {
          if (e.name !== "AbortError") setError(e.message);
        });
      return () => c.abort();
    }, [file, inlineHtml]);
    return h(
      "figure",
      { style: { margin: "12px 0" } },
      h("figcaption", null, "交互图表"),
      error
        ? h("p", { role: "alert" }, error)
        : doc === null
          ? h("p", { role: "status" }, "正在加载图表…")
          : h("iframe", {
              title: "侧聊交互图表 " + (file?.split("/").pop() || "预览"),
              srcDoc: doc,
              sandbox: "allow-scripts",
              referrerPolicy: "no-referrer",
              style: {
                width: "100%",
                height: 420,
                border: "1px solid #8883",
                borderRadius: 12,
                background: "#fff",
              },
            }),
    );
  }
  function Answer({ text, interactive = false }) {
    return h(
      "div",
      { className: "sidequest-answer" },
      ...(interactive ? visualizationParts(text) : [{ text }]).map(
        (part, i) => {
          if (part.path || part.html !== undefined)
            return h(Visualization, {
              key: i,
              file: part.path,
              inlineHtml: part.html,
            });
          const content = html(part.text);
          return content === null
            ? h("div", { key: i, style: { whiteSpace: "pre-wrap" } }, part.text)
            : h("div", {
                key: i,
                dangerouslySetInnerHTML: { __html: content },
              });
        },
      ),
    );
  }

  return { Answer };
}
