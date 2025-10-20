/* Copyright 2012 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
/* globals PDFJS */

type TextLayerBuilderOptions = {
    textLayerDiv: HTMLDivElement;
    pageIndex: number;
    viewport: PDFPageViewport;
    findController?: any;
};

type TextMatchPosition = {
    divIdx: number;
    offset: number;
};

type TextMatch = {
    begin: TextMatchPosition;
    end: TextMatchPosition;
};

class TextLayerBuilder {
    private readonly textLayerDiv: HTMLDivElement;
    private readonly pageIdx: number;
    private readonly pageNumber: number;
    private readonly viewport: PDFPageViewport;
    private readonly findController: any;

    private renderingDone = false;
    private divContentDone = false;
    private matches: TextMatch[] = [];
    private textDivs: HTMLElement[] = [];
    private textLayerRenderTask: PDFRenderTask | null = null;
    private textContent: any = null;

    constructor(options: TextLayerBuilderOptions) {
        this.textLayerDiv = options.textLayerDiv;
        this.pageIdx = options.pageIndex;
        this.pageNumber = this.pageIdx + 1;
        this.viewport = options.viewport;
        this.findController = options.findController || null;

        this.bindMouse();
    }

    render(timeout?: number): void {
        if (!this.divContentDone || this.renderingDone) {
            return;
        }

        if (this.textLayerRenderTask) {
            this.textLayerRenderTask.cancel();
            this.textLayerRenderTask = null;
        }

        this.textDivs = [];
        const textLayerFrag = document.createDocumentFragment();
        this.textLayerRenderTask = PDFJS.renderTextLayer({
            textContent: this.textContent,
            container: textLayerFrag,
            viewport: this.viewport,
            textDivs: this.textDivs,
            timeout
        });
        this.textLayerRenderTask.promise.then(() => {
            this.textLayerDiv.appendChild(textLayerFrag);
            this.finishRendering();
            this.updateMatches();
        }).catch(() => {
            // canceled or failed to render text layer -- skipping errors
        });
    }

    setTextContent(textContent: any): void {
        if (this.textLayerRenderTask) {
            this.textLayerRenderTask.cancel();
            this.textLayerRenderTask = null;
        }
        this.textContent = textContent;
        this.divContentDone = true;
    }

    updateMatches(): void {
        if (!this.renderingDone || !this.textContent) {
            return;
        }

        const matches = this.matches;
        const textDivs = this.textDivs;
        const bidiTexts = this.textContent.items;
        let clearedUntilDivIdx = -1;

        for (let i = 0, len = matches.length; i < len; i += 1) {
            const match = matches[i];
            const begin = Math.max(clearedUntilDivIdx, match.begin.divIdx);
            for (let n = begin, end = match.end.divIdx; n <= end; n += 1) {
                const div = textDivs[n];
                div.textContent = bidiTexts[n].str;
                div.className = '';
            }
            clearedUntilDivIdx = match.end.divIdx + 1;
        }

        if (this.findController === null || !this.findController.active) {
            return;
        }

        this.matches = this.convertMatches(this.findController.pageMatches[this.pageIdx] || []);
        this.renderMatches(this.matches);
    }

    private finishRendering(): void {
        this.renderingDone = true;

        const endOfContent = document.createElement('div');
        endOfContent.className = 'endOfContent';
        this.textLayerDiv.appendChild(endOfContent);

        const event = document.createEvent('CustomEvent');
        event.initCustomEvent('textlayerrendered', true, true, {
            pageNumber: this.pageNumber
        });
        this.textLayerDiv.dispatchEvent(event);
    }

    private convertMatches(matches: number[]): TextMatch[] {
        if (!this.textContent) {
            return [];
        }

        let i = 0;
        let iIndex = 0;
        const bidiTexts: Array<{ str: string }> = this.textContent.items;
        const end = bidiTexts.length - 1;
        const queryLen = this.findController === null ? 0 : this.findController.state.query.length;
        const ret: TextMatch[] = [];

        for (let m = 0, len = matches.length; m < len; m += 1) {
            let matchIdx = matches[m];

            while (i !== end && matchIdx >= (iIndex + bidiTexts[i].str.length)) {
                iIndex += bidiTexts[i].str.length;
                i += 1;
            }

            if (i === bidiTexts.length) {
                console.error('Could not find a matching mapping');
            }

            const match: TextMatch = {
                begin: {
                    divIdx: i,
                    offset: matchIdx - iIndex
                },
                end: {
                    divIdx: i,
                    offset: 0
                }
            };

            matchIdx += queryLen;

            while (i !== end && matchIdx > (iIndex + bidiTexts[i].str.length)) {
                iIndex += bidiTexts[i].str.length;
                i += 1;
            }

            match.end = {
                divIdx: i,
                offset: matchIdx - iIndex
            };
            ret.push(match);
        }

        return ret;
    }

