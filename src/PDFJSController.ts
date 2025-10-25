// LICENSE : MIT

import 'custom-event-polyfill';
import domify from 'domify';

import domMap from './dom-map';

import * as pdfjsLib from 'pdfjs-dist';
import { AnnotationLayerBuilder, EventBus, SimpleLinkService, TextLayerBuilder } from 'pdfjs-dist/web/pdf_viewer.mjs';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport as PDFPageViewport } from 'pdfjs-dist/types/src/pdf';
import type { DocumentInitParameters, PDFDocumentLoadingTask, RenderParameters, RenderTask } from 'pdfjs-dist/types/src/display/api';
import type { TextLayerBuilderRenderOptions } from 'pdfjs-dist/types/web/text_layer_builder';
import type { AnnotationLayerBuilderRenderOptions } from 'pdfjs-dist/types/web/annotation_layer_builder';

interface PDFJSControllerOptions {
    container: HTMLElement;
    innerHTML?: string;
    pageNumber?: number;
    pdfjsDistDir?: string;
    workerSrc?: string;
    cMapUrl?: string;
    cMapPacked?: boolean;
}

type ControllerDomMap = {
    readonly progressBar: HTMLElement | null;
    readonly canvas: HTMLCanvasElement;
    readonly textLayer: HTMLDivElement;
    readonly annotationLayer: HTMLDivElement;
    readonly loading: HTMLElement;
};

const defaultInnerHTML = `<div class="pdf-slide-progress">
    <div class="pdf-slide-progress-bar"></div>
</div>
<div class="pdf-loading"></div>
<canvas class="pdf-canvas"></canvas>
<div class="textLayer"></div>
<div class="annotationLayer"></div>`;

class PDFJSController {
    private readonly pdfContainer: HTMLElement;
    private pdfDoc: PDFDocumentProxy | null = null;
    private pageNum: number;
    private promiseQueue: Promise<void> = Promise.resolve();
    private readonly domMapObject: ControllerDomMap;
    private readonly canvasContext: CanvasRenderingContext2D;
    private readonly eventBus = new EventBus();
    private readonly linkService = new SimpleLinkService({ eventBus: this.eventBus });
    private readonly cMapUrl?: string;
    private readonly cMapPacked?: boolean;

    constructor({ container, innerHTML, pageNumber, pdfjsDistDir, workerSrc, cMapUrl, cMapPacked }: PDFJSControllerOptions) {
        this.pdfContainer = container;
        this.pageNum = pageNumber ?? 1;

        let resolvedWorkerSrc = workerSrc;
        if (pdfjsDistDir && !resolvedWorkerSrc) {
            const baseDir = pdfjsDistDir.replace(/\/$/, '');
            resolvedWorkerSrc = `${baseDir}/build/pdf.worker.mjs`;
            this.cMapUrl = `${baseDir}/cmaps/`;
            this.cMapPacked = true;
        } else {
            this.cMapUrl = cMapUrl;
            this.cMapPacked = cMapPacked;
        }
        if (resolvedWorkerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = resolvedWorkerSrc;
        }

        const html = innerHTML ?? defaultInnerHTML;
        const dom = domify(html);
        const mapping = {
            progressBar: '.pdf-slide-progress-bar',
            canvas: '.pdf-canvas',
            textLayer: '.textLayer',
            annotationLayer: '.annotationLayer',
            loading: '.pdf-loading'
        } as const;

        this.domMapObject = domMap<typeof mapping, ControllerDomMap>(dom, mapping);
        container.appendChild(dom);

        const canvasContext = this.domMapObject.canvas.getContext('2d', {
            willReadFrequently: true
        });
        if (!canvasContext) {
            throw new Error('Unable to obtain a 2D canvas context.');
        }
        this.canvasContext = canvasContext;

        void this.fitItSize();
    }

    static get Events(): Record<'before_pdf_rendering' | 'after_pdf_rendering', string> {
        return {
            before_pdf_rendering: 'before-pdf-rendering',
            after_pdf_rendering: 'after_pdf_rendering'
        };
    }

    async loadDocument(source: string | DocumentInitParameters): Promise<void> {
        const events = PDFJSController.Events;
        const hideLoadingIcon = (): void => {
            this.domMapObject.loading.style.display = 'none';
        };

        this.pdfContainer.addEventListener(events.before_pdf_rendering, hideLoadingIcon);

        try {
            const params: DocumentInitParameters = typeof source === 'string' ? { url: source } : { ...source };
            if (this.cMapUrl && !params.cMapUrl) {
                params.cMapUrl = this.cMapUrl;
                params.cMapPacked = this.cMapPacked ?? true;
            } else if (params.cMapUrl && params.cMapPacked === undefined && this.cMapPacked !== undefined) {
                params.cMapPacked = this.cMapPacked;
            }

            const loadingTask: PDFDocumentLoadingTask = pdfjsLib.getDocument(params);
            this.pdfDoc = await loadingTask.promise;
            this.linkService.setDocument(this.pdfDoc);
            await this.queueRenderPage(this.pageNum);
        } finally {
            this.pdfContainer.removeEventListener(events.before_pdf_rendering, hideLoadingIcon);
        }
    }

