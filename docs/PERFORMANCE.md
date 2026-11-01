# Homepage JavaScript budget

Measure the static production output, not Vite's development modules:

```sh
npm run build
npm run check:size
npm run serve
```

`check:size` is an Nx target and runs in CI. It counts unique JavaScript files in Rivet's entire idle fetch-ahead list (`data-fo`) and its subsequent idle prefetch list (`data-fl`). It reports uncompressed and gzip bytes and the largest chunks. Budgets are 550,000 bytes uncompressed and 190,000 bytes gzip. All routes' output on disk is a different metric: files for deferred examples and the guide are not all needed to open the homepage.

## November 2026 optimization

| Homepage idle fetch      |        Before |         After |
| ------------------------ | ------------: | ------------: |
| JavaScript, uncompressed | 971,179 bytes | 455,249 bytes |
| JavaScript, gzip         | 325,011 bytes | 162,327 bytes |

The original page imported the multi-format normalizer, CSV grid and field inspector eagerly. A shared chunk alone was 287,930 bytes; the table chunk added 122,155 bytes, followed by idle prefetch of its virtualization code.

- The profile starts from an empty snapshot without importing parsers. Playback, stepping or seeking loads the existing engine once. Failed imports can retry; reset, pause and competing seeks invalidate stale work.
- CSV and CSS examples mount near the viewport. Their headings remain server-rendered. The field inspector mounts when its opened panel becomes visible.
- `VisibleRegion` gates mounting explicitly. `clientOnly({ when: 'visible' })` alone is insufficient when an adopting parent renders it as fresh client content: that path mounts immediately. Both the import boundary and visibility guard are necessary.
- Each deferred region has a local Rivet error boundary with a retry button. A failed download does not leave an endless loading state.
- Rivet's locale compilation is limited to the site's English locale. The actual Rivet UI components remain in use.

The deferred code still downloads when someone uses the corresponding examples. gzip figures are reproducible local compression estimates; CDN Brotli transfer sizes differ.

## Browser checks

On a fresh production homepage at the top, leave the page idle and inspect modulepreloads: `seek-stream`, `CsvGridDemo`, `CssStylingDemo`, `ProfileInspector` and table chunks must be absent. Their modules should appear only after the relevant interaction or scrolling. This catches runtime imports that a build graph alone cannot reveal.

Verify profile playback, reset, nested YAML, slider rewind, opening the inspector, CSV rows and CSS transitions. Check the same behavior with a narrow viewport, direct `#csv-demo` links and navigation to the guide. No horizontal page overflow or browser errors should appear.

A temporary production probe also verified lazy-import failure recovery: reject the first load, show a local error and retry button, then succeed on retry. The probe route is not part of the deployed site.
