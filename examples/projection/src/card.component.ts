import { ChangeDetectionStrategy, Component, NO_ERRORS_SCHEMA } from '@angular/core';

/**
 * A reusable card shell with a named "header" slot and a default body slot.
 *
 * Demonstrates `<ng-content>` on Lynx: Ivy's projection instructions
 * (`ɵɵprojectionDef` / `ɵɵprojection`) resolve matching nodes and insert them via
 * the same `Renderer2.appendChild` / `insertBefore` calls as any other node, so
 * this needs no Lynx-specific code at all. See docs/14-content-projection.md.
 *
 * Note: Angular always creates a real host element for a component's selector
 * (`<app-card>`, here) — unlike Vue, where a component's template root replaces
 * its tag with no wrapper. On Lynx, `<app-card>` falls back to a generic
 * `__CreateElement('app-card', …)`, an unstyled container — harmless, but worth
 * knowing it's an extra node in the native tree.
 */
@Component({
  selector: 'app-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="card">
      <view class="card-header">
        <ng-content select="[header]"></ng-content>
      </view>
      <view class="card-body">
        <ng-content></ng-content>
      </view>
    </view>
  `,
})
export class CardComponent {}
