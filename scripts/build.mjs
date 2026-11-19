import { build } from "esbuild";
await Promise.all([
  build({
    entryPoints: ["src/client/index.js"],
    bundle: true,
    format: "iife",
    platform: "browser",
    loader: { ".css": "text" },
    outfile: "dist/client.js",
    legalComments: "inline",
  }),
  build({
    stdin: {
      contents:
        "import {marked} from 'marked';import DOMPurify from 'dompurify';import katex from 'katex';window.marked=marked;window.DOMPurify=DOMPurify;window.katex=katex;",
      resolveDir: process.cwd(),
    },
    bundle: true,
    format: "iife",
    platform: "browser",
    outfile: "dist/vendor.js",
    legalComments: "inline",
  }),
]);
