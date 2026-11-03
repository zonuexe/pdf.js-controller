import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Events, PDFJSController } from "./PDFJSController.js";

const { harness } = vi.hoisted(() => {
  class RenderingCancelledException extends Error {
    extraDelay = 0;
    constructor(message = "Rendering cancelled") {
      super(message);
      this.name = "RenderingCancelledException";
    }
  }

  type RenderStart = {
    pageNumber: number;
    resolve: () => void;
    cancel: () => void;
  };

  const state = {
    autoResolve: true,
    getPageCalls: [] as number[],
    numPages: 8,
    renderStarts: [] as RenderStart[],
  };

  const reset = (): void => {
    state.autoResolve = true;
    state.getPageCalls = [];
    state.numPages = 8;
    state.renderStarts = [];
  };

  return { harness: { RenderingCancelledException, reset, state } };
});

vi.mock("pdfjs-dist", () => {
  const { RenderingCancelledException, state } = harness;
  return {
    RenderingCancelledException,
    GlobalWorkerOptions: { workerSrc: "" },
    getDocument() {
      return {
        destroyed: false,
        promise: Promise.resolve({
          numPages: state.numPages,
          async getPage(pageNumber: number) {
            state.getPageCalls.push(pageNumber);
            return {
              getViewport({ scale }: { scale: number }) {
                const width = 200 * scale;
                const height = 100 * scale;
                return {
                  width,
                  height,
                  clone() {
                    return { width, height };
                  },
                };
              },
              render() {
                let settled = false;
                let resolveFn = (): void => undefined;
                let rejectFn = (_error: unknown): void => undefined;
                const promise = new Promise<void>((resolve, reject) => {
                  resolveFn = () => {
                    if (settled) {
                      return;
                    }
                    settled = true;
                    resolve();
                  };
                  rejectFn = (error: unknown) => {
                    if (settled) {
                      return;
                    }
                    settled = true;
                    reject(error);
                  };
                });
                const start: (typeof state.renderStarts)[number] = {
                  pageNumber,
                  resolve: resolveFn,
                  cancel() {
                    rejectFn(new RenderingCancelledException());
                  },
                };
                state.renderStarts.push(start);
                if (state.autoResolve) {
                  queueMicrotask(resolveFn);
                }
                return {
                  promise,
                  cancel() {
                    start.cancel();
                  },
                };
              },
            };
          },
        }),
        async destroy() {
          this.destroyed = true;
        },
      };
    },
  };
});

vi.mock("pdfjs-dist/web/pdf_viewer.mjs", () => ({
  EventBus: class EventBus {},
  SimpleLinkService: class SimpleLinkService {
    setDocument(_document: unknown): void {
      /* test stub */
    }
  },
  TextLayerBuilder: class TextLayerBuilder {
    #onAppend?: (div: HTMLDivElement) => void;
    constructor({ onAppend }: { onAppend?: (div: HTMLDivElement) => void }) {
      this.#onAppend = onAppend;
    }
    async render(): Promise<void> {
      const div = document.createElement("div");
      div.className = "textLayer";
      this.#onAppend?.(div);
    }
  },
  AnnotationLayerBuilder: class AnnotationLayerBuilder {
    #onAppend?: (div: HTMLDivElement) => void;
    constructor({ onAppend }: { onAppend?: (div: HTMLDivElement) => void }) {
      this.#onAppend = onAppend;
    }
    async render(): Promise<void> {
      const div = document.createElement("div");
      div.className = "annotationLayer";
      this.#onAppend?.(div);
    }
  },
}));

const originalGetContext = Object.getOwnPropertyDescriptor(
  HTMLCanvasElement.prototype,
  "getContext",
);

const stub2dContext = (): void => {
  const contexts = new WeakMap<HTMLCanvasElement, CanvasRenderingContext2D>();
  HTMLCanvasElement.prototype.getContext = function getContext(this: HTMLCanvasElement) {
    let context = contexts.get(this);
    if (!context) {
      context = {
        canvas: this,
        setTransform() {
          /* happy-dom does not implement CanvasRenderingContext2D */
        },
      } as unknown as CanvasRenderingContext2D;
      contexts.set(this, context);
    }
    return context;
  } as unknown as typeof HTMLCanvasElement.prototype.getContext;
};

