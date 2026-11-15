/**
 * `lynxAssetUrl()` — turn an app-relative path into an absolute URL before
 * handing it to `fetch`, `<frame src>`, `<image src>`, or anything else that
 * loads by URL.
 *
 * ## Why this is needed
 *
 * A browser resolves `fetch('/resources/thing.bin')` against the document's
 * origin. **There is no document on Lynx**, and no base URL, so a
 * root-relative (or `./`-relative) path reaches the platform networking layer
 * unchanged and is rejected. Confirmed on an iOS simulator:
 *
 * ```
 * NSURLErrorDomain Code=-1002 "unsupported URL"
 * NSErrorFailingURLStringKey=/resources/girl/standing_idle.fbx
 * ```
 *
 * The trap is that it works perfectly in the **web preview** — which does have
 * a document origin — so this only breaks once you run on a real engine, and
 * it tends to break *misleadingly*. When `examples/threejs-rpg-skeleton` loaded
 * an FBX, the rejected request still produced an (empty) buffer, so what
 * surfaced was `THREE.FBXLoader: Cannot find the version number for the file
 * given` — an error about the file's *contents*, pointing away from the real cause. In
 * `examples/primitives` a `<frame src="nested.lynx.bundle">` simply reported
 * `bundle not loaded`. Three of this repo's own examples had the bug.
 *
 * ## What it resolves against
 *
 * `__webpack_public_path__` — the absolute origin the running bundle was served
 * from. Anything in your app's `public/` directory is served at that origin's
 * root, so it's the correct base for app-owned assets. The dev server sets it to
 * its own address. A production build gets it from `output.assetPrefix`, and
 * without one it's `/`, which can't be resolved on a device.
 *
 * Inputs that are already absolute (`http://`, `https://`, or any `scheme:`)
 * are returned untouched, so it's safe to pass user- or host-supplied URLs
 * through it. If no absolute base is available — a non-webpack build, or a
 * host that didn't set one — the input is returned unchanged rather than
 * guessed at, which keeps the web preview working exactly as before.
 *
 * ```ts
 * const res = await fetch(lynxAssetUrl('/resources/model.fbx'));
 * ```
 *
 * @public
 */
export function lynxAssetUrl(pathOrUrl: string): string {
  // Already absolute (has a scheme, or is protocol-relative) — leave alone.
  if (/^[a-z][a-z0-9+.-]*:/i.test(pathOrUrl) || pathOrUrl.startsWith('//')) {
    return pathOrUrl;
  }

  const base = bundlePublicPath();
  if (!base) return pathOrUrl;

  const trimmedBase = base.replace(/\/+$/, '');
  const suffix = pathOrUrl.replace(/^\.\//, '');
  return suffix.startsWith('/') ? `${trimmedBase}${suffix}` : `${trimmedBase}/${suffix}`;
}

/**
 * The absolute origin+path this bundle was served from, or `undefined`.
 *
 * It has to be this name and not `__webpack_require__.p`: the bundler only emits
 * the runtime code that sets `.p` when something uses `__webpack_public_path__`.
 * Reading `.p` alone found it set by the dev client under `rspeedy dev`, and
 * `undefined` in a production build, so every asset URL stayed relative.
 *
 * Guarded by `typeof` because it's a free identifier: in a non-webpack build (a
 * plain esbuild harness, a unit test) referencing it throws `ReferenceError`.
 *
 * @public
 */
export function bundlePublicPath(): string | undefined {
  const publicPath: unknown =
    typeof __webpack_public_path__ !== 'undefined' ? __webpack_public_path__ : undefined;
  // Only an absolute base is useful here; a relative publicPath ('/', 'auto')
  // can't make a relative input absolute, so report it as unavailable.
  return typeof publicPath === 'string' && /^https?:\/\//i.test(publicPath)
    ? publicPath
    : undefined;
}

/** Injected by the bundler; declared so this module type-checks standalone. */
declare const __webpack_public_path__: string | undefined;