    async fitItSize(): Promise<void> {
        const containerRect = this.pdfContainer.getBoundingClientRect();
        this.domMapObject.canvas.width = containerRect.width;
        this.domMapObject.canvas.height = containerRect.height;
        await this.queueRenderPage(this.pageNum);
    }

    async prevPage(): Promise<void> {
        if (this.pageNum <= 1) {
            return;
        }
        this.pageNum -= 1;
        await this.queueRenderPage(this.pageNum);
    }

    async nextPage(): Promise<void> {
        if (!this.pdfDoc || this.pageNum >= this.pdfDoc.numPages) {
            return;
        }
        this.pageNum += 1;
        await this.queueRenderPage(this.pageNum);
    }

    private queueRenderPage(pageNumber: number): Promise<void> {
        if (!this.pdfDoc) {
            return Promise.resolve();
        }

        this.promiseQueue = this.promiseQueue
            .then(() => this.renderPage(pageNumber))
            .catch((error) => {
                this.promiseQueue = Promise.resolve();
                throw error;
            });

        return this.promiseQueue;
    }

    private cleanup(): void {
        this.domMapObject.textLayer.replaceChildren();
        this.domMapObject.annotationLayer.replaceChildren();
    }

    private async renderPage(pageNumber: number): Promise<void> {
        if (!this.pdfDoc) {
            return;
        }

        const events = PDFJSController.Events;
        const beforeEvent = new CustomEvent(events.before_pdf_rendering, { detail: this });
        this.pdfContainer.dispatchEvent(beforeEvent);

        try {
            const page = await this.pdfDoc.getPage(pageNumber);
            this.cleanup();

            const { canvas, textLayer, annotationLayer } = this.domMapObject;
            const initialViewport = page.getViewport({ scale: 1 });
            const containerRect = this.pdfContainer.getBoundingClientRect();
            let cssWidth = containerRect.width;
            if (!cssWidth || !Number.isFinite(cssWidth)) {
                cssWidth = this.domMapObject.canvas.clientWidth || initialViewport.width;
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
                canvas
            };
            if (dpr !== 1) {
                renderParameters.transform = [dpr, 0, 0, dpr, 0, 0];
            }
            const renderTask: RenderTask = page.render(renderParameters);

            const textLayerBuilder = new TextLayerBuilder({
                pdfPage: page,
                onAppend: (div: HTMLDivElement) => {
                    textLayer.replaceChildren(div);
                }
            });

            const textLayerRenderOptions: TextLayerBuilderRenderOptions = { viewport };

            await Promise.all([
                renderTask.promise,
                textLayerBuilder.render(textLayerRenderOptions)
            ]);

            await this.setupAnnotations(page, viewport, annotationLayer);
        } finally {
            const afterEvent = new CustomEvent(events.after_pdf_rendering, { detail: this });
            this.pdfContainer.dispatchEvent(afterEvent);
        }

        this.updateProgress(pageNumber);
    }

    private updateProgress(pageNumber: number): void {
        const progressBar = this.domMapObject.progressBar;
        if (!progressBar || !this.pdfDoc) {
            return;
        }
        const numSlides = this.pdfDoc.numPages;
        const position = pageNumber - 1;
        const percent = numSlides === 1 ? 100 : (100 * position) / (numSlides - 1);
        progressBar.style.width = `${percent}%`;
    }

    private async setupAnnotations(page: PDFPageProxy, viewport: PDFPageViewport, annotationArea: HTMLDivElement): Promise<void> {
        const annotationLayerBuilder = new AnnotationLayerBuilder({
            pdfPage: page,
            linkService: this.linkService,
            renderForms: false,
            imageResourcesPath: '',
            onAppend: (div: HTMLDivElement) => {
                annotationArea.replaceChildren(div);
            }
        });

        const annotationRenderOptions: AnnotationLayerBuilderRenderOptions = {
            viewport: viewport.clone({ dontFlip: true }),
            intent: 'display'
        };

        await annotationLayerBuilder.render(annotationRenderOptions);
    }
}

export = PDFJSController;
