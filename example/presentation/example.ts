// LICENSE : MIT

import "pdfjs-dist/web/pdf_viewer.css";
import "@zonuexe/pdf.js-controller/css/pdf-slide.css";
import PDFController, { Events } from "@zonuexe/pdf.js-controller";
import workerSrc from "pdfjs-dist/build/pdf.worker.mjs?url";
import pdfUrl from "./example.pdf?url";

const container = document.getElementById("pdf-container");
if (!container) {
  throw new Error("Missing #pdf-container element");
}

const controller = new PDFController({
  container,
  workerSrc,
  cMapUrl: `${import.meta.env.BASE_URL}cmaps/`,
  cMapPacked: true,
});

controller
  .loadDocument(pdfUrl)
  .then(initializedEvent)
  .catch((error: unknown) => {
    console.error(error);
  });

function getCornerColor(context: CanvasRenderingContext2D): string {
  const canvasColor = context.getImageData(0, 0, 1, 1);
  const pixels = canvasColor.data;
  const [r, g, b] = pixels;
  return `rgb(${r},${g},${b})`;
}

container.addEventListener(Events.before_pdf_rendering, () => {
  const context = controller.canvasContext;
  const cornerColor = getCornerColor(context);
  container.style.backgroundColor = cornerColor;
  document.body.style.backgroundColor = cornerColor;
  controller.domMapObject.canvas.style.visibility = "hidden";
});

container.addEventListener(Events.after_pdf_rendering, () => {
  const context = controller.canvasContext;
  const cornerColor = getCornerColor(context);
  container.style.backgroundColor = cornerColor;
  document.body.style.backgroundColor = cornerColor;
  controller.domMapObject.canvas.style.visibility = "visible";
});

function initializedEvent(): void {
  document.getElementById("js-prev")?.addEventListener("click", () => void controller.prevPage());
  document.getElementById("js-next")?.addEventListener("click", () => void controller.nextPage());

  window.addEventListener("resize", () => {
    void controller.fitItSize();
  });

  document.addEventListener("keydown", (event: KeyboardEvent) => {
    if (event.shiftKey || event.ctrlKey || event.metaKey) {
      return;
    }
    const { key } = event;
    if (key === "ArrowLeft" || key === "ArrowDown" || key === "k" || key === "a") {
      event.preventDefault();
      void controller.prevPage();
    } else if (key === "ArrowUp" || key === "ArrowRight" || key === "j" || key === "s") {
      event.preventDefault();
      void controller.nextPage();
    }
  });
}
