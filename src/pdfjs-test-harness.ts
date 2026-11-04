export class RenderingCancelledException extends Error {
  extraDelay = 0;
  constructor(message = "Rendering cancelled") {
    super(message);
    this.name = "RenderingCancelledException";
  }
}

export type PdfjsTestRenderStart = {
  pageNumber: number;
  resolve: () => void;
  cancel: () => void;
};

export const pdfjsTestState = {
  autoResolve: true,
  getPageCalls: [] as number[],
  numPages: 8,
  renderStarts: [] as PdfjsTestRenderStart[],
};

export const resetPdfjsTestState = (): void => {
  pdfjsTestState.autoResolve = true;
  pdfjsTestState.getPageCalls = [];
  pdfjsTestState.numPages = 8;
  pdfjsTestState.renderStarts = [];
};

export const createPdfjsDistMock = (): {
  RenderingCancelledException: typeof RenderingCancelledException;
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: () => {
    destroyed: boolean;
    promise: Promise<{
      numPages: number;
      getPage: (pageNumber: number) => Promise<{
        getViewport: (options: { scale: number }) => {
          width: number;
          height: number;
          clone: () => { width: number; height: number };
        };
        render: () => { promise: Promise<void>; cancel: () => void };
      }>;
    }>;
    destroy: () => Promise<void>;
  };
} => ({
  RenderingCancelledException,
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument() {
    return {
      destroyed: false,
      promise: Promise.resolve({
        numPages: pdfjsTestState.numPages,
        async getPage(pageNumber: number) {
          pdfjsTestState.getPageCalls.push(pageNumber);
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
              const start: PdfjsTestRenderStart = {
                pageNumber,
                resolve: resolveFn,
                cancel() {
                  rejectFn(new RenderingCancelledException());
                },
              };
              pdfjsTestState.renderStarts.push(start);
              if (pdfjsTestState.autoResolve) {
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
});

export const createPdfViewerMock = (): {
  EventBus: new () => object;
  SimpleLinkService: new () => { setDocument: (_document: unknown) => void };
  TextLayerBuilder: new (options: { onAppend?: (div: HTMLDivElement) => void }) => {
    render: () => Promise<void>;
  };
  AnnotationLayerBuilder: new (options: { onAppend?: (div: HTMLDivElement) => void }) => {
    render: () => Promise<void>;
  };
} => ({
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
});

const originalGetContext = Object.getOwnPropertyDescriptor(
  HTMLCanvasElement.prototype,
  "getContext",
);

export const stub2dContext = (): void => {
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

export const restore2dContext = (): void => {
  if (originalGetContext) {
    Object.defineProperty(HTMLCanvasElement.prototype, "getContext", originalGetContext);
  }
};
