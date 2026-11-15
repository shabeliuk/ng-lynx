/**
 * Headless verification of the typed element directives (`ng-lynx/elements`).
 *
 *  - **No `NO_ERRORS_SCHEMA`**: the component below imports `LYNX_ELEMENTS`
 *    and declares no schemas (compile-time NG8001/NG8002 behavior is verified
 *    separately against real ngc — see docs/18-typed-templates.md).
 *  - **Lazy outputs**: an element whose events are *not* bound must register
 *    no native listener (no SET_EVENT op, nothing in the mock's event table).
 *  - **Typed outputs forward the payload**: firing the native event through
 *    the sign registry runs the handler with the payload.
 *  - **Inputs forward as attribute ops**: static attrs, bound attrs (raw types
 *    preserved), updates, and undefined → removal (only if previously set).
 *
 * Run with: `npm run verify:elements`.
 */
import '@angular/compiler';

import { Component, signal } from '@angular/core';

import { bootstrapLynxApplication } from 'ng-lynx';
import { publishEvent } from 'ng-lynx/internal/runtime';
import {
  LYNX_ELEMENTS,
  type LynxInputEvent,
  type LynxKeyEvent,
  type LynxMouseEvent,
  type LynxTouchEvent,
  type LynxWheelEvent,
} from 'ng-lynx/elements';
import 'ng-lynx/main-thread';

import {
  assert,
  findByClass,
  findText,
  getPage,
  installMockPapi,
  tick,
} from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  // NOTE: no `schemas` — the directives make the Lynx tags known.
  template: `
    <view class="app">
      <view class="btn" (tap)="onTap($event)">
        <text class="plain">count: {{ count() }}</text>
      </view>
      <view class="idle" exposure-id="static-exposure"></view>
      <view
        class="a11y"
        accessibility-label="Volume slider"
        [accessibility-element]="true"
        accessibility-traits="adjustable"
        [accessibility-value]="a11yValue()"
        [accessibility-heading]="false"
        accessibility-role-description="progressbar"
        [accessibility-actions]="a11yActions"
        [accessibility-elements-hidden]="false"
        [accessibility-exclusive-focus]="false"
        ios-platform-accessibility-id="volume-slider"
      ></view>
      <image
        class="pic"
        src="a.png"
        [mode]="mode()"
        [auto-size]="autoSize()"
        [blur-radius]="blur()"
      />
      <input class="field" placeholder="type here" [maxlength]="10" (input)="onInput($event)" />
      <text class="typed">{{ typed() }}</text>
      <view
        class="pointer"
        (keydown)="onKey($event)"
        (mousedown)="onMouse($event)"
        (wheel)="onWheel($event)"
      ></view>
      <text class="pointer-log">{{ pointerLog() }}</text>
    </view>
  `,
})
export class TestComponent {
  readonly count = signal(0);
  readonly typed = signal('typed:none');
  readonly mode = signal<'aspectFit' | 'aspectFill'>('aspectFit');
  readonly autoSize = signal<boolean | undefined>(true);
  readonly blur = signal<string | undefined>('5px');
  readonly a11yValue = signal('50%');
  readonly a11yActions: readonly string[] = ['increment', 'decrement'];
  readonly pointerLog = signal('pointer:none');

  onTap(event: LynxTouchEvent): void {
    this.count.update((n) => n + (event.detail?.x ?? 1));
  }

  onInput(event: LynxInputEvent): void {
    this.typed.set(`typed:${event.detail.value}`);
  }

  // Typed PC/desktop events — reading these fields is what proves the types.
  onKey(event: LynxKeyEvent): void {
    this.pointerLog.set(`key:${event.key} shift:${event.shiftKey}`);
  }

  onMouse(event: LynxMouseEvent): void {
    this.pointerLog.set(`mouse:${event.button}@${event.x},${event.y}`);
  }

  onWheel(event: LynxWheelEvent): void {
    this.pointerLog.set(`wheel:${event.deltaX},${event.deltaY}`);
  }
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  const app = await bootstrapLynxApplication(TestComponent);
  await tick();
  await tick();
  const page = getPage();

  console.log('\n=== Lazy outputs ===');
  const idle = findByClass(page, 'idle');
  assert(!!idle, 'unbound <view> rendered');
  assert(Object.keys(idle?.events ?? {}).length === 0, 'unbound element registered no native listener');
  const btn = findByClass(page, 'btn');
  assert(typeof btn?.events['tap']?.sign === 'string', 'bound (tap) registered exactly through the renderer');

