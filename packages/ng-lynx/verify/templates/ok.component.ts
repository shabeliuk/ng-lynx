/**
 * Template type test for `ng-lynx/elements`: compiled with `strictTemplates` by
 * `npm run verify:element-templates`, never run. Binds the attributes and events
 * typed from `@lynx-js/types` that used to need `NO_ERRORS_SCHEMA`.
 */
import { Component } from '@angular/core';
import { LYNX_ELEMENTS, type LynxListAnimationEvent, type LynxListAnimationUpdateEvent } from 'ng-lynx/elements';

@Component({
  selector: 'app-ok',
  standalone: true,
  imports: [LYNX_ELEMENTS],
  template: `
    <view
      [consume-slide-event]="[[-30, 30]]"
      [block-native-event-areas]="[['0px', '0px', '100%', '40px']]"
      [event-through]="true"
      [event-through-active-regions]="[['0%', '0%', '50%', '100%']]"
      [native-interaction-enabled]="false"
      [ios-enable-simultaneous-touch]="true"
      [enable-touch-pseudo-propagation]="true"
      [focusable]="true"
      [hardware-layer]="true"
      [accessibility-enable-tap]="true"
      [accessibility-auto-scroll-if-focused]="true"
      [android-accessibility-keep-focused]="true"
    ></view>
    <text [android-emoji-compat]="true" [text-fake-bold]="true">Hi</text>
    <image
      src="a.png"
      image-config="RGB_565"
      [cap-insets-scale]="2"
      [defer-src-invalidation]="true"
      (startplay)="played = $event.type"
      (currentloopcomplete)="played = $event.type"
      (finalloopcomplete)="played = $event.type"
    ></image>
    <list
      [scroll-event-throttle]="50"
      [item-snap]="{ factor: 0, offset: 0 }"
      [bounces]="false"
      (listanimationstart)="onAnimation($event)"
      (listanimationend)="onAnimation($event)"
      (listanimationcancel)="onAnimation($event)"
      (listanimationupdate)="onUpdate($event)"
    ></list>
    <input [confirm-enter]="true" set-soft-input-mode="resize" [ios-auto-correct]="false" [ios-spell-check]="false" [android-fullscreen-mode]="false" />
    <textarea type="email"></textarea>
    <overlay [always-show]="false" android-overlay-scope="fragment" [ios-follow-mode-edge]="true" nest-scroll="#inner"></overlay>
    <scroll-coordinator ios-scroll-exclude="A,B" [ios-scroll-view-filter]="0.3" [android-consume-gesture]="true"></scroll-coordinator>
    <blur-view [experimental-update-blur-radius]="true"></blur-view>
    <webview [ios-hide-keyboard-accessory-view]="true" [params]="{ a: 1 }" initjs="1" [cookies]="[{ name: 'a', value: 'b' }]" [use-osr]="false"></webview>
  `,
})
export class OkComponent {
  played = '';
  progress = 0;
  onAnimation(event: LynxListAnimationEvent): void {
    this.played = event.detail.type;
  }
  onUpdate(event: LynxListAnimationUpdateEvent): void {
    this.progress = event.detail.progress;
  }
}
