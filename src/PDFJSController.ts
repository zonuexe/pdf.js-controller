// LICENSE : MIT

import 'custom-event-polyfill';
import domify from 'domify';

import domMap from './dom-map';

import * as pdfjsLib from 'pdfjs-dist';
import { AnnotationLayerBuilder, EventBus, SimpleLinkService, TextLayerBuilder } from 'pdfjs-dist/web/pdf_viewer.mjs';
import type { PDFDocumentProxy, PDFPageProxy, PageViewport as PDFPageViewport } from 'pdfjs-dist/types/src/pdf';

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
<div class="pdf-textLayer"></div>
<div class="pdf-annotationLayer"></div>`;

class PDFJSController {
    private readonly pdfContainer: HTMLElement;
    private pdfDoc: PDFDocumentProxy | null = null;
    private pageNum: number;
    private promiseQueue: Promise<void> = Promise.resolve();
    private readonly domMapObject: ControllerDomMap;
    private readonly canvasContext: CanvasRenderingContext2D;
    private readonly eventBus = new EventBus();
    private readonly linkService = new SimpleLinkService({ eventBus: this.eventBus });
    private readonly workerSrc?: string;
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
        this.workerSrc = resolvedWorkerSrc;
        if (resolvedWorkerSrc) {
            pdfjsLib.GlobalWorkerOptions.workerSrc = resolvedWorkerSrc;
        }

        const html = innerHTML ?? defaultInnerHTML;
        const dom = domify(html);
        const mapping = {
            progressBar: '.pdf-slide-progress-bar',
            canvas: '.pdf-canvas',
            textLayer: '.pdf-textLayer',
            annotationLayer: '.pdf-annotationLayer',
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

    async loadDocument(url: string): Promise<void> {
        const events = PDFJSController.Events;
        const hideLoadingIcon = (): void => {
            this.domMapObject.loading.style.display = 'none';
        };

        this.pdfContainer.addEventListener(events.before_pdf_rendering, hideLoadingIcon);

        try {
            const source: { url: string; cMapUrl?: string; cMapPacked?: boolean } = { url };
            if (this.cMapUrl) {
                source.cMapUrl = this.cMapUrl;
                source.cMapPacked = this.cMapPacked ?? true;
            }
            const loadingTask = pdfjsLib.getDocument(source);
            this.pdfDoc = await loadingTask.promise;
            this.linkService.setDocument?.(this.pdfDoc);
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
            const desiredWidth = this.domMapObject.canvas.width || canvas.clientWidth || initialViewport.width;
            const scale = desiredWidth / initialViewport.width;
            const viewport = page.getViewport({ scale });
            canvas.width = viewport.width;
            canvas.height = viewport.height;
            textLayer.style.width = `${viewport.width}px`;
            textLayer.style.height = `${viewport.height}px`;

            const renderTask = page.render({
                canvasContext: this.canvasContext,
                viewport,
                canvas
            });

            const textLayerBuilder = new TextLayerBuilder({
                pdfPage: page,
                onAppend: (div: HTMLDivElement) => {
                    textLayer.replaceChildren(div);
                }
            });

            await Promise.all([
                renderTask.promise,
                textLayerBuilder.render({ viewport })
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

        await annotationLayerBuilder.render({
            viewport: viewport.clone({ dontFlip: true }),
            intent: 'display'
        });
    }
}

export = PDFJSController;
