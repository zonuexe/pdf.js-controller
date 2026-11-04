import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { Events, PDFJSController } from "./PDFJSController.js";
import {
  pdfjsTestState,
  resetPdfjsTestState,
  restore2dContext,
  stub2dContext,
} from "./pdfjs-test-harness.js";

vi.mock("pdfjs-dist", async () => {
  const { createPdfjsDistMock } = await import("./pdfjs-test-harness.js");
  return createPdfjsDistMock();
});

vi.mock("pdfjs-dist/web/pdf_viewer.mjs", async () => {
  const { createPdfViewerMock } = await import("./pdfjs-test-harness.js");
  return createPdfViewerMock();
});

const trackEvents = (
  container: HTMLElement,
): { before: number; after: number; rendered: number } => {
  const counts = { before: 0, after: 0, rendered: 0 };
  container.addEventListener(Events.before_pdf_rendering, () => {
    counts.before += 1;
  });
  container.addEventListener(Events.after_pdf_rendering, () => {
    counts.after += 1;
  });
  container.addEventListener(Events.page_rendered, () => {
    counts.rendered += 1;
  });
  return counts;
};

describe("PDFJSController public API", () => {
  beforeEach(() => {
    resetPdfjsTestState();
    stub2dContext();
  });

  afterEach(() => {
    restore2dContext();
  });

  it("exposes literal rendering event names", () => {
    expect(Events.before_pdf_rendering).toBe("before-pdf-rendering");
    expect(Events.after_pdf_rendering).toBe("after-pdf-rendering");
    expect(Events.page_rendered).toBe("pdf-page-rendered");
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
    resetPdfjsTestState();
    stub2dContext();
  });

  afterEach(() => {
    restore2dContext();
  });

  it("pairs before and after events on a successful render", async () => {
    const container = document.createElement("div");
    const counts = trackEvents(container);
    const controller = new PDFJSController({ container });
    await controller.loadDocument("https://example.test/doc.pdf");
    expect(counts).toEqual({ before: 1, after: 1, rendered: 1 });
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
    pdfjsTestState.autoResolve = false;
    const container = document.createElement("div");
    const counts = trackEvents(container);
    const controller = new PDFJSController({ container });
    const loaded = controller.loadDocument("https://example.test/doc.pdf");

    await vi.waitFor(() => {
      expect(pdfjsTestState.renderStarts).toHaveLength(1);
    });
    void controller.nextPage();
    void controller.nextPage();
    void controller.nextPage();

    await vi.waitFor(() => {
      expect(pdfjsTestState.renderStarts.at(-1)?.pageNumber).toBe(4);
    });
    pdfjsTestState.renderStarts.at(-1)?.resolve();
    await loaded;

    expect(pdfjsTestState.getPageCalls[0]).toBe(1);
    expect(pdfjsTestState.getPageCalls.at(-1)).toBe(4);
    expect(pdfjsTestState.getPageCalls).not.toContain(2);
    expect(pdfjsTestState.getPageCalls).not.toContain(3);
    expect(counts.before).toBe(counts.after);
    expect(counts.before).toBeGreaterThanOrEqual(2);
    expect(counts.rendered).toBe(1);
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
