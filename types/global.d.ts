declare module 'domify' {
  function domify(html: string): HTMLElement;
  export = domify;
}

declare module 'custom-event-polyfill';
declare module 'pdfjs-dist/build/pdf.combined.js';
declare module 'pdfjs-dist/web/compatibility.js';

interface PDFPageViewport {
  width: number;
  height: number;
  transform: number[];
  clone(params: { dontFlip: boolean }): PDFPageViewport;
}

interface PDFRenderTask {
  promise: Promise<void>;
  cancel(): void;
}

interface PDFPageProxy {
  getViewport(scale: number): PDFPageViewport;
  render(context: { canvasContext: CanvasRenderingContext2D; viewport: PDFPageViewport }): PDFRenderTask;
  getTextContent(): Promise<any>;
  getAnnotations(): Promise<any[]>;
  view: number[];
}

interface PDFDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<PDFPageProxy>;
}

interface PDFJSAnnotationUtils {
  getHtmlElement(data: any): HTMLElement;
}

interface PDFJSUtil {
  normalizeRect(rect: number[]): number[];
}

interface PDFJSCustomStyle {
  setProp(prop: string, element: HTMLElement, value: string): void;
}

interface PDFJSStatic {
  workerSrc: string;
  cMapUrl: string;
  cMapPacked: boolean;
  getDocument(source: any): Promise<PDFDocumentProxy>;
  AnnotationUtils: PDFJSAnnotationUtils;
  Util: PDFJSUtil;
  CustomStyle: PDFJSCustomStyle;
  renderTextLayer(params: {
    textContent: any;
    container: DocumentFragment;
    viewport: PDFPageViewport;
    textDivs: HTMLElement[];
    timeout?: number;
  }): PDFRenderTask;
}

declare const PDFJS: PDFJSStatic;
declare const global: any;
declare function require(name: string): any;
declare const module: any;
