// LICENSE : MIT

import * as pdfjsLib from "pdfjs-dist";
import { RenderingCancelledException } from "pdfjs-dist";
import {
  AnnotationLayerBuilder,
  EventBus,
  SimpleLinkService,
  TextLayerBuilder,
} from "pdfjs-dist/web/pdf_viewer.mjs";
import type {
  PDFDocumentProxy,
  PDFPageProxy,
  PageViewport as PDFPageViewport,
  PDFDocumentLoadingTask,
  RenderTask,
} from "pdfjs-dist";

export type { PDFDocumentProxy };

// pdfjs-dist v6 exposes these option/parameter types only via deep, non-exported
// paths that Node16/NodeNext module resolution can't reach, so derive them from
// the public runtime API surface instead.
export type DocumentInitParameters = NonNullable<Parameters<typeof pdfjsLib.getDocument>[0]>;
type RenderParameters = Parameters<PDFPageProxy["render"]>[0];
type TextLayerBuilderRenderOptions = Parameters<TextLayerBuilder["render"]>[0];
type AnnotationLayerBuilderRenderOptions = Parameters<AnnotationLayerBuilder["render"]>[0];

export const Events = {
  before_pdf_rendering: "before-pdf-rendering",
  after_pdf_rendering: "after-pdf-rendering",
} as const;

export type PDFJSControllerEventName = (typeof Events)[keyof typeof Events];
export type PDFJSControllerDocumentSource = string | URL | DocumentInitParameters;

export interface PDFJSControllerOptions {
  container: HTMLElement;
  innerHTML?: string;
  pageNumber?: number;
  pdfjsDistDir?: string;
  workerSrc?: string;
  cMapUrl?: string;
  cMapPacked?: boolean;
}

export interface PDFJSControllerDomMap {
  readonly progressBar: HTMLElement | null;
  readonly canvas: HTMLCanvasElement;
  readonly textLayer: HTMLDivElement;
  readonly annotationLayer: HTMLDivElement;
  readonly loading: HTMLElement;
}

const defaultInnerHTML = `<div class="pdf-slide-progress">
    <div class="pdf-slide-progress-bar"></div>
</div>
<div class="pdf-loading"></div>
<canvas class="pdf-canvas"></canvas>
<div class="textLayer"></div>
<div class="annotationLayer"></div>`;

const parseTemplate = (markup: string): DocumentFragment => {
  const template = document.createElement("template");
  template.innerHTML = markup;
  return template.content;
};

const requireElement = <T extends Element>(
  root: ParentNode,
  selector: string,
  elementType: abstract new (...args: never[]) => T,
  label: string,
): T => {
  const element = root.querySelector(selector);
  if (!(element instanceof elementType)) {
    throw new Error(`Missing required ${label} element (${selector}).`);
  }
  return element;
};

const optionalHTMLElement = (root: ParentNode, selector: string): HTMLElement | null => {
  const element = root.querySelector(selector);
  return element instanceof HTMLElement ? element : null;
};

export class PDFJSController {
  static readonly Events = Events;

  readonly canvasContext: CanvasRenderingContext2D;
  readonly domMapObject: PDFJSControllerDomMap;

  #pdfContainer: HTMLElement;
  #pdfDoc: PDFDocumentProxy | null = null;
  #pageNum: number;
  #promiseQueue: Promise<void> = Promise.resolve();
  #generation = 0;
  #loadingTask: PDFDocumentLoadingTask | null = null;
  #renderTask: RenderTask | null = null;
  #eventBus = new EventBus();
  #linkService = new SimpleLinkService({ eventBus: this.#eventBus });
  #cMapUrl?: string;
  #cMapPacked?: boolean;

  constructor({
    container,
    innerHTML,
    pageNumber,
    pdfjsDistDir,
    workerSrc,
    cMapUrl,
    cMapPacked,
  }: PDFJSControllerOptions) {
    this.#pdfContainer = container;
    this.#pageNum = pageNumber ?? 1;

    let resolvedWorkerSrc = workerSrc;
    if (pdfjsDistDir && !resolvedWorkerSrc) {
      const baseDir = pdfjsDistDir.replace(/\/$/, "");
      resolvedWorkerSrc = `${baseDir}/build/pdf.worker.mjs`;
      this.#cMapUrl = `${baseDir}/cmaps/`;
      this.#cMapPacked = true;
    } else {
      this.#cMapUrl = cMapUrl;
      this.#cMapPacked = cMapPacked;
    }
    if (resolvedWorkerSrc) {
      pdfjsLib.GlobalWorkerOptions.workerSrc = resolvedWorkerSrc;
    }

    const html = innerHTML ?? defaultInnerHTML;
    const dom = parseTemplate(html);
    this.domMapObject = {
      progressBar: optionalHTMLElement(dom, ".pdf-slide-progress-bar"),
      canvas: requireElement(dom, ".pdf-canvas", HTMLCanvasElement, "canvas"),
      textLayer: requireElement(dom, ".textLayer", HTMLDivElement, "text layer"),
      annotationLayer: requireElement(dom, ".annotationLayer", HTMLDivElement, "annotation layer"),
      loading: requireElement(dom, ".pdf-loading", HTMLElement, "loading"),
    } satisfies PDFJSControllerDomMap;
    container.appendChild(dom);

    const canvasContext = this.domMapObject.canvas.getContext("2d", {
      willReadFrequently: true,
    });
    if (!canvasContext) {
      throw new Error("Unable to obtain a 2D canvas context.");
    }
    this.canvasContext = canvasContext;

    void this.fitItSize();
  }

