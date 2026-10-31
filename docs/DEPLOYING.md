# Deploying TetraStream

The website is a Rivet static application. `@rivetjs/router` renders `/` and `/guide/` into HTML at build time; interactive Rivet UI demos resume in the browser. The Cloudflare adapter emits an assets-only Worker configuration with no application server entry.

## Build and verify

Use Node.js 24+:

```sh
npm ci
npm run build
npm test
npm run typecheck
```

- `dist/apps/playground/client/`: prerendered HTML, assets, and downloadable library archive.
- `dist/apps/playground/server/`: build-time renderer; not deployed in static mode.
- `dist/apps/playground/cloudflare/static/`: assets uploaded to Cloudflare.
- `dist/apps/playground/cloudflare/wrangler.json`: generated deployment configuration.

The source `apps/playground/wrangler.jsonc` declares Worker name `tetrastream` and custom domain `tetrastream.severyn.pro`. Edit the source, not the generated file. Cloudflare assets serve canonical trailing-slash URLs and return 404 for unknown routes.

## Serve the production build locally

```sh
npm run serve
# or: npx nx run playground:serve
```

This builds the static production output, then starts Cloudflare's local asset server at `http://127.0.0.1:4173`. It serves the exact generated Cloudflare assets and URL rules, including `/guide/`. It does not publish anything or run Vite's development server.

## Publish

Sign in to the Cloudflare account that owns `severyn.pro`, then run:

```sh
npx wrangler login
npx nx run playground:deploy
```

The Nx deploy target builds the library preview archive, client bundle, server renderer, and prerendered pages before running Wrangler. The Cloudflare adapter creates the generated configuration; Wrangler attaches the custom domain and provisions DNS/TLS. Do not overwrite an unrelated existing hostname or Worker.

For a preview of the upload configuration:

```sh
npx nx build playground
npx wrangler deploy --config dist/apps/playground/cloudflare/wrangler.json --dry-run
```

Verify `/`, `/guide/`, the user-card/CSV/CSS controls, the avatar, and `/downloads/tetra-stream.tgz` after deployment. Deployments require an authenticated maintainer; ordinary GitHub CI only verifies builds and packages.
