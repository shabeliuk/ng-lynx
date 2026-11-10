# Native modules — `injectNativeModule`

A Lynx host app registers **native modules** — toast, storage, analytics,
navigation, a generic `bridge`, whatever the host exposes — reachable on the
Background Thread as a bare global `NativeModules`. Reaching for that global
directly is untyped and unmockable. `injectNativeModule` wraps it behind a DI
token instead.

## Using a native module

```ts
import { inject, Injectable } from '@angular/core';
import { injectNativeModule } from 'angular-lynx';

interface StorageModule {
  getItem(key: string): string | undefined;
  setItem(key: string, value: string): void;
}

@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly storage = injectNativeModule<StorageModule>('StorageModule');

  get theme(): string {
    return this.storage?.getItem('theme') ?? 'light';
  }
  set theme(value: string) {
    this.storage?.setItem('theme', value);
  }
}
```

`injectNativeModule<T>(name)` must be called in an injection context
(constructor, field initializer). It returns the module typed as `T`, or
`undefined` if the host didn't register it (with a dev-mode warning). You
supply the `T` interface — angular-lynx can't know your host's module shapes.

## The generic bridge

Many hosts expose a single `bridge` with `call` / `on` instead of discrete
modules:

```ts
import { injectNativeBridge } from 'angular-lynx';

const bridge = injectNativeBridge();
bridge?.call('haptics', { style: 'light' }, (result) => { … });
bridge?.on('deeplink', (url) => { … });
```

## Testing & custom registries

The registry is a DI token (`LYNX_NATIVE_MODULES`), so tests substitute fakes
with one provider — no globals to stub:

```ts
import { provideLynxNativeModules } from 'angular-lynx';

const fixture = await renderLynxComponent(SettingsComponent, {
  providers: [
    provideLynxNativeModules({
      StorageModule: { getItem: () => 'dark', setItem: vi.fn() },
    }),
  ],
});
```

The same override works in production for a curated subset or a shim over the
host's modules. Without an override, the token resolves the host's global
`NativeModules` (or `{}` off-device).

## Notes

- The web preview registers only a minimal module set, so real host modules
  are best exercised on-device — but the **DI substitution above means your
  app logic is fully testable headlessly** regardless.
- Module calls are ordinary JS on the Background Thread; async results arrive
  via callbacks. A signal write from a callback drives zoneless change
  detection like any other.

## Verifying

`npm run verify:native-modules` provides a fake registry, reads a typed module
(rendered into the view), calls the generic bridge, confirms a missing module
resolves to `undefined` (no throw), and round-trips a write through the module
+ a signal update.
