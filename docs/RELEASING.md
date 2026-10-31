# Releasing TetraStream

The public repository contains the library, demos, guide, and TypeScript development tooling. A GitHub source push is separate from an npm package publication.

## Projects and artifacts

Nx Release selects only `tetra-stream` (`libs/tetra-stream`). It is versioned independently. The private playground is excluded from npm releases.

- Library output: `libs/tetra-stream/dist/`.
- Installable archive: `artifacts/tetra-stream-VERSION.tgz`.
- Stable playground download: `apps/playground/public/downloads/tetra-stream.tgz`.
- Prerendered site output: `dist/apps/playground/client/`, including `guide/index.html`.
- Cloudflare static deployment: `dist/apps/playground/cloudflare/`.

The cacheable `package-preview` target builds and packs the library before playground dev/build. Archives are generated and ignored by Git. `npm run pack` additionally gates packaging on library tests.

## Verify a release candidate

Use Node.js 24+ and install the lockfile exactly:

```sh
npm ci
npm run build
npm test
npm run typecheck
npm run verify:package
```

The package verifier installs the tarball into a separate temporary consumer, checks the allowed package contents and runtime dependencies, compiles public API examples, and executes parsing/patch/selection/validation cases with a real optional validator.

If your local npm cache has permission problems, point `npm_config_cache` at a writable cache directory for the command. Do not modify global cache ownership as part of a release.

## Preview versioning

Before the first release tag exists:

```sh
npm run release:dry-run -- 0.1.0
```

For a complete preview without publishing:

```sh
npx nx release 0.1.0 --first-release --dry-run --skip-publish
```

After the first release, omit `--first-release` and choose an exact version or semver increment. Review generated version and changelog changes before proceeding.

## Manual GitHub workflow

The **Release library** workflow is manually dispatched from `main`. It defaults to a dry run and never runs a publication from an ordinary push or pull request.

1. Choose a version or increment, whether this is the first release, and the dry-run setting.
2. Inspect the dry-run output and verification results.
3. For an intentional npm publication, configure the repository's `NPM_TOKEN` secret with the required package-publishing rights and dispatch with dry run disabled.

A real run versions and creates the release changes without publishing, verifies the bumped package, pushes commits/tags, and then publishes the selected library package. Inspect logs and the existing tag/registry state before retrying an interrupted run.

Package names and versions must be available to the publishing account. The repository metadata and `publishConfig.access` are prepared for a public package; they do not publish or reserve the npm name.

## Local publication

When publishing from an authenticated maintainer workstation, use `npm whoami` to check the account and verify the package name/version before continuing. A local login does not require a GitHub `NPM_TOKEN` secret.

Generate version/changelog changes with Nx, verify them, commit/tag the release, and publish the exact tested archive:

```sh
npx nx release version 0.1.0 --first-release --git-commit=false --git-tag=false --stage-changes=false
npx nx release changelog 0.1.0 --first-release --git-commit=false --git-tag=false --git-push=false --stage-changes=false
npm run build
npm test
npm run typecheck
npm run verify:package
npm publish ./artifacts/tetra-stream-0.1.0.tgz --access public --tag latest
```

To verify a published version through the same isolated consumer, run `TETRA_PACKAGE_SPEC=tetra-stream@VERSION node tools/verify-package.mts`.

Use `--first-release` only for the initial release. After npm confirms publication, push the matching commit and annotated `tetra-stream@VERSION` tag. Verify the registry version and install it in a clean consumer. Do not repeat a publish after an uncertain outcome until you have checked the registry; npm versions are immutable.

## Source-only releases

For a source push, verify the prepared tree and push `main` normally. Do not force-push to replace remote history. No npm token, package publication, or GitHub Release is required to share the source repository.
