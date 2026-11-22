/**
 * The other half of `verify:element-templates`: each binding here is wrong, and
 * the check expects ngc to report every one of them.
 */
import { Component } from '@angular/core';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

@Component({
  selector: 'app-bad',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  template: `
    <view [hardware-layer]="'yes'"></view>
    <image image-config="RGB_888"></image>
    <list [scroll-event-throttle]="'fast'"></list>
    <input set-soft-input-mode="adjust" />
    <list (listanimationupdate)="takesString($event.detail.progress)"></list>
    <view [consume-slide-event]="[30, 60]"></view>
  `,
})
export class BadComponent {
  takesString(_: string): void {}
}
