// Verify the error a default build gives when @ngtools/webpack isn't installed. It's an
// optional peer, because `aot: false` doesn't need it, so an install can easily miss it.
//
// Runs the built plugin with the module made unresolvable, as it is in that install.
import Module from 'node:module';

const resolveFilename = Module._resolveFilename;
Module._resolveFilename = function (request, ...rest) {
  if (request === '@ngtools/webpack') {
    const err = new Error("Cannot find module '@ngtools/webpack'");
    err.code = 'MODULE_NOT_FOUND';
    throw err;
  }
  return resolveFilename.call(this, request, ...rest);
};

const { pluginAngularLynx } = await import('../plugin/dist/index.js');

// Every hook on the plugin API is a no-op: only `setup` throwing matters here.
const api = new Proxy({}, { get: () => () => {} });

let passed = 0;
function assert(cond, label) {
  if (!cond) {
    console.error(`✗ ${label}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`✓ ${label}`);
}

let message;
try {
  pluginAngularLynx({}).setup(api);
} catch (err) {
  message = err.message;
}
assert(message !== undefined, 'the default (AOT) build stops');
assert(message.startsWith('[angular-lynx]'), 'the error is ours, not a raw MODULE_NOT_FOUND');
assert(message.includes('npm install -D @ngtools/webpack'), 'it says what to install');
assert(message.includes('aot: false'), 'it gives the alternative');

let threw = false;
try {
  pluginAngularLynx({ aot: false }).setup(api);
} catch {
  threw = true;
}
assert(!threw, '`aot: false` still works without it');

console.log(`\n✅ ${passed} ngtools-missing assertions passed.\n`);