  console.log('\n=== Typed outputs deliver payloads (exactly once) ===');
  // detail.x = 5 doubles as a single-delivery check: Angular binds a template
  // listener to BOTH the native event and a same-named directive output, so if
  // the directive's emitter re-emitted the event the handler would run twice
  // and the count would read 10 (this failed during development — the inert-
  // emitter design exists because of it).
  publishEvent(btn?.events['tap']?.sign as string, { detail: { x: 5, y: 0 } });
  await tick();
  await tick();
  assert(findText(page, 'count: 5') != null, '(tap) handler received the payload exactly once');

  const field = findByClass(page, 'field');
  publishEvent(field?.events['input']?.sign as string, { detail: { value: 'Ada' } });
  await tick();
  await tick();
  assert(findText(page, 'typed:Ada') != null, '(input) handler received LynxInputEvent payload');

  console.log('\n=== Typed PC/desktop events (keydown / mousedown / wheel) ===');
  const pointer = findByClass(page, 'pointer');
  assert(typeof pointer?.events['keydown']?.sign === 'string', 'bound (keydown) registered through the renderer');
  assert(typeof pointer?.events['mousedown']?.sign === 'string', 'bound (mousedown) registered through the renderer');
  assert(typeof pointer?.events['wheel']?.sign === 'string', 'bound (wheel) registered through the renderer');

  publishEvent(pointer?.events['keydown']?.sign as string, { key: 'Enter', shiftKey: true });
  await tick();
  await tick();
  assert(findText(page, 'key:Enter shift:true') != null, '(keydown) handler received LynxKeyEvent top-level fields');

  publishEvent(pointer?.events['mousedown']?.sign as string, { button: 2, x: 12, y: 34 });
  await tick();
  await tick();
  assert(findText(page, 'mouse:2@12,34') != null, '(mousedown) handler received LynxMouseEvent top-level fields');

  publishEvent(pointer?.events['wheel']?.sign as string, { deltaX: 0, deltaY: -120 });
  await tick();
  await tick();
  assert(findText(page, 'wheel:0,-120') != null, '(wheel) handler received LynxWheelEvent top-level fields');

  console.log('\n=== Inputs forward as attributes ===');
  assert(idle?.attrs['exposure-id'] === 'static-exposure', 'static attr on directive input landed');
  const pic = findByClass(page, 'pic');
  assert(pic?.attrs['src'] === 'a.png', 'static src landed');
  assert(pic?.attrs['mode'] === 'aspectFit', 'bound enum attr landed');
  assert(pic?.attrs['auto-size'] === true, 'boolean attr kept its raw type on the wire');
  assert(pic?.attrs['blur-radius'] === '5px', 'bound string attr landed');
  assert(field?.attrs['maxlength'] === 10, 'number attr kept its raw type on the wire');
  assert(field?.attrs['placeholder'] === 'type here', 'static placeholder landed');

  console.log('\n=== Accessibility attributes forward as attribute ops (docs/34-accessibility.md) ===');
  const a11y = findByClass(page, 'a11y');
  assert(a11y?.attrs['accessibility-label'] === 'Volume slider', 'accessibility-label landed');
  assert(a11y?.attrs['accessibility-element'] === true, 'accessibility-element kept its raw boolean type');
  assert(a11y?.attrs['accessibility-traits'] === 'adjustable', 'accessibility-traits landed');
  assert(a11y?.attrs['accessibility-value'] === '50%', 'accessibility-value landed');
  assert(a11y?.attrs['accessibility-heading'] === false, 'accessibility-heading=false landed as a real value, not removed (setAttr only treats undefined/null as removal)');
  assert(a11y?.attrs['accessibility-role-description'] === 'progressbar', 'accessibility-role-description landed');
  assert(
    JSON.stringify(a11y?.attrs['accessibility-actions']) === JSON.stringify(['increment', 'decrement']),
    'accessibility-actions landed as a real array, not stringified',
  );
  assert(a11y?.attrs['accessibility-elements-hidden'] === false, 'accessibility-elements-hidden landed');
  assert(a11y?.attrs['accessibility-exclusive-focus'] === false, 'accessibility-exclusive-focus landed');
  assert(a11y?.attrs['ios-platform-accessibility-id'] === 'volume-slider', 'ios-platform-accessibility-id landed');

  console.log('\n=== Input updates & removal ===');
  const component = app.components[0].instance as TestComponent;
  component.mode.set('aspectFill');
  component.blur.set(undefined);
  await tick();
  await tick();
  assert(pic?.attrs['mode'] === 'aspectFill', 'attr update landed');
  assert(!('blur-radius' in (pic?.attrs ?? {})), 'undefined removed a previously-set attr');

  console.log('\n✅ All typed-element assertions passed — ng-lynx/elements works.\n');
}

main().catch((err) => {
  console.error('\n❌ Typed-elements verification failed:\n', err);
  process.exit(1);
});
