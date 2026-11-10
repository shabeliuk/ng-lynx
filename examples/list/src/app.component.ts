import {
  ChangeDetectionStrategy,
  Component,
  type ElementRef,
  NO_ERRORS_SCHEMA,
  signal,
  ViewChild,
} from '@angular/core';

import { asLynxElement } from 'angular-lynx';

interface Contact {
  id: number;
  name: string;
  role: string;
}

interface ScrollDetail {
  scrollTop?: number;
  scrollHeight?: number;
}

/**
 * Demonstrates Lynx's native virtualized `<list>` with Angular `@for`, plus its
 * scroll events and an imperative scroll method.
 *
 * Key rules (see docs/08-lists.md):
 *  - Direct children of `<list>` must be `<list-item>` elements.
 *  - Every `<list-item>` needs a stable `item-key` (bind it with
 *    `[attr.item-key]`). Placement hints like `estimated-main-axis-size-px`
 *    are also list-item "platform info" attributes.
 *  - `<list>` config (`list-type`, `span-count`, `scroll-orientation`) are
 *    normal attributes on the list itself.
 *  - Scroll events (`scroll`, `scrolltolower`, `scrolltoupper`, …) bind like
 *    any other event — `LynxRenderer2.listen()` is generic, no special-casing
 *    needed. Imperative scroll methods (`scrollToPosition`, `scrollBy`,
 *    `getVisibleCells`, `autoScroll`) go through the same `invoke()` selector
 *    query as any other element method (see docs/10-element-queries.md).
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="app">
      <text class="title">Contacts ({{ contacts().length }})</text>
      <text class="status">{{ status() }}</text>

      <list
        #listRef
        class="list"
        list-type="single"
        span-count="1"
        scroll-orientation="vertical"
        lower-threshold-item-count="1"
        (scroll)="onScroll($event)"
        (scrolltolower)="onLower()"
        (scrolltoupper)="onUpper()"
      >
        @for (c of contacts(); track c.id) {
          <list-item
            class="row"
            [attr.item-key]="c.id"
            estimated-main-axis-size-px="64"
          >
            <text class="name">{{ c.name }}</text>
            <text class="role">{{ c.role }}</text>
          </list-item>
        }
      </list>

      <view class="bar">
        <view class="btn btn-add" (tap)="add()">
          <text class="btn-label">Add</text>
        </view>
        <view class="btn btn-remove" (tap)="removeFirst()">
          <text class="btn-label">Remove first</text>
        </view>
        <view class="btn btn-reverse" (tap)="reverse()">
          <text class="btn-label">Reverse</text>
        </view>
        <view class="btn btn-top" (tap)="scrollToTop()">
          <text class="btn-label">Scroll to top</text>
        </view>
      </view>
    </view>
  `,
})
export class AppComponent {
  // Decorator-based query: works under JIT (initializer-based viewChild() needs AOT).
  @ViewChild('listRef') listRef!: ElementRef;

  private nextId = 4;
  readonly contacts = signal<Contact[]>([
    { id: 1, name: 'Ada Lovelace', role: 'Engineer' },
    { id: 2, name: 'Alan Turing', role: 'Mathematician' },
    { id: 3, name: 'Grace Hopper', role: 'Admiral' },
  ]);
  readonly status = signal('');

  /**
   * `scrolltolower` only fires from an actual scroll-position change (native
   * scroll-delegate semantics, same as WeChat Mini Program's `onReachBottom`
   * — see docs/12-events.md). Appending rows while already at the bottom
   * grows the list below the current position without any scroll happening,
   * so that event never re-fires — found on device: the status stayed
   * "reached the bottom" (now false, since there's unseen content below)
   * until the user scrolled again. Clear the stale claim here instead of
   * waiting on a native event that won't come.
   */
  add(): void {
    const id = this.nextId++;
    this.contacts.update((list) => [
      ...list,
      { id, name: `Contact ${id}`, role: 'New' },
    ]);
    if (this.status() === 'reached the bottom') {
      this.status.set('');
    }
  }

  removeFirst(): void {
    this.contacts.update((list) => list.slice(1));
  }

  reverse(): void {
    this.contacts.update((list) => [...list].reverse());
  }

  // `scroll` is a recognized DOM event name, so Angular's strict template
  // checker types `$event` as the real DOM `Event` (no `.detail`) — even
  // though Lynx's `<list>` fires its own `scroll` with a `.detail` payload.
  // Type the parameter as `Event` to match what's inferred, then cast through
  // `unknown` to reach the actual Lynx shape.
  onScroll(event: Event): void {
    const detail = (event as unknown as { detail?: ScrollDetail }).detail;
    this.status.set(`scrollTop=${detail?.scrollTop ?? 0}`);
  }

  onLower(): void {
    this.status.set('reached the bottom');
  }

  onUpper(): void {
    this.status.set('reached the top');
  }

  scrollToTop(): void {
    asLynxElement(this.listRef.nativeElement).invoke({
      method: 'scrollToPosition',
      params: { position: 0, smooth: true },
      success: () => this.status.set('scrolled to top'),
    });
  }
}
