# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [2.1.0] - 2026-11-04

### Added

- Exported constructor, DOM, event, and document TypeScript types, plus `pageNumber` / `numPages` / `pdfDocument` getters.
- `destroy()` to cancel in-flight work and tear down the current PDF document.
- Optional `doubleBuffer` constructor flag to paint onto a back canvas and swap when the page is ready.
- `pdf-page-rendered` when a page is actually painted onto the visible canvas.
- Optional `willReadFrequently` constructor flag for hosts that call `getImageData` on the canvas.
- GitHub Actions CI for `pnpm check`, `pnpm test`, and `pnpm pack`.

### Changed

- Development now uses pnpm and the Vite+ toolchain (`vp pack`, `vp dev`, `vp check`).
- `loadDocument` accepts a `URL`, replaces a previously loaded document, and clamps the current page into the new page count.
- Page changes render only the latest requested page; in-flight work is cancelled instead of drawing intermediate pages.
- `before-pdf-rendering` fires at the start of each render attempt, before the visible canvas is resized or cleared, so listeners can sample the currently displayed page.
- `after-pdf-rendering` always follows the matching `before-pdf-rendering`, including when that attempt is cancelled or superseded.
- The presentation example and README use `event.key` instead of `keyCode`.
- The presentation example keeps the previous page visible (`doubleBuffer: true`) instead of hiding the canvas during render.

### Fixed

- Declaration files no longer point at a missing `.d.mts.map`.
- The published CSS no longer references a missing `pdf-slide.css.map`.

### Security

- Updated `pdfjs-dist` to 6.5.438, which includes the fix for [CVE-2026-16633](https://github.com/advisories/GHSA-hq66-cqwq-w95j).

## [2.0.0] - 2026-06-21

### Changed

- First 2.x release on npm with an ESM build over pdf.js 6.

[unreleased]: https://github.com/zonuexe/pdf.js-controller/compare/v2.1.0...HEAD
[2.1.0]: https://github.com/zonuexe/pdf.js-controller/compare/v2.0.0...v2.1.0
[2.0.0]: https://github.com/zonuexe/pdf.js-controller/releases/tag/v2.0.0
