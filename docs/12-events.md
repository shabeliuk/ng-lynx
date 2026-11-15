# Events

How Angular event bindings map onto Lynx events.

## Element events

Bind any Lynx event with the usual Angular `(event)` syntax on an element:

```html
<view (tap)="onTap($event)">…</view>
<input (input)="onInput($event)" (confirm)="submit()" />
<scroll-view (scroll)="onScroll($event)">…</scroll-view>
```

The renderer maps the binding name to a Lynx event registration
([renderer.ts](../packages/ng-lynx/runtime/src/renderer.ts), `parseEvent`):

| Angular binding | Lynx registration | Notes |
| --- | --- | --- |
| `(tap)` | `bindEvent` `tap` | bubbling (default) |
| `(catchtap)` | `catchEvent` `tap` | **stops native bubbling** — the Lynx equivalent of `stopPropagation()` |
| `(bindtap)` | `bindEvent` `tap` | explicit bubbling form |
| `(capture-bindtap)` | `capture-bind` `tap` | capture phase |
| `(capture-catchtap)` | `capture-catch` `tap` | capture phase, stops propagation |
| `(global-bindtap)` | `global-bindEvent` `tap` | fires for that event wherever it happens on the page |

These are [Lynx's documented prefixes](https://lynxjs.org/guide/interaction/event-handling/event-propagation).

**One handler per event name per element.** The engine keeps an element's events in a map keyed by
name (`static_events_` in `core/renderer/dom/attribute_holder.h`), so `(tap)`, `(catchtap)` and
`(capture-bindtap)` on the **same** element overwrite each other: the last one registered wins. Put
a capture handler on an ancestor instead. Only `(global-bindtap)` has its own map. Measured on engine
4.2: with `(capture-bindtap)` on a wrapper around the `(tap)` elements, a tap logs
`capture, inner, outer`. The engine reports nothing when this happens, so a dev build warns.

So **`(catch…)` is "stop propagation"** — use `(catchtap)` instead of calling
`$event.stopPropagation()`.

### `.self` — ignore bubbled events

Append `.self` to fire the handler **only when the event originated on the bound
element**, not when it bubbled up from a descendant:

```html
<view (tap.self)="onBackdrop()">      <!-- only a tap on the backdrop itself -->
  <view class="dialog">…</view>        <!-- taps inside the dialog don't trigger it -->
</view>
```

It compares the event's `target.uid` to `currentTarget.uid`. Combine with the
prefixes (`(catchtap.self)`). A plain `(tap)` and a `(tap.self)` on the same
element share one native listener.

### Event payload

The `$event` object is the Lynx event. Two fields you'll use most:

- **`$event.detail`** — event data. Text inputs put the current value in
  `$event.detail.value` (this is why forms read `detail.value`, not
  `target.value` — see [09 — Forms](09-forms.md)).
- **`$event.target`** / **`$event.currentTarget`** — Lynx sends `uid`, `id` and
  `dataset` here. Write `data-x="…"` on an element to read it back as
  `$event.currentTarget.dataset.x`. ng-lynx fills `target` in with the bound
  element only when an event arrives without one, so DOM-oriented code like
  `@angular/forms`' `DefaultValueAccessor` doesn't crash.

### A typing gotcha: event names that collide with the DOM

> **This gotcha is solved by the typed element directives** — with
> `ng-lynx/elements` imported, the directive's output "claims" the event
> name and `$event` gets the correct Lynx type (`(scroll)` →
> `LynxScrollEvent`). See [18 — Typed templates](18-typed-templates.md). The
> cast below is only needed for untyped (`NO_ERRORS_SCHEMA`) templates.

`strictTemplates` (on by default) infers `$event`'s type from the *binding
name*, not from Lynx. For an event name Angular recognizes as a real DOM event
— `scroll`, `click`, `input`, `focus`, `blur`, `load`, `touchstart`, … — it
infers the real DOM `Event` type (no `.detail`), even though Lynx fires its own
event of that name with a Lynx-shaped payload. `tap`, `confirm`,
`scrolltolower`, and other Lynx-only names aren't in the DOM's event map, so
they don't have this problem.

Fix: type the handler parameter as `Event` (matching what's inferred), then
cast through `unknown` to reach the real shape:

```ts
onScroll(event: Event): void {
  const detail = (event as unknown as { detail?: { scrollTop: number } }).detail;
  // ...
}
```

See [08 — Lists](08-lists.md#scroll-events--methods) for the real example that
surfaced this (`<list>`'s `scroll` event).

### Host listeners get the DOM type too

The typed element directives only cover templates. A host listener on a directive has no
element to get a type from, so `strictTemplates` uses the DOM's, and a Lynx payload type
fails to compile, on Angular 21 and 22:

```ts
// error TS2345: Argument of type 'InputEvent' is not assignable to parameter of type 'LynxInputEvent'.
@HostListener('input', ['$event']) onInput(event: LynxInputEvent) {}
```

Use `$any` in the listener, which keeps your handler typed:

```ts
@HostListener('input', ['$any($event)']) onInput(event: LynxInputEvent) {}
```

The same goes for `host: { '(input)': 'onInput($any($event))' }`. To turn the check off for a whole
project instead, set `typeCheckHostBindings: false` under `angularCompilerOptions`, which is what this
package's own build does.

### `(confirm)` — submit on enter

Lynx fires `confirm` when the user presses the keyboard's submit/return key on an
`<input>`. Bind it directly; the final text is in `$event.detail.value`:

```html
<input [(lynxModel)]="email" confirm-type="done" (confirm)="submit()" />
```

**Set `confirm-type`.** Without it, Return on Android's keyboard does nothing and
`confirm` never fires (Explorer 4.2, emulator). With it, Return fires `confirm` and
closes the keyboard.

See `examples/lynx-forms`.

### Multiple listeners per event

The renderer **multiplexes** listeners: several directives can bind the same
event on the same element (one native `__AddEvent`, fanned out to every
callback). This is what lets `@angular/forms`' built-in `DefaultValueAccessor`
and ng-lynx's `LynxValueAccessor` both listen for `input` on one field.

## Global events

`(window:…)` / `(document:…)` / `(body:…)` bindings map to Lynx's app-level
**`GlobalEventEmitter`** (on the Background Thread — no Main-Thread round-trip).
Use them to receive custom events that native code (or other Background code)
emits:

```ts
@Component({
  // bind on any element; the target is the global scope, not that element
  template: `<view (window:appResume)="onResume($event)">…</view>`,
})
export class AppComponent {
  onResume(event: unknown): void { /* native emitted 'appResume' */ }
}
```

Lynx has a single global scope, so `window`, `document`, and `body` all resolve
to the same emitter. (Angular's `(window:…)` resolvers read `element.ownerDocument`
under the hood; `ShadowElement` returns a sentinel so they don't crash off-DOM.)
The matching emit side is usually native:
`lynx.getJSModule('GlobalEventEmitter').emit('appResume', …)`.

Verified by `npm run verify:events`.
