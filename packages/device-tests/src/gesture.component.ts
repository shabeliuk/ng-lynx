import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { LynxGesture, type LynxGestures, LynxMainThreadRef } from 'angular-lynx';
import { LYNX_ELEMENTS } from 'angular-lynx/elements';

import { chipRef, onPanEnd, onPanStart, onPanUpdate } from './worklets.js';

import { BackButtonComponent } from './back-button.component.js';

/**
 * A native pan, dragged more than once: on Android, a style write to a flattened
 * view used to stop the detector for good after the first `onUpdate`.
 */
@Component({
  selector: 'app-gesture',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackButtonComponent, LYNX_ELEMENTS, LynxGesture, LynxMainThreadRef],
  template: `
    <view class="page">
      <app-back-button></app-back-button>
      <text class="title" [flatten]="false">Drags finished: {{ drags() }}</text>
      <view
        class="chip"
        [lynxMainThreadRef]="chipRef"
        [lynxGesture]="gestures"
        accessibility-label="Drag me"
        (mainThreadCallback)="drags.set(drags() + 1)"
      >
        <text class="button-label">Drag me</text>
      </view>
    </view>
  `,
})
export class GestureComponent {
  protected readonly chipRef = chipRef;
  protected readonly gestures: LynxGestures = {
    pan: { type: 'pan', callbacks: { onStart: onPanStart, onUpdate: onPanUpdate, onEnd: onPanEnd } },
  };
  protected readonly drags = signal(0);
}
