#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const buildDir = path.dirname(require.resolve('pdfjs-dist/build/pdf.worker.mjs'));
const workerSource = path.join(buildDir, 'pdf.worker.mjs');
const workerTarget = path.resolve(__dirname, 'pdf.worker.mjs');
fs.copyFileSync(workerSource, workerTarget);

const workerMapSource = path.join(buildDir, 'pdf.worker.mjs.map');
if (fs.existsSync(workerMapSource)) {
  fs.copyFileSync(workerMapSource, `${workerTarget}.map`);
}

let cmapsSource = path.resolve(buildDir, '..', 'cmaps');
if (!fs.existsSync(cmapsSource)) {
  throw new Error('Unable to locate pdfjs-dist cmaps directory');
}
const cmapsTarget = path.resolve(__dirname, 'cmaps');
if (fs.existsSync(cmapsTarget)) {
  fs.rmSync(cmapsTarget, { recursive: true, force: true });
}
fs.cpSync(cmapsSource, cmapsTarget, { recursive: true });

const controllerSource = require.resolve('@zonuexe/pdf.js-controller/build/PDFJSController.js');
const controllerDir = path.resolve(__dirname, 'vendor');
const controllerTarget = path.join(controllerDir, 'pdfjs-controller.js');
fs.mkdirSync(controllerDir, { recursive: true });
fs.copyFileSync(controllerSource, controllerTarget);

const controllerMapSource = `${controllerSource}.map`;
if (fs.existsSync(controllerMapSource)) {
  fs.copyFileSync(controllerMapSource, `${controllerTarget}.map`);
}
