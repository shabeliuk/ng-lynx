/**
 * Type test for the typed `invoke()` (asLynxElement<Tag>): checked by
 * `npm run verify:invoke-types`, never run. Each `@ts-expect-error` must be
 * an error, or tsc fails on the unused directive.
 */
import { asLynxElement } from 'angular-lynx';

declare const el: unknown;

// Untyped, as before: any method name.
asLynxElement(el).invoke({ method: 'anything', params: { x: 1 } });

// Typed: each element's own methods and params.
asLynxElement<'video'>(el).invoke({ method: 'seek', params: { position: 5 } });
asLynxElement<'video'>(el).invoke({ method: 'play' });
asLynxElement<'scroll-view'>(el).invoke({ method: 'scrollTo', params: { offset: 120, smooth: true } });
asLynxElement<'list'>(el).invoke({ method: 'scrollToPosition', params: { position: 3, smooth: true } });
asLynxElement<'list'>(el).invoke({ method: 'scrollToPosition', params: { index: 3, alignTo: 'middle' } });
asLynxElement<'input'>(el).invoke({ method: 'focus' });
asLynxElement<'refresh'>(el).invoke({ method: 'finishRefresh' });

// The other element methods are still there.
asLynxElement<'video'>(el).fields({ size: true }, () => {});

// @ts-expect-error a method the element doesn't have
asLynxElement<'video'>(el).invoke({ method: 'scrollTo', params: { offset: 1 } });
// @ts-expect-error a wrong params type
asLynxElement<'scroll-view'>(el).invoke({ method: 'scrollTo', params: { offset: 'far' } });
// @ts-expect-error scrollToPosition needs position or index
asLynxElement<'list'>(el).invoke({ method: 'scrollToPosition', params: { smooth: true } });
// @ts-expect-error an element type with no method map
asLynxElement<'view'>(el);
