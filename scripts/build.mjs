import {build} from 'esbuild';
await build({stdin:{contents:"import {marked} from 'marked';import DOMPurify from 'dompurify';import katex from 'katex';window.marked=marked;window.DOMPurify=DOMPurify;window.katex=katex;",resolveDir:process.cwd()},bundle:true,format:'iife',platform:'browser',outfile:'dist/vendor.js',legalComments:'inline'});