    private renderMatches(matches: TextMatch[]): void {
        if (matches.length === 0 || !this.textContent) {
            return;
        }

        const bidiTexts: Array<{ str: string }> = this.textContent.items;
        const textDivs = this.textDivs;
        let prevEnd: TextMatchPosition | null = null;
        const pageIdx = this.pageIdx;
        const isSelectedPage = this.findController === null ? false : (pageIdx === this.findController.selected.pageIdx);
        const selectedMatchIdx = this.findController === null ? -1 : this.findController.selected.matchIdx;
        const highlightAll = this.findController === null ? false : this.findController.state.highlightAll;
        const infinity = {
            divIdx: -1,
            offset: undefined as number | undefined
        };

        const beginText = (begin: TextMatchPosition, className?: string): void => {
            const divIdx = begin.divIdx;
            textDivs[divIdx].textContent = '';
            appendTextToDiv(divIdx, 0, begin.offset, className);
        };

        const appendTextToDiv = (divIdx: number, fromOffset: number, toOffset: number | undefined, className?: string): void => {
            const div = textDivs[divIdx];
            const content = bidiTexts[divIdx].str.substring(fromOffset, toOffset);
            const node = document.createTextNode(content);
            if (className) {
                const span = document.createElement('span');
                span.className = className;
                span.appendChild(node);
                div.appendChild(span);
                return;
            }
            div.appendChild(node);
        };

        let i0 = selectedMatchIdx;
        let i1 = i0 + 1;
        if (highlightAll) {
            i0 = 0;
            i1 = matches.length;
        }
        for (let i = i0; i < i1; i += 1) {
            const match = matches[i];
            const begin = match.begin;
            const end = match.end;
            const isSelected = i === selectedMatchIdx;
            const highlightSuffix = isSelected ? ' selected' : '';

            if (prevEnd !== null && begin.divIdx === prevEnd.divIdx) {
                appendTextToDiv(prevEnd.divIdx, prevEnd.offset, begin.offset);
            } else {
                if (prevEnd !== null) {
                    if (!isSelected && !highlightAll) {
                        beginText(begin);
                    } else {
                        appendTextToDiv(prevEnd.divIdx, prevEnd.offset, infinity.offset);
                    }
                }
                beginText(begin);
            }

            if (begin.divIdx === end.divIdx) {
                appendTextToDiv(begin.divIdx, begin.offset, end.offset, `highlight${highlightSuffix}`);
            } else {
                appendTextToDiv(begin.divIdx, begin.offset, infinity.offset, `highlight begin${highlightSuffix}`);
                for (let n0 = begin.divIdx + 1, n1 = end.divIdx; n0 < n1; n0 += 1) {
                    textDivs[n0].className = `highlight middle${highlightSuffix}`;
                }
                beginText(end, `highlight end${highlightSuffix}`);
            }
            prevEnd = end;
        }

        if (prevEnd) {
            appendTextToDiv(prevEnd.divIdx, prevEnd.offset, infinity.offset);
        }
    }

    private bindMouse(): void {
        const div = this.textLayerDiv;
        div.addEventListener('mousedown', (event) => {
            const end = div.querySelector('.endOfContent') as HTMLElement | null;
            if (!end) {
                return;
            }
//#if !(MOZCENTRAL || FIREFOX)
            let adjustTop = event.target !== div;
//#if GENERIC
            adjustTop = adjustTop && window.getComputedStyle(end).getPropertyValue('-moz-user-select') !== 'none';
//#endif
            if (adjustTop) {
                const divBounds = div.getBoundingClientRect();
                const ratio = Math.max(0, (event.pageY - divBounds.top) / divBounds.height);
                end.style.top = `${(ratio * 100).toFixed(2)}%`;
            }
//#endif
            end.classList.add('active');
        });
        div.addEventListener('mouseup', () => {
            const end = div.querySelector('.endOfContent') as HTMLElement | null;
            if (!end) {
                return;
            }
//#if !(MOZCENTRAL || FIREFOX)
            end.style.top = '';
//#endif
            end.classList.remove('active');
        });
    }
}

class DefaultTextLayerFactory {
    createTextLayerBuilder(textLayerDiv: HTMLDivElement, pageIndex: number, viewport: PDFPageViewport): TextLayerBuilder {
        return new TextLayerBuilder({
            textLayerDiv,
            pageIndex,
            viewport
        });
    }
}

export { TextLayerBuilder, DefaultTextLayerFactory };
