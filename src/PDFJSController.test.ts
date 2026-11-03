import { describe, expect, it } from "vite-plus/test";
import { Events, PDFJSController } from "./PDFJSController.js";

describe("PDFJSController public API", () => {
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
});