const trackEvents = (container: HTMLElement): { before: number; after: number } => {
  const counts = { before: 0, after: 0 };
  container.addEventListener(Events.before_pdf_rendering, () => {
    counts.before += 1;
  });
  container.addEventListener(Events.after_pdf_rendering, () => {
    counts.after += 1;
  });
  return counts;
};

describe("PDFJSController public API", () => {
  beforeEach(() => {
    harness.reset();
    stub2dContext();
  });

  afterEach(() => {
    if (originalGetContext) {
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
    }
  });

  it("exposes literal rendering event names", () => {
    expect(Events.before_pdf_rendering).toBe("before-pdf-rendering");
    expect(Events.after_pdf_rendering).toBe("after-pdf-rendering");
    expect(PDFJSController.Events).toBe(Events);
  });

  it("rejects a template that is missing required elements", () => {
    const container = document.createElement("div");
    expect(() => new PDFJSController({ container, innerHTML: "<div></div>" })).toThrow(
      /Missing required canvas element/,
    );
  });

  it("defaults doubleBuffer to false", () => {
    const container = document.createElement("div");
    const controller = new PDFJSController({ container });
    expect(controller.doubleBuffer).toBe(false);
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
  });

  it("keeps the back canvas out of the container when doubleBuffer is on", () => {
    const container = document.createElement("div");
    const controller = new PDFJSController({ container, doubleBuffer: true });
    expect(controller.doubleBuffer).toBe(true);
    expect(container.querySelectorAll("canvas")).toHaveLength(1);
  });
});

describe("PDFJSController rendering", () => {
  beforeEach(() => {
    harness.reset();
    stub2dContext();
  });

  afterEach(() => {
    if (originalGetContext) {
      Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
    }
  });

  it("pairs before and after events on a successful render", async () => {
    const container = document.createElement("div");
    const counts = trackEvents(container);
    const controller = new PDFJSController({ container });
    await controller.loadDocument("https://example.test/doc.pdf");
    expect(counts).toEqual({ before: 1, after: 1 });
    expect(controller.pageNumber).toBe(1);
  });

  it("fires before-pdf-rendering before resizing the visible canvas", async () => {
    const container = document.createElement("div");
    const controller = new PDFJSController({ container });
    const canvas = controller.domMapObject.canvas;
    const widthBeforeLoad = canvas.width;
    let widthAtBefore = -1;
    container.addEventListener(Events.before_pdf_rendering, () => {
      widthAtBefore = canvas.width;
    });
    await controller.loadDocument("https://example.test/doc.pdf");
    expect(widthAtBefore).toBe(widthBeforeLoad);
    expect(canvas.width).toBeGreaterThan(widthBeforeLoad);
  });

  it("pairs before and after when a render is cancelled and coalesced", async () => {
    harness.state.autoResolve = false;
    const container = document.createElement("div");
    const counts = trackEvents(container);
    const controller = new PDFJSController({ container });
    const loaded = controller.loadDocument("https://example.test/doc.pdf");

    await vi.waitFor(() => {
      expect(harness.state.renderStarts).toHaveLength(1);
    });
    void controller.nextPage();
    void controller.nextPage();
    void controller.nextPage();

    await vi.waitFor(() => {
      expect(harness.state.renderStarts.at(-1)?.pageNumber).toBe(4);
    });
    harness.state.renderStarts.at(-1)?.resolve();
    await loaded;

    expect(harness.state.getPageCalls[0]).toBe(1);
    expect(harness.state.getPageCalls.at(-1)).toBe(4);
    expect(harness.state.getPageCalls).not.toContain(2);
    expect(harness.state.getPageCalls).not.toContain(3);
    expect(counts.before).toBe(counts.after);
    expect(counts.before).toBeGreaterThanOrEqual(2);
    expect(controller.pageNumber).toBe(4);
  });

  it("swaps the displayed canvas and keeps canvasContext in sync", async () => {
    const container = document.createElement("div");
    const controller = new PDFJSController({ container, doubleBuffer: true });
    const original = controller.domMapObject.canvas;
    await controller.loadDocument("https://example.test/doc.pdf");

    const displayed = controller.domMapObject.canvas;
    expect(displayed).not.toBe(original);
    expect(container.contains(displayed)).toBe(true);
    expect(container.contains(original)).toBe(false);
    expect(controller.canvasContext).toBe(displayed.getContext("2d"));
  });
});
