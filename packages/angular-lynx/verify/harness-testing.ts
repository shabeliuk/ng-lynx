/**
 * Dogfood harness for the public `angular-lynx/testing` API.
 *
 * Every other harness drives the runtime through the low-level mock directly;
 * this one goes through `renderLynxComponent()` exactly the way a user's
 * Vitest/Jest test would, and asserts the fixture surface:
 *
 *  - render → tree queries (`findText` / `findByClass` / `tree`)
 *  - `fire()` delivers an event through the real sign registry and waits for
 *    the re-render
 *  - `fire()` on an element with no listener throws (instead of silently
 *    passing a test that never ran its handler), and bubbles to the nearest
 *    ancestor that has one
 *  - `getByText` / `queryByText` / `getAllByText` (string, RegExp, substring,
 *    innermost match, errors with the tree) and `within()`
 *  - direct state mutation + `stable()` re-renders
 *  - `destroy()` then a second `renderLynxComponent()` in the same process
 *    works (the documented sequential-test pattern)
 *
 * Run with: `npm run verify:testing`.
 */
import '@angular/compiler';

import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import 'angular-lynx/main-thread';
import { assert, renderLynxComponent, textContent, within } from 'angular-lynx/testing';

@Component({
  selector: 'app-shop',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="shop">
      @for (item of items; track item.name) {
        <view class="card">
          <text class="name">{{ item.name }}</text>
          <view class="buy" (tap)="bought.set(item.name)">
            <text>Buy</text>
          </view>
        </view>
      }
      <text class="total">Total: <inline-text>{{ bought() || 'nothing' }}</inline-text></text>
    </view>
  `,
})
export class ShopComponent {
  readonly items = [{ name: 'Apple' }, { name: 'Pear' }];
  readonly bought = signal('');
}

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="app">
      <view class="btn" (tap)="inc()">
        <text class="count">Count: {{ count() }}</text>
      </view>
      <view class="idle"></view>
    </view>
  `,
})
export class CounterComponent {
  readonly count = signal(0);
  inc(): void {
    this.count.update((n) => n + 1);
  }
}

@Component({
  selector: 'app-root',
  standalone: true,
  schemas: [NO_ERRORS_SCHEMA],
  template: `<view class="second"><text>Second app</text></view>`,
})
export class SecondComponent {}

async function main(): Promise<void> {
  console.log('\n=== renderLynxComponent + queries ===');
  const fixture = await renderLynxComponent(CounterComponent);
  assert(fixture.findText('Count: 0') != null, 'initial render queried via findText');
  assert(fixture.findByClass('btn') != null, 'findByClass finds the element');
  assert(fixture.tree().includes('<view .btn'), 'tree() prints the native tree');

  console.log('\n=== fire() delivers events and settles ===');
  await fixture.fire(fixture.findByClass('btn'), 'tap', { detail: { x: 1, y: 1 } });
  assert(fixture.findText('Count: 1') != null, 'tap handler ran and view updated');

  console.log('\n=== fire() on an unbound element throws ===');
  let threw = false;
  try {
    await fixture.fire(fixture.findByClass('idle'), 'tap');
  } catch {
    threw = true;
  }
  assert(threw, "fire() rejected for an element with no 'tap' listener");

  console.log('\n=== direct state mutation + stable() ===');
  fixture.instance.count.set(41);
  await fixture.stable();
  assert(fixture.findText('Count: 41') != null, 'signal write re-rendered after stable()');

  console.log('\n=== text queries, within(), and fire() bubbling ===');
  fixture.destroy();
  const shop = await renderLynxComponent(ShopComponent);
  assert(shop.getByText('Apple').type === 'text', 'getByText returns the <text> element');
  assert(shop.getAllByText('Buy').length === 2, 'getAllByText finds both buttons');
  assert(shop.queryByText('Banana') === null, 'queryByText is null when nothing matches');
  assert(shop.getByText(/^Pea/).type === 'text', 'getByText takes a RegExp');
  assert(shop.getByText('appl', { exact: false }) != null, 'exact: false matches a case-insensitive substring');
  assert(shop.getByText('nothing').type === 'inline-text', 'the innermost element matches, not the <text> around it');
  assert(textContent(shop.findByClass('total')!) === 'Total: nothing', 'textContent joins nested text');
  let threwOnTwo = '';
  try {
    shop.getByText('Buy');
  } catch (err) {
    threwOnTwo = (err as Error).message;
  }
  assert(threwOnTwo.includes('2 elements show "Buy"') && threwOnTwo.includes('<view'), 'getByText throws on two matches, with the tree');
  let threwOnNone = '';
  try {
    shop.getByText('Banana');
  } catch (err) {
    threwOnNone = (err as Error).message;
  }
  assert(threwOnNone.includes('no element shows "Banana"'), 'getByText throws when nothing matches');
  const pear = shop.findAllByClass('card')[1]!;
  await shop.fire(within(pear).getByText('Buy'), 'tap');
  assert(textContent(shop.findByClass('total')!) === 'Total: Pear', 'fire() on the <text> bubbled to its button, scoped by within()');
  assert(shop.getAllByText('Pear').length === 2, 'both "Pear"s are found now: the card and the total');
  shop.destroy();

  console.log('\n=== destroy + second render in one process ===');
  const second = await renderLynxComponent(SecondComponent);
  assert(second.findText('Second app') != null, 'sequential render works after destroy()');
  second.destroy();

  console.log('\n✅ All testing-package assertions passed — angular-lynx/testing works.\n');
}

main().catch((err) => {
  console.error('\n❌ Testing-package verification failed:\n', err);
  process.exit(1);
});