  get pageNumber(): number {
    return this.#pageNum;
  }

  get numPages(): number {
    return this.#pdfDoc?.numPages ?? 0;
  }

  get pdfDocument(): PDFDocumentProxy | null {
    return this.#pdfDoc;
  }

  async loadDocument(source: PDFJSControllerDocumentSource): Promise<void> {
    const hideLoadingIcon = (): void => {
      this.domMapObject.loading.style.display = "none";
    };

    this.#pdfContainer.addEventListener(Events.before_pdf_rendering, hideLoadingIcon);

    try {
      await this.#destroyDocument();

      const params: DocumentInitParameters =
        typeof source === "string" || source instanceof URL ? { url: source } : { ...source };
      if (this.#cMapUrl && !params.cMapUrl) {
        params.cMapUrl = this.#cMapUrl;
        params.cMapPacked = this.#cMapPacked ?? true;
      } else if (
        params.cMapUrl &&
        params.cMapPacked === undefined &&
        this.#cMapPacked !== undefined
      ) {
        params.cMapPacked = this.#cMapPacked;
      }

      this.#loadingTask = pdfjsLib.getDocument(params);
      this.#pdfDoc = await this.#loadingTask.promise;
      if (this.#pageNum > this.#pdfDoc.numPages) {
        this.#pageNum = this.#pdfDoc.numPages;
      }
      if (this.#pageNum < 1) {
        this.#pageNum = 1;
      }
      this.#linkService.setDocument(this.#pdfDoc);
      await this.#queueRenderPage(this.#pageNum);
    } finally {
      this.#pdfContainer.removeEventListener(Events.before_pdf_rendering, hideLoadingIcon);
    }
  }

  async destroy(): Promise<void> {
    await this.#destroyDocument();
    this.#cleanup();
  }

  async fitItSize(): Promise<void> {
    const containerRect = this.#pdfContainer.getBoundingClientRect();
    this.domMapObject.canvas.width = containerRect.width;
    this.domMapObject.canvas.height = containerRect.height;
    await this.#queueRenderPage(this.#pageNum);
  }

  async prevPage(): Promise<void> {
    if (this.#pageNum <= 1) {
      return;
    }
    this.#pageNum -= 1;
    await this.#queueRenderPage(this.#pageNum);
  }

  async nextPage(): Promise<void> {
    if (!this.#pdfDoc || this.#pageNum >= this.#pdfDoc.numPages) {
      return;
    }
    this.#pageNum += 1;
    await this.#queueRenderPage(this.#pageNum);
  }

  #queueRenderPage(pageNumber: number): Promise<void> {
    if (!this.#pdfDoc) {
      return Promise.resolve();
    }

    this.#cancelRender();
    this.#promiseQueue = this.#promiseQueue
      .then(() => this.#renderPage(pageNumber))
      .catch((error: unknown) => {
        if (error instanceof RenderingCancelledException) {
          return;
        }
        this.#promiseQueue = Promise.resolve();
        throw error;
      });

    return this.#promiseQueue;
  }

