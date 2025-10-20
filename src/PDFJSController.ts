// LICENSE : MIT

import 'pdfjs-dist/build/pdf.combined.js';
import 'pdfjs-dist/web/compatibility.js';
import 'custom-event-polyfill';
import domify from 'domify';

import domMap from './dom-map';
import { TextLayerBuilder } from './pdf.js-contrib/text_layer_builder';

interface PDFJSControllerOptions {
    container: HTMLElement;
    innerHTML?: string;
    pageNumber?: number;
    pdfjsDistDir?: string;
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

const pdfjsGlobal = global as typeof globalThis & { PDFJS?: PDFJSStatic };
pdfjsGlobal.PDFJS = pdfjsGlobal.PDFJS ?? PDFJS;

class PDFJSController {
    private readonly pdfContainer: HTMLElement;
    private pdfDoc: PDFDocumentProxy | null = null;
    private pageNum: number;
    private promiseQueue: Promise<void> = Promise.resolve();
    private readonly domMapObject: ControllerDomMap;
    private readonly canvasContext: CanvasRenderingContext2D;

    constructor({ container, innerHTML, pageNumber, pdfjsDistDir }: PDFJSControllerOptions) {
        this.pdfContainer = container;
        this.pageNum = pageNumber ?? 1;

        if (pdfjsDistDir) {
            const pdfjsDistDirWithoutSuffix = pdfjsDistDir.replace(/\/$/, '');
            PDFJS.workerSrc = `${pdfjsDistDirWithoutSuffix}/build/pdf.worker.js`;
            PDFJS.cMapUrl = `${pdfjsDistDirWithoutSuffix}/cmaps/`;
            PDFJS.cMapPacked = true;
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

        const canvasContext = this.domMapObject.canvas.getContext('2d');
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
            this.pdfDoc = await PDFJS.getDocument(url);
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
        const { textLayer, annotationLayer } = this.domMapObject;
        const range = document.createRange();

        range.selectNodeContents(textLayer);
        range.deleteContents();

        range.selectNodeContents(annotationLayer);
        range.deleteContents();
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
            const viewport = page.getViewport(canvas.width / page.getViewport(1).width);
            canvas.height = viewport.height;
            canvas.width = viewport.width;
            textLayer.style.width = canvas.style.width;
            textLayer.style.height = canvas.style.height;

            const renderContext = {
                canvasContext: this.canvasContext,
                viewport
            };

            const renderPromise = page.render(renderContext).promise;
            const textLayerPromise = page.getTextContent().then((textContent) => {
                const textLayerBuilder = new TextLayerBuilder({
                    textLayerDiv: textLayer,
                    viewport,
                    pageIndex: pageNumber - 1
                });
                textLayerBuilder.setTextContent(textContent);
                textLayerBuilder.render();
            });

            await Promise.all([renderPromise, textLayerPromise]);
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
        const annotationsData = await page.getAnnotations();
        const clonedViewport = viewport.clone({ dontFlip: true });

        for (const data of annotationsData) {
            if (!data || !data.hasHtml) {
                continue;
            }
            const element = PDFJS.AnnotationUtils.getHtmlElement(data) as HTMLElement;
            let rect = data.rect as number[];
            const view = page.view;
            rect = PDFJS.Util.normalizeRect([
                rect[0],
                view[3] - rect[1] + view[1],
                rect[2],
                view[3] - rect[3] + view[1]
            ]);
            element.style.left = `${rect[0]}px`;
            element.style.top = `${rect[1]}px`;
            element.style.position = 'absolute';
            const transform = clonedViewport.transform;
            const transformStr = `matrix(${transform.join(',')})`;
            PDFJS.CustomStyle.setProp('transform', element, transformStr);
            const transformOriginStr = `${-rect[0]}px ${-rect[1]}px`;
            PDFJS.CustomStyle.setProp('transformOrigin', element, transformOriginStr);
            if (data.subtype === 'Link' && !data.url) {
                continue;
            }
            annotationArea.appendChild(element);
        }
    }
}

export = PDFJSController;
