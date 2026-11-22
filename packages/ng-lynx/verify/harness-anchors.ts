/**
 * Headless verification that Angular's comment anchors never reach the Main
 * Thread, and that everything anchored on one still lands in the right place.
 *
 * `@if`, `@for`, `@switch`, `<ng-container>` and `*ngIf` each leave a comment
 * node in the view. The renderer keeps them in the shadow tree only, and
 * resolves an insert anchored on one forward to the next sibling the Main
 * Thread has. This checks the native order after every kind of change: a
 * branch appearing before a `@for`, the `@for` reordered, grown and shrunk,
 * a `@switch` case swapped, a multi-root `<ng-container>` toggled, text nodes
 * inside a `<text>`, and `*ngIf` in dev mode (which writes `bindings={…}` into
 * its comment). It also checks that the Main Thread's registry holds exactly
 * the native nodes, so no anchor is created or leaked there.
 *
 * Run with: `npm run verify:anchors`.
 */
import '@angular/compiler';

import { NgIf } from '@angular/common';
import { Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import { bootstrapLynxApplication } from 'ng-lynx';
import 'ng-lynx/main-thread';

import { elements } from '../main-thread/src/element-registry.js';
import { assert, findByClass, getOpsLog, getPage, installMockPapi, type MockEl, tick } from './mock-papi.js';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [NgIf],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="root">
      <view class="head"></view>
      @if (showB()) {
        <view class="b"></view>
      }
      @for (item of items(); track item) {
        <view [class]="'i-' + item"></view>
        @if (item === marked()) {
          <view [class]="'m-' + item"></view>
        }
      }
      @switch (mode()) {
        @case ('x') { <view class="x"></view> }
        @case ('y') { <view class="y"></view> }
      }
      @if (showPair()) {
        <ng-container>
          <view class="c1"></view>
          <view class="c2"></view>
        </ng-container>
      }
      <view class="legacy" *ngIf="showLegacy()"></view>
      <view class="tail"></view>
    </view>
    <text class="greeting">Hello @if (name()) {{{ name() }}}!</text>
  `,
})
export class TestComponent {
  readonly showB = signal(false);
  readonly items = signal(['a', 'b', 'c']);
  readonly marked = signal<string | null>(null);
  readonly mode = signal<'x' | 'y' | 'none'>('x');
  readonly showPair = signal(false);
  readonly showLegacy = signal(true);
  readonly name = signal('');
}

/** The classes of `root`'s native children, in order. */
function order(root: MockEl): string {
  return root.children.map((c) => c.classes ?? c.type).join(' ');
}

/** The text of a `<text>`'s raw-text children, joined. */
function textOf(el: MockEl): string {
  return el.children.map((c) => c.text ?? '').join('');
}

function countNodes(el: MockEl): number {
  let n = 1;
  for (const c of el.children) n += countNodes(c);
  return n;
}

function rawTextOutsideText(el: MockEl, insideText = false): number {
  let n = el.type === '#raw-text' && !insideText ? 1 : 0;
  for (const c of el.children) n += rawTextOutsideText(c, insideText || el.type === 'text');
  return n;
}

async function settle(): Promise<void> {
  await tick();
  await tick();
}

async function main(): Promise<void> {
  installMockPapi();
  (globalThis as Record<string, unknown> & { renderPage(d: unknown): void }).renderPage({});

  const app = await bootstrapLynxApplication(TestComponent);
  await settle();
  const cmp = app.components[0]?.instance as TestComponent;
  const page = getPage();
  const root = findByClass(page, 'root') as MockEl;
  const greeting = findByClass(page, 'greeting') as MockEl;

  const check = (expected: string, label: string): void => {
    assert(order(root) === expected, `${label}: ${expected}`);
    assert(rawTextOutsideText(page) === 0, `${label}: no anchor placeholder in the native tree`);
    assert(
      elements.size === countNodes(page),
      `${label}: the Main Thread registry holds only the native nodes (${elements.size})`,
    );
  };

  console.log('\n=== First render ===');
  check('head i-a i-b i-c x legacy tail', 'first render');
  assert(!JSON.stringify(getOpsLog()).includes('#comment'), 'no op sent so far names #comment');
  assert(textOf(greeting) === 'Hello !', `<text> children: "${textOf(greeting)}"`);

  console.log('\n=== A branch appears before the @for ===');
  cmp.showB.set(true);
  await settle();
  check('head b i-a i-b i-c x legacy tail', '@if before @for');

  console.log('\n=== @for reorders, grows and shrinks ===');
  cmp.items.set(['c', 'a', 'b']);
  await settle();
  check('head b i-c i-a i-b x legacy tail', 'rotated');
  cmp.items.set(['c', 'd', 'a', 'b', 'e']);
  await settle();
  check('head b i-c i-d i-a i-b i-e x legacy tail', 'inserted in the middle and at the end');
  cmp.items.set(['e', 'b', 'a', 'd', 'c']);
  await settle();
  check('head b i-e i-b i-a i-d i-c x legacy tail', 'reversed');
  cmp.items.set(['b', 'd']);
  await settle();
  check('head b i-b i-d x legacy tail', 'shrunk');

  console.log('\n=== An @if nested in a @for row ===');
  cmp.marked.set('b');
  await settle();
  check('head b i-b m-b i-d x legacy tail', 'nested @if in the first row');
  cmp.items.set(['d', 'b']);
  await settle();
  check('head b i-d i-b m-b x legacy tail', 'the row moves with its nested @if');
  cmp.marked.set('d');
  await settle();
  check('head b i-d m-d i-b x legacy tail', 'the nested @if moves to another row');

  console.log('\n=== @switch ===');
  cmp.mode.set('y');
  await settle();
  check('head b i-d m-d i-b y legacy tail', 'case swapped');
  cmp.mode.set('none');
  await settle();
  check('head b i-d m-d i-b legacy tail', 'no case');
  cmp.mode.set('x');
  await settle();
  check('head b i-d m-d i-b x legacy tail', 'case back');

  console.log('\n=== A multi-root <ng-container> ===');
  cmp.showPair.set(true);
  await settle();
  check('head b i-d m-d i-b x c1 c2 legacy tail', 'both roots in order');

  console.log('\n=== *ngIf (dev mode writes into its comment) ===');
  cmp.showLegacy.set(false);
  await settle();
  check('head b i-d m-d i-b x c1 c2 tail', '*ngIf removed');
  cmp.showLegacy.set(true);
  await settle();
  check('head b i-d m-d i-b x c1 c2 legacy tail', '*ngIf back');

  console.log('\n=== Everything empties, then refills ===');
  cmp.showB.set(false);
  cmp.items.set([]);
  cmp.mode.set('none');
  cmp.showPair.set(false);
  cmp.showLegacy.set(false);
  await settle();
  check('head tail', 'emptied');
  cmp.items.set(['z']);
  cmp.showPair.set(true);
  cmp.showB.set(true);
  await settle();
  check('head b i-z c1 c2 tail', 'refilled');

  console.log('\n=== Text nodes inside <text> ===');
  cmp.name.set('Ada');
  await settle();
  assert(textOf(greeting) === 'Hello Ada!', `text anchored on an @if lands before "!": "${textOf(greeting)}"`);
  cmp.name.set('');
  await settle();
  assert(textOf(greeting) === 'Hello !', `and leaves again: "${textOf(greeting)}"`);
  assert(elements.size === countNodes(page), `registry still holds only the native nodes (${elements.size})`);

  console.log('\n✅ All anchor assertions passed: no comment reaches the Main Thread, and order holds.\n');
}

main().catch((err) => {
  console.error('\n❌ Anchor verification failed:\n', err);
  process.exit(1);
});
