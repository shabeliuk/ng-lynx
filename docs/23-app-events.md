# App events & lifecycle — `LynxGlobalEvents`, `lynxForeground()`

Template bindings (`(window:x)` — [12 — Events](12-events.md)) reach Lynx's
app-level `GlobalEventEmitter`, but only from a component's template. This
module gives **services, guards, and plain functions** the same access — plus
the host lifecycle as a signal.

## `lynxForeground()` — host lifecycle as a signal

```ts
import { effect } from '@angular/core';
import { lynxForeground } from 'angular-lynx';

export class VideoComponent {
  readonly foreground = lynxForeground();
  private readonly pauseWhenHidden = effect(() => {
    if (!this.foreground()) this.pause();
  });
}
```

Starts `true`; flips when the host moves the LynxView to the background /
foreground. Callable anywhere — no injection context needed.

**The engine channel** (confirmed against the Lynx JS core, not assumed): the
core dispatches internal `__OnAppEnterForeground` / `__OnAppEnterBackground`
events and invokes `tt.onAppEnterForeground()` / `tt.onAppEnterBackground()` —
no-op methods the framework overrides, the same pattern as `updateCardData`
([17 — Host data](17-host-data.md)). On native these fire when the host app
calls `lynxView.onEnterForeground()` / `onEnterBackground()`.
`entry-background.ts` installs the hooks at bundle start, **chaining** any
pre-existing implementation (asserted by the harness). Notably this is a
channel ReactLynx doesn't expose as API at all.

## Page destroy — `ngOnDestroy` runs

When a LynxView is destroyed (the user leaves the page, or Android recreates the
activity on rotation), `entry-background.ts`'s `tt.callDestroyLifetimeFun` hook destroys
every application from `bootstrapLynxApplication`, so `ngOnDestroy` and `DestroyRef`
callbacks run. Keep them synchronous: the engine stops all timers and frees the runtime as
soon as the hook returns, so a promise or `setTimeout` started there never finishes. Ops
produced by this teardown are dropped, because the native tree is already going away.

## `LynxGlobalEvents` — the GlobalEventEmitter as a service

```ts
import { inject, Injectable } from '@angular/core';
import { LynxGlobalEvents } from 'angular-lynx';

@Injectable({ providedIn: 'root' })
export class KeyboardService {
  private readonly events = inject(LynxGlobalEvents);

  // The latest payload of an event, as a signal:
  // Lynx sends three arguments, so the payload is [status, height, compatHeight].
  readonly status = this.events.latest<[string, number, number]>('keyboardstatuschanged');

  // Or classic callbacks (returns an unlisten function):
  private readonly stop = this.events.listen('exposure', (payload) => {
    console.log('exposed:', payload);
  });
}
```

| Member | What it does |
| --- | --- |
| `listen(name, handler)` | Subscribe; returns unlisten. Also auto-removed when the app is destroyed. |
| `latest<T>(name, initial?)` | The newest payload as a `Signal<T \| undefined>` — one shared listener per event name. |
| `emit(name, params[])` | Emit on the Background-Thread bus: reaches other `listen()`ers **and** `(window:x)` template bindings. It does *not* call into native — use a NativeModule for JS→host. |

Payload convention matches the template bindings: single-argument emits arrive
unwrapped, multi-argument emits arrive as the argument array.

Typical events on this bus: whatever the host emits via
`lynxView.sendGlobalEvent(...)`, Lynx's exposure system (`exposure` /
`disexposure`), `keyboardstatuschanged`, `onWindowResize`, and angular-lynx's
own ReactLynx-parity `onDataChanged` / `onGlobalPropsChanged`
([17 — Host data](17-host-data.md)).

## Verifying

`npm run verify:appevents` drives the real `tt` lifecycle hooks (including the
chaining of a pre-existing handler), `latest()` signal updates through
zoneless CD, `listen()`'s payload convention and unlisten, and a service
`emit()` observed by a `(window:x)` template binding.