  #cancelRender(): void {
    this.#renderTask?.cancel();
    this.#renderTask = null;
  }

  async #destroyDocument(): Promise<void> {
    this.#generation += 1;
    this.#cancelRender();
    try {
      await this.#promiseQueue;
    } catch {
      // The queue already handles render failures.
    }
    this.#promiseQueue = Promise.resolve();
    this.#linkService.setDocument(null);
    const loadingTask = this.#loadingTask;
    this.#loadingTask = null;
    this.#pdfDoc = null;
    if (loadingTask && !loadingTask.destroyed) {
      await loadingTask.destroy();
    }
  }

  #cleanup(): void {
    this.domMapObject.textLayer.replaceChildren();
    this.domMapObject.annotationLayer.replaceChildren();
  }

  async #renderPage(pageNumber: number): Promise<void> {
    const generation = this.#generation;
    const pdfDoc = this.#pdfDoc;
    if (!pdfDoc) {
      return;
    }

    const beforeEvent = new CustomEvent(Events.before_pdf_rendering, { detail: this });
    this.#pdfContainer.dispatchEvent(beforeEvent);

    let cancelled = false;
    try {
      const page = await pdfDoc.getPage(pageNumber);
      if (generation !== this.#generation) {
        return;
      }
      this.#cleanup();

      const { canvas, textLayer, annotationLayer } = this.domMapObject;
      const initialViewport = page.getViewport({ scale: 1 });
      const containerRect = this.#pdfContainer.getBoundingClientRect();
      let cssWidth = containerRect.width;
      if (!cssWidth || !Number.isFinite(cssWidth)) {
        cssWidth = canvas.clientWidth || initialViewport.width;
      }
      const scale = cssWidth / initialViewport.width;
      const viewport = page.getViewport({ scale });
      const cssHeight = viewport.height;

      canvas.style.width = `${cssWidth}px`;
      canvas.style.height = `${cssHeight}px`;
      textLayer.style.width = `${cssWidth}px`;
      textLayer.style.height = `${cssHeight}px`;
      annotationLayer.style.width = `${cssWidth}px`;
      annotationLayer.style.height = `${cssHeight}px`;

      const dpr = window.devicePixelRatio || 1;
      const maxSize = 16384; // avoid exceeding browser canvas limits
      canvas.width = Math.min(Math.round(viewport.width * dpr), maxSize);
      canvas.height = Math.min(Math.round(viewport.height * dpr), maxSize);

      this.canvasContext.setTransform(1, 0, 0, 1, 0, 0);

      const renderParameters: RenderParameters = {
        canvasContext: this.canvasContext,
        viewport,
        canvas,
      };
      if (dpr !== 1) {
        renderParameters.transform = [dpr, 0, 0, dpr, 0, 0];
      }
      this.#cancelRender();
      const renderTask: RenderTask = page.render(renderParameters);
      this.#renderTask = renderTask;

      const textLayerBuilder = new TextLayerBuilder({
        pdfPage: page,
        onAppend: (div: HTMLDivElement) => {
          textLayer.replaceChildren(div);
        },
      });

      // pdf.js types `images` as TextLayerImages, but the viewer itself passes
      // null when right-click image extraction is unused.
      await Promise.all([
        renderTask.promise,
        textLayerBuilder.render({
          viewport,
          images: null,
        } as unknown as TextLayerBuilderRenderOptions),
      ]);
      this.#renderTask = null;

      await this.#setupAnnotations(page, viewport, annotationLayer);
    } catch (error: unknown) {
      if (error instanceof RenderingCancelledException) {
        cancelled = true;
        return;
      }
      throw error;
    } finally {
      if (!cancelled) {
        const afterEvent = new CustomEvent(Events.after_pdf_rendering, { detail: this });
        this.#pdfContainer.dispatchEvent(afterEvent);
      }
    }

    this.#updateProgress(pageNumber);
  }

  #updateProgress(pageNumber: number): void {
    const progressBar = this.domMapObject.progressBar;
    if (!progressBar || !this.#pdfDoc) {
      return;
    }
    const numSlides = this.#pdfDoc.numPages;
    const position = pageNumber - 1;
    const percent = numSlides === 1 ? 100 : (100 * position) / (numSlides - 1);
    progressBar.style.width = `${percent}%`;
  }

  async #setupAnnotations(
    page: PDFPageProxy,
    viewport: PDFPageViewport,
    annotationArea: HTMLDivElement,
  ): Promise<void> {
    const annotationLayerBuilder = new AnnotationLayerBuilder({
      pdfPage: page,
      linkService: this.#linkService,
      renderForms: false,
      imageResourcesPath: "",
      onAppend: (div: HTMLDivElement) => {
        annotationArea.replaceChildren(div);
      },
    });

    const annotationRenderOptions: AnnotationLayerBuilderRenderOptions = {
      viewport: viewport.clone({ dontFlip: true }),
      intent: "display",
    };

    await annotationLayerBuilder.render(annotationRenderOptions);
  }
}

export type PDFJSControllerEvent = CustomEvent<PDFJSController>;

declare global {
  interface HTMLElementEventMap {
    [Events.before_pdf_rendering]: CustomEvent<PDFJSController>;
    [Events.after_pdf_rendering]: CustomEvent<PDFJSController>;
  }
}

export default PDFJSController;
