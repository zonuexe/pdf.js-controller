// LICENSE : MIT

import PDFController from '@zonuexe/pdf.js-controller';

const container = document.getElementById('pdf-container');
if (!container) {
    throw new Error('Missing #pdf-container element');
}

const controller = new PDFController({
    container,
    workerSrc: new URL('./pdf.worker.mjs', import.meta.url).toString(),
    cMapUrl: new URL('./cmaps/', import.meta.url).toString(),
    cMapPacked: true
});

const PDFURL = './example.pdf';
controller.loadDocument(PDFURL).then(initializedEvent).catch((error) => {
    console.error(error);
});

function getCornerColor(context) {
    const canvasColor = context.getImageData(0, 0, 1, 1);
    const pixels = canvasColor.data;
    const [r, g, b] = pixels;
    return `rgb(${r},${g},${b})`;
}

container.addEventListener(PDFController.Events.before_pdf_rendering, () => {
    const context = controller.canvasContext;
    const cornerColor = getCornerColor(context);
    container.style.backgroundColor = cornerColor;
    document.body.style.backgroundColor = cornerColor;
    controller.domMapObject.canvas.style.visibility = 'hidden';
});

container.addEventListener(PDFController.Events.after_pdf_rendering, () => {
    const context = controller.canvasContext;
    const cornerColor = getCornerColor(context);
    container.style.backgroundColor = cornerColor;
    document.body.style.backgroundColor = cornerColor;
    controller.domMapObject.canvas.style.visibility = 'visible';
});

function initializedEvent() {
    document.getElementById('js-prev')?.addEventListener('click', controller.prevPage.bind(controller));
    document.getElementById('js-next')?.addEventListener('click', controller.nextPage.bind(controller));

    window.addEventListener('resize', () => {
        void controller.fitItSize();
    });

    document.addEventListener('keydown', (event) => {
        if (event.shiftKey || event.ctrlKey || event.metaKey) {
            return;
        }
        const kc = event.keyCode;
        if (kc === 37 || kc === 40 || kc === 75 || kc === 65) {
            event.preventDefault();
            void controller.prevPage();
        } else if (kc === 38 || kc === 39 || kc === 74 || kc === 83) {
            event.preventDefault();
            void controller.nextPage();
        }
    });
}
