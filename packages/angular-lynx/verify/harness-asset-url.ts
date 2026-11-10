// `lynxAssetUrl()` — resolving app-relative paths to absolute URLs.
//
// This exists because of a real device-only bug found by running the examples
// on an iOS simulator: a relative `fetch('/resources/…')` works in the web
// preview (a browser resolves it against the document origin) but is rejected
// outright by the native engine, which has no document and no base URL
// (`NSURLErrorDomain -1002 "unsupported URL"`). Three of this repo's own
// examples had it. See docs/22-http.md and runtime/src/asset-url.ts.
//
// `__webpack_public_path__` is a *free identifier* here, so these assertions
// also pin the behaviour that matters most for correctness: reading it must not
// throw when it doesn't exist, and a relative/absent publicPath must leave the
// input untouched rather than produce a wrong URL. Whether a real production
// build actually sets it is checked by `verify:asset-url-build`, which runs one.
// Imported from its own module rather than the package index: `asset-url.ts`
// deliberately has no Angular dependencies, and going through the index would
// drag in the whole runtime (which needs a JIT compiler this harness has no
// reason to boot).
import { bundlePublicPath, lynxAssetUrl } from '../runtime/dist/asset-url.js';

let passed = 0;
function assert(cond: unknown, label: string): void {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`  ✓ ${label}`);
}

const g = globalThis as { __webpack_public_path__?: string };
const setPublicPath = (p: string | undefined): void => {
  if (p === undefined) delete g.__webpack_public_path__;
  else g.__webpack_public_path__ = p;
};

console.log('\n=== No bundler present (the free-identifier case) ===');
setPublicPath(undefined);
assert(bundlePublicPath() === undefined, 'bundlePublicPath() is undefined, and does not throw');
assert(
  lynxAssetUrl('/resources/a.bin') === '/resources/a.bin',
  'a relative path is returned unchanged when there is no base',
);

console.log('\n=== A relative publicPath cannot make anything absolute ===');
for (const p of ['/', 'auto', './']) {
  setPublicPath(p);
  assert(bundlePublicPath() === undefined, `publicPath ${JSON.stringify(p)} reports no usable base`);
  assert(
    lynxAssetUrl('/resources/a.bin') === '/resources/a.bin',
    `publicPath ${JSON.stringify(p)} leaves the input unchanged`,
  );
}

console.log('\n=== An absolute publicPath resolves app-relative paths ===');
setPublicPath('http://192.168.1.129:3000/');
assert(bundlePublicPath() === 'http://192.168.1.129:3000/', 'bundlePublicPath() reports the base');
assert(
  lynxAssetUrl('/resources/robot/RobotExpressive.glb')
    === 'http://192.168.1.129:3000/resources/robot/RobotExpressive.glb',
  'root-relative path resolves against the origin (the real model case)',
);
assert(
  lynxAssetUrl('nested.lynx.bundle') === 'http://192.168.1.129:3000/nested.lynx.bundle',
  'bare relative path resolves (the real <frame src> case)',
);
assert(
  lynxAssetUrl('./nested.lynx.bundle') === 'http://192.168.1.129:3000/nested.lynx.bundle',
  './-relative path resolves without doubling the separator',
);
// A trailing slash on the base and a leading slash on the input must not
// combine into '//', which some servers treat as a different path.
setPublicPath('http://host:3000/');
assert(lynxAssetUrl('/a') === 'http://host:3000/a', 'no doubled slash when both sides have one');
setPublicPath('http://host:3000');
assert(lynxAssetUrl('/a') === 'http://host:3000/a', 'still correct when the base has no slash');
assert(lynxAssetUrl('a') === 'http://host:3000/a', 'a separator is added when neither side has one');

console.log('\n=== Already-absolute inputs are never rewritten ===');
setPublicPath('http://192.168.1.129:3000/');
for (const url of [
  'https://cdn.example.com/x.png',
  'http://other/y.bin',
  '//cdn.example.com/z.png',
  'data:image/png;base64,AAAA',
  'file:///tmp/a.bin',
]) {
  assert(lynxAssetUrl(url) === url, `${url} is returned untouched`);
}

setPublicPath(undefined);
console.log(`\nasset-url: all ${passed} assertions passed`);
