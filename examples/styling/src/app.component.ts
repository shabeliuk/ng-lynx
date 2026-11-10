import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { LYNX_ELEMENTS } from 'angular-lynx/elements';

/**
 * All styling comes from `styles.scss` (imported in index.ts) — this component
 * only references the class names. The point of the example is that Sass
 * nesting/variables/mixins compile away before Lynx's CSS engine runs, so the
 * rendered result is indistinguishable from hand-written CSS.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS],
  template: `
    <view class="app">
      <view class="card">
        <text class="card-title">Styled with Sass</text>
        <text class="card-body">Nesting, variables, mixins and colour functions, all compiled to plain CSS at build time. This card's light blue and this green are both computed by Sass colour functions.</text>
      </view>

      <view class="pill" (tap)="taps.set(taps() + 1)">
        <text class="pill-label">Tapped {{ taps() }}×</text>
      </view>

      <!-- A parent-state rule: the tap moves a class on this view only, and
           the stylesheet's .switch-on .switch-knob / .switch-label restyle its
           children. That needs enableCSSInvalidation, which pluginAngularLynx
           turns on. Without it, Lynx matched the rule only against the classes
           an element had when it was created, so on a device the knob never
           changed colour, not even for the first render. -->
      <view class="switch" [class.switch-on]="on()" (tap)="on.set(!on())">
        <view class="switch-knob"></view>
        <text class="switch-label">{{ on() ? 'On' : 'Off' }}: coloured by its parent's class</text>
      </view>
    </view>
  `,
})
export class AppComponent {
  readonly taps = signal(0);
  /** Starts on, so the first render is tested as well as both directions of a change. */
  readonly on = signal(true);
}
