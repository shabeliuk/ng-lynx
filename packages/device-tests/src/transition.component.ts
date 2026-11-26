import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { LynxEnter, LynxLeave } from 'ng-lynx';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';

import { BackButtonComponent } from './back-button.component.js';

/**
 * `lynxEnter` / `lynxLeave` on a real engine: a panel that animates in with a
 * keyframe animation and out with a slower one, kept on screen until the engine
 * says the leave animation is over. Its leave timeout is far longer than the
 * animation, so a panel gone within a few seconds was removed by `animationend`,
 * not the timeout. A second box shows a CSS transition and its `transitionend`.
 */
@Component({
  selector: 'app-transition',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackButtonComponent, LYNX_ELEMENTS, LynxEnter, LynxLeave],
  template: `
    <view class="page">
      <app-back-button></app-back-button>
      <view class="button" [flatten]="false" accessibility-label="Toggle panel" (tap)="open.set(!open())">
        <text class="button-label">Toggle panel</text>
      </view>
      <view class="button" [flatten]="false" accessibility-label="Fade box" (tap)="faded.set(!faded())">
        <text class="button-label">Fade box</text>
      </view>
      <text class="line" [flatten]="false">Enter ended: {{ enterEnded() }}</text>
      <text class="line" [flatten]="false">Transition ended: {{ transitionEnded() }}</text>
      <view class="transition-box" [class.faded]="faded()" (transitionend)="transitionEnded.set(transitionEnded() + 1)"></view>
      @if (open()) {
        <view
          class="transition-panel"
          [flatten]="false"
          lynxEnter="panel-in"
          lynxLeave="panel-out"
          [lynxLeaveTimeout]="20000"
          (animationend)="enterEnded.set(enterEnded() + 1)"
        >
          <text class="line" [flatten]="false">Animated panel</text>
        </view>
      }
    </view>
  `,
})
export class TransitionComponent {
  protected readonly open = signal(false);
  protected readonly faded = signal(false);
  protected readonly enterEnded = signal(0);
  protected readonly transitionEnded = signal(0);
}
