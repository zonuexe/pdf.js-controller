#!/usr/bin/env node
const fs = require('fs');
const path = require('path');

const legacyDir = path.dirname(require.resolve('pdfjs-dist/legacy/build/pdf.worker.mjs'));
const workerSource = path.join(legacyDir, 'pdf.worker.mjs');
const workerTarget = path.resolve(__dirname, 'pdf.worker.mjs');
fs.copyFileSync(workerSource, workerTarget);

const workerMapSource = path.join(legacyDir, 'pdf.worker.mjs.map');
if (fs.existsSync(workerMapSource)) {
  fs.copyFileSync(workerMapSource, `${workerTarget}.map`);
}

let cmapsSource = path.resolve(legacyDir, '..', 'cmaps');
if (!fs.existsSync(cmapsSource)) {
  cmapsSource = path.resolve(legacyDir, '..', '..', 'cmaps');
}
if (!fs.existsSync(cmapsSource)) {
  throw new Error('Unable to locate pdfjs-dist cmaps directory');
}
const cmapsTarget = path.resolve(__dirname, 'cmaps');
if (fs.existsSync(cmapsTarget)) {
  fs.rmSync(cmapsTarget, { recursive: true, force: true });
}
fs.cpSync(cmapsSource, cmapsTarget, { recursive: true });
