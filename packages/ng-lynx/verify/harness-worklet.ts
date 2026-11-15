/**
 * Headless verification of main-thread worklets.
 *
 * A worklet is registered on the "Main Thread", bound to a native `tap` via the
 * `[lynxMainThread]` directive. The harness fires the event (calling the handler
 * `__AddEvent` stored) and asserts:
 *   - the worklet ran on the MT and mutated the element synchronously
 *     (setStyle) — with NO ngPatchUpdate batch from the Background Thread, and
 *   - `ctx.runOnBackground(...)` reached the BG and surfaced via
 *     `(mainThreadCallback)`.
 *
 * Run with: `npm run verify:worklet`.
 */
import '@angular/compiler';

import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  signal,
} from '@angular/core';

import { bootstrapLynxApplication, LynxMainThread } from 'ng-lynx';
import 'ng-lynx/entry-background'; // installs the runOnBackground bridge
import 'ng-lynx/main-thread';
import { registerWorklet } from 'ng-lynx/worklet';

import {
  assert,
  findByClass,
  findText,
  fireWorklet,
  getLastOps,
  getPage,
  installMockPapi,
  tick,
} from './mock-papi.js';

// A main-thread worklet: runs on the MT when the bound event fires. Real apps
// register worklets from a module the plugin lists in `mainThreadModules`,
// loaded *after* the worklet-runtime (see plugin/src/index.ts) — so this
// harness registers from inside `main()`, after `installMockPapi()`, to match
// that real load order (the mock installs `registerWorkletInternal` there).
function registerHarnessWorklet(): void {
  registerWorklet('onPressMT', (ctx) => {
    // Mutate the element synchronously on the Main Thread (gesture-rate).
    ctx.setStyle('opacity: 0.5');
    // Read the value back off the element (computed-style read).
    const opacity = ctx.getComputedStyleProperty('opacity');
    // Hand values back to the Background Thread.
    ctx.runOnBackground({ pressed: true, opacity });
  });
}

@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LynxMainThread],
  schemas: [CUSTOM_ELEMENTS_SCHEMA],
  template: `
    <view
      class="target"
      [lynxMainThread]="{ tap: 'onPressMT' }"
      (mainThreadCallback)="onMessage($event)"
    ></view>
    <text class="log">{{ log() }}</text>
  `,
})
class WorkletComponent {
  readonly log = signal('(none)');
  onMessage(data: unknown): void {
    this.log.set(`bg:${JSON.stringify(data)}`);
  }
}

async function main(): Promise<void> {
  console.log('\n=== Assertions: worklet id derivation ===');
  let threw: unknown;
  try {
    registerWorklet((ctx) => ctx.setStyle('opacity: 0'));
  } catch (err) {
    threw = err;
  }
  assert(
    threw instanceof Error && threw.message.includes("can't derive a worklet id"),
    'an anonymous arrow function (no .name to derive an id from) throws a clear error',
  );
  function namedWorklet(ctx: { setStyle(css: string): void }): void {
    ctx.setStyle('opacity: 0');
  }
  assert(
    namedWorklet.name === 'namedWorklet',
    "sanity check: a named function declaration's .name is its own name (no special casing needed)",
  );

  installMockPapi();
  registerHarnessWorklet();
  (globalThis as Record<string, any>).renderPage({});

  await bootstrapLynxApplication(WorkletComponent);
  await tick();
  await tick();

  const page = getPage();
  const target = findByClass(page, 'target')!;

  console.log('\n=== Assertions: worklet binding ===');
  assert(typeof target.events['tap']?.sign === 'function', 'main-thread worklet handler bound on the element');
  (globalThis as Record<string, any>).__LAST_OPS__ = undefined;

  console.log('\n=== Fire the tap on the Main Thread ===');
  fireWorklet(target, 'tap', { type: 'tap', detail: {} });

  console.log('\n=== Assertions: worklet ran on the MT ===');
  assert(target.style === 'opacity: 0.5', 'worklet mutated the element synchronously on the MT');
  assert(getLastOps().length === 0, 'no Background ops batch was produced for the MT mutation');

  await tick();
  await tick();

  console.log('\n=== Assertions: runOnBackground + getComputedStyleProperty ===');
  assert(
    findText(page, 'bg:{"pressed":true,"opacity":"0.5"}') != null,
    'ctx.runOnBackground reached the BG via (mainThreadCallback), carrying the '
      + 'value read back by ctx.getComputedStyleProperty("opacity")',
  );

  console.log('\n✅ Worklet works — MT execution + runOnBackground round-trip.\n');
}

main().catch((err) => {
  console.error('\n❌ Worklet verification failed:\n', err);
  process.exit(1);
});
