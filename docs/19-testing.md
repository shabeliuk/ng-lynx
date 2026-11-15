# Testing — `ng-lynx/testing`

Headless component testing for Angular-on-Lynx, in plain Node — no device, no
simulator, no browser. The package is the same environment ng-lynx's own
verification harnesses run on, made public:

- the **real** `LynxRenderer2`, wire protocol, and Main-Thread executor run;
- only the element PAPI is mocked — every `__CreateView` / `__SetAttribute` /
  `__AddEvent` builds an in-memory tree your test can query;
- events fire through the **real sign registry**, exactly like a native tap.

## Quick start (Vitest or Jest)

```ts
import '@angular/compiler'; // JIT — must come first
import 'ng-lynx/main-thread'; // installs the ops executor

import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';
import { renderLynxComponent } from 'ng-lynx/testing';

@Component({
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="btn" (tap)="inc()">
      <text>Count: {{ count() }}</text>
    </view>
  `,
})
class CounterComponent {
  readonly count = signal(0);
  inc() { this.count.update((n) => n + 1); }
}

it('increments on tap', async () => {
  const fixture = await renderLynxComponent(CounterComponent);

  // The tap bubbles from the <text> to the button's (tap).
  await fixture.fire(fixture.getByText('Count: 0'), 'tap');
  expect(fixture.queryByText('Count: 1')).not.toBeNull();

  fixture.destroy();
});
```

Runner config: the TS transform needs `experimentalDecorators: true` and
`useDefineForClassFields: false` (same as the app tsconfig from
[02 — Getting started](02-getting-started.md)). For Vitest:

```ts
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  esbuild: {
    tsconfigRaw: { compilerOptions: { experimentalDecorators: true, useDefineForClassFields: false } },
  },
});
```

For Jest: Angular and ng-lynx are ES modules only, so Jest runs in its ESM
mode (`node --experimental-vm-modules node_modules/jest/bin/jest.js`), with
`@swc/jest` for TypeScript and decorators:

```js
// jest.config.js (with "type": "module" in package.json)
export default {
  testEnvironment: 'node',
  extensionsToTreatAsEsm: ['.ts'],
  transform: {
    '^.+\\.ts$': ['@swc/jest', {
      jsc: {
        parser: { syntax: 'typescript', decorators: true },
        transform: { legacyDecorator: true, useDefineForClassFields: false },
        target: 'es2022',
      },
      module: { type: 'es6' },
    }],
  },
};
```

`scripts/verify-consumer.mjs` runs the quick start under both, against the packed
tarball, on Angular 21 and 22.

## The fixture API

`renderLynxComponent(Component, { providers? })` boots the component onto a
fresh mock page and resolves once the first render has been applied:

| Member | What it does |
| --- | --- |
| `instance` | The root component instance (poke signals directly). |
| `page` | The mock native root — walk `children`, read `attrs` / `text` / `events`. |
| `getByText(t)` / `queryByText(t)` / `getAllByText(t)` / `queryAllByText(t)` | The element showing text `t`: the whole text (whitespace collapsed), a `RegExp`, or a substring with `{ exact: false }`. Nested text matches its innermost element. `getBy…` throws, with the tree, when nothing or more than one element matches; `queryBy…` returns `null`. |
| `findText(s)` / `findByClass(c)` / `findAllByClass(c)` / `findByType(t)` | Tree queries. `findText` returns the text, not the element. |
| `tree()` | Printable tree — drop it into a failure message. |
| `fire(el, event, payload?)` | Fire a native event through the sign registry and wait for the re-render. It bubbles like a real tap: the nearest element from `el` up with a listener gets it. **Throws if none listens** — a typo'd event name fails the test instead of silently passing. |

`within(el)` gives the same queries scoped to one subtree, and `textContent(el)`
the text an element shows:

```ts
import { textContent, within } from 'ng-lynx/testing';

const pear = fixture.findAllByClass('card')[1]!;
await fixture.fire(within(pear).getByText('Buy'), 'tap');
expect(textContent(fixture.findByClass('total')!)).toBe('Total: Pear');
```
| `stable()` | Await pending change detection + ops flushes (use after mutating state directly). |
| `destroy()` | Tear the app down (runs Angular's destroy pass, delivers the DESTROY ops). |

Lower-level pieces (`installMockPapi`, `emitGlobalEvent` for
`(window:…)` handlers, `driveList` for `<list>` virtualization, `fireWorklet`,
`getLastOps` for wire-protocol assertions, `printTree`, `tick`) are exported
too — they're what the verify harnesses use.

## Patterns & caveats

- **Sequential renders work; parallel apps don't.** `destroy()` the previous
  fixture before rendering the next (asserted by `verify:testing`). Vitest
  isolates test files by default, so one app per file is the natural shape.
  Internals note: the root component's host *is* the page root, so a destroy
  batch contains `DESTROY(1)` — `renderLynxComponent`/`destroy()` drain the
  ops buffer synchronously so that batch can't race the next test's fresh
  page (this exact race is why the drain exists).
- **JIT only.** Initializer APIs (`input()`, `viewChild()`, …) don't wire up
  under JIT — use decorator forms in components you unit-test (the AOT app
  build is unaffected; see [05 — Build integration](05-build-integration.md)).
- **Host data:** set `(globalThis as any).lynx.__initData` after
  `installMockPapi()` and before bootstrap, or drive
  `lynxCoreInject.tt.updateCardData` — see `verify/harness-hostdata.ts` for a
  complete example.
- The mock deliberately mirrors real-engine strictness where it has caught
  bugs before: unknown tags throw in `__CreateElement`, `__AddEvent` ignores
  non-PAPI handler shapes, list updates replay `@lynx-js/web-core`'s
  `update-list-info` arithmetic.

## Verifying

`npm run verify:testing` dogfoods the public API end-to-end: render + queries,
event delivery, the unbound-event throw, `stable()` after direct mutation, and
destroy-then-re-render in one process.
