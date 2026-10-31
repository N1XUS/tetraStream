# Contributing to TetraStream

## Set up

Use Node.js 24+ and npm. The library's published JavaScript targets Node.js 20+; development uses Node's native TypeScript execution for tests and tools.

```sh
git clone https://github.com/N1XUS/tetraStream.git
cd tetraStream
npm ci
npm run dev
```

The development server includes the playground and `/guide/`. Nx generates the downloadable preview package before starting the app.

## Make a change

- Keep authored source, tests, benchmarks, and tools in TypeScript (`.ts`, `.tsx`, or `.mts`). Keep strict checking enabled.
- Preserve the distinction between partial values, syntactically complete fields, and validated output. Add a regression test for parser or binding behavior changes.
- Exercise chunk boundaries: a delimiter, escape, quote, UTF-8 character, or record boundary can arrive in another chunk.
- Use the installed Rivet UI components for the playground. Check their types and composition before introducing a custom component substitute. See [the component inventory](docs/rivet-ui-components.md).
- Define the source and rendering behavior in documentation examples. Examples are compiled without ambient application stubs by the integration test.
- Keep generated output out of commits: `dist`, `.nx`, `artifacts`, and downloadable tarballs are ignored.

Library imports ending in `.js` deliberately target the emitted ESM files. Browser app imports may point to `.ts`; the Rivet/Vite compiler handles them.

## Verify

```sh
npm run format:check
npm run build
npm test
npm run typecheck
npm run verify:package
```

The package check installs the archive into a separate temporary consumer and verifies ESM execution, TypeScript declarations, and optional schema compatibility. Compiler-only negative tests use `.typecheck.ts`; runtime tests use `.test.ts`.

For parser performance changes, run `npm run benchmark` and describe the workload and tradeoffs. Benchmark results are local observations, not universal throughput guarantees.

## Submit

Open a focused pull request against `main`. Describe the user-visible problem, resulting behavior, and verification. Include a screenshot for UI changes and a minimal input/chunk sequence for parser fixes.

Do not change package versions or publish artifacts as part of an ordinary contribution. See [release instructions](docs/RELEASING.md).

Contributions are licensed under the project's [MIT license](LICENSE).

Run `npm run format` to apply the repository Prettier configuration to source, tests, configuration, and documentation. Generated files and local build/tool state are ignored.
