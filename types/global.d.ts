declare module 'domify' {
  function domify(html: string): HTMLElement;
  export = domify;
}

declare module 'custom-event-polyfill';
declare module 'pdfjs-dist/build/pdf.combined.js';
declare module 'pdfjs-dist/web/compatibility.js';

declare const PDFJS: any;
declare const global: any;
declare function require(name: string): any;
declare const module: any;
