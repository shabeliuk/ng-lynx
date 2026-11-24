import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  type ElementRef,
  inject,
  signal,
  ViewChild,
} from '@angular/core';
import { asLynxElement, LynxLazyFor } from 'ng-lynx';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

import { BackButtonComponent } from './back-button.component.js';

/**
 * 10,000 rows in a `LynxLazyFor` list: the list knows all of them, only a window
 * is built. The flow flings past where `LynxVirtualFor` used to stop, jumps to row
 * 5000, scrolls back up, and checks the window stays small.
 */
@Component({
  selector: 'app-lazy-list',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackButtonComponent, LYNX_ELEMENTS, LynxLazyFor],
  template: `
    <view class="page">
      <app-back-button></app-back-button>
      <text class="title" [flatten]="false">Lazy rows: {{ rows.length }}</text>
      <text class="line" [flatten]="false">Built: {{ built() }} rows</text>
      <view class="button" [flatten]="false" accessibility-label="Jump to row 5000" (tap)="jump()">
        <text class="button-label">Jump to row 5000</text>
      </view>
      <list #list class="list" list-type="single" [span-count]="1" scroll-orientation="vertical">
        <list-item class="row" *lynxLazyFor="let row of rows; trackBy: byValue; estimatedSize: 48">
          <text class="line" [flatten]="false">Row {{ row }}</text>
        </list-item>
      </list>
    </view>
  `,
})
export class LazyListComponent {
  protected readonly rows = Array.from({ length: 10_000 }, (_, index) => index);
  protected readonly built = signal(0);

  @ViewChild('list') private readonly list?: ElementRef;
  @ViewChild(LynxLazyFor) private readonly lazy?: LynxLazyFor<number>;

  constructor() {
    // The window moves outside change detection; read it twice a second.
    const timer = setInterval(() => {
      const range = this.lazy?.builtRange;
      if (range) this.built.set(range.end - range.start);
    }, 500);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  protected byValue(_index: number, row: number): number {
    return row;
  }

  protected jump(): void {
    if (!this.list) return;
    asLynxElement(this.list.nativeElement).invoke({
      method: 'scrollToPosition',
      params: { position: 5000, smooth: false },
    });
  }
}
