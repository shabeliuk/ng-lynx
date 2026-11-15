# Content projection (`<ng-content>`)

Angular's content projection works on Lynx with **no renderer changes at all** —
it composes entirely out of primitives `LynxRenderer2` already implements. This
page covers how it works, the one architectural fact worth knowing before you
nest components (host elements), and how it's verified.

See the runnable [`examples/projection`](../examples/projection), verified by
`npm run verify:projection`.

## Using it

`<ng-content>` works exactly as it does in a browser — a default slot, and named
slots via `select`:

```ts
// card.component.ts
import { ChangeDetectionStrategy, Component, NO_ERRORS_SCHEMA } from '@angular/core';

@Component({
  selector: 'app-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="card">
      <view class="card-header"><ng-content select="[header]"></ng-content></view>
      <view class="card-body"><ng-content></ng-content></view>
    </view>
  `,
})
export class CardComponent {}
```

```ts
// app.component.ts
@Component({
  imports: [CardComponent],
  template: `
    <app-card>
      <text header class="header-label">Profile</text>
      <text class="line">Ada Lovelace</text>
    </app-card>
  `,
  // ...
})
export class AppComponent {}
```

`select` is matched the same way it is on the DOM — by attribute (`[header]`),
tag, or class — against the projected nodes' static template attributes. Content
projected into a slot keeps its own reactivity (interpolations, signals, event
bindings) and renders in the slot's position regardless of where in the tree the
`<ng-content>` placeholder lives.

## How it works

Ivy compiles `<ng-content>` to a `ɵɵprojection` instruction. At a high level:

1. `ɵɵprojectionDef` (emitted once per host template) buckets the component's
   children by their `select` selectors at creation time — pure Angular-internal
   bookkeeping over `TNode`s, no renderer calls.
2. Each `ɵɵprojection(index, selectorIndex)` call then inserts the matching
   nodes at the placeholder's position using the **same**
   `Renderer2.appendChild` / `insertBefore` calls Angular uses for every other
   node.

Because `LynxRenderer2.appendChild` / `insertBefore` are generic — they don't
know or care *why* a node is being inserted — projection "just works" the same
way `@if` / `@for` already do. There was nothing to implement; this page exists
to confirm it and flag one consequence of Angular's component model.

## Nesting components creates a real host element

This is **not specific to projection** — it applies to any multi-component Lynx
app — but projection is usually the first time you reach for a second component,
so it's worth calling out here.

Angular **always** creates a real host element matching a component's selector. `<app-card>` in a
template means a real `app-card`-tagged node sits in the tree, with `CardComponent`'s
own template as its children — true on the DOM (`<app-card>` is a real, if
unstyled, element there too) and equally true on Lynx.

On Lynx this host element goes through `createTypedElement()`
([`ops-apply.ts`](../packages/ng-lynx/main-thread/src/ops-apply.ts)), which
synthesizes a plain `<view>` for any tag that isn't one of Lynx's built-in
elements ([lynxjs.org/api/elements/built-in](https://lynxjs.org/api/elements/built-in/))
or listed in `pluginAngularLynx({ nativeElements })`.

This is **not** what the web target does, and that distinction matters: the
**web** preview (`@lynx-js/web-core`) falls back to `document.createElement('app-card')`
for an unrecognized tag — a plain, unstyled, functional element, like any
unrecognized custom element on the web. The **native** (iOS/Android) engine has
no such fallback — confirmed on-device (`LynxCreateUIException: app-card ui not
found when create UI`), and confirmed in
[`lynx-family/lynx`](https://github.com/lynx-family/lynx)'s own source (default
branch `develop`): each built-in UI class self-registers its tag via a
`LYNX_REGISTER_UI("tagname")` macro (e.g. `LynxUIView.m` →
`LYNX_REGISTER_UI("view")`, under `platform/darwin/ios/lynx/ui/`), and
`LynxUIOwner.m`'s `createUIWithSign:tagName:…` throws exactly that exception
when the registry lookup (`LynxComponentScopeRegistry uiClassWithName:`) misses
— there's no generic-element branch at all. So `createTypedElement` doesn't pass an
unrecognized tag to `__CreateElement` at all; it creates a `<view>` instead,
which works identically on both targets.

Practically: it's harmless. The extra node is inert and unstyled by default —
give it a class and style it like anything else, or ignore it. It's just one
more node in the tree per nested component, which matters only if you're
counting them for performance reasons.

## Notes & limitations

- **No fallback/default content.** Angular's `<ng-content>` doesn't support
  default content the way some Web Components slots do — if nothing
  matches a `select` selector, the placeholder renders empty. This is an Angular
  limitation everywhere, not a Lynx-specific gap.
- **Events on projected content fire normally.** A `(tap)` bound on a node in
  the *consumer's* template still belongs to the consumer's view/change-detection
  context even once projected into the card's body — verified in
  `verify/harness-projection.ts`.
