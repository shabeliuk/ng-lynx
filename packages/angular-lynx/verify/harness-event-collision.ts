/**
 * Headless verification of the dev warning for two bindings of one event on an element.
 * The engine keeps an element's events in a map keyed by name, so `(tap)` and `(catchtap)`
 * overwrite each other with no error (docs/12-events.md).
 *
 * Built with `VERIFY_DEV=true`, because the warning is dev-only.
 *
 * Run with: `npm run verify:event-collision`.
 */
import '@angular/compiler';

import { Component, NO_ERRORS_SCHEMA } from '@angular/core';

import { bootstrapLynxApplication } from 'angular-lynx';
import 'angular-lynx/main-thread';

import { assert, installMockPapi, tick } from './mock-papi.js';

const noop = (): void => {};

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view (tap)="noop()" (catchtap)="noop()"></view>
    <text (capture-bindlongtap)="noop()" (longtap)="noop()"></text>
    <view (touchstart)="noop()" (global-bindtouchstart)="noop()"></view>
    <view (tap)="noop()"></view>
    <view (touchend)="noop()" (touchmove)="noop()"></view>
  `,
})
class TestComponent {
  protected readonly noop = noop;
}

installMockPapi();
const warnings: string[] = [];
const warn = console.warn;
console.warn = (message: unknown) => {
  if (typeof message === 'string' && message.includes('binds both')) warnings.push(message);
};

(globalThis as unknown as { renderPage(data: object): void }).renderPage({});
await bootstrapLynxApplication(TestComponent);
await tick();
console.warn = warn;

console.log('\n=== Warnings ===');
for (const message of warnings) console.log(message);
assert(warnings.length === 2, 'warns only for the two real collisions');
assert(
  warnings.some((message) => message.includes('<view> binds both (tap) and (catchtap)')),
  'names the element and both bindings',
);
assert(
  warnings.some((message) => message.includes('<text> binds both')
    && message.includes('(capture-bindlongtap)') && message.includes('(longtap)')),
  'covers the capture forms',
);
assert(
  warnings.every((message) => !message.includes('global-bind')),
  '(global-bind…) has its own map, so it doesn\'t collide',
);

console.log('\n✅ All event-collision assertions passed.\n');
