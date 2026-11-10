import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { lynxAssetUrl } from 'angular-lynx';
import { LYNX_ELEMENTS } from 'angular-lynx/elements';

import { BackButtonComponent } from './back-button.component.js';

/**
 * The typed attributes and events added for 1.0, under `strictTemplates`: a wrong name or
 * type here fails this package's build. On a device, the engine has to accept all of them
 * with no error, and the three with something to see have to work.
 */
@Component({
  selector: 'app-attributes',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [BackButtonComponent, LYNX_ELEMENTS],
  template: `
    <view
      class="page"
      a11y-id="page"
      accessibility-elements="press"
      accessibility-elements-a11y="press"
      exposure-screen-margin-top="10px"
      exposure-screen-margin-bottom="10px"
      exposure-screen-margin-left="2rpx"
      exposure-screen-margin-right="2rpx"
      exposure-ui-margin-top="10px"
      exposure-ui-margin-bottom="10px"
      exposure-ui-margin-left="2rpx"
      exposure-ui-margin-right="2rpx"
      [enable-exposure-ui-margin]="true"
      [enable-exposure-ui-clip]="true"
      (focus)="noop($event.type)"
      (blur)="noop($event.type)"
      (animationiteration)="noop($event.animation_name)"
      (animationcancel)="noop($event.animation_name)"
      (transitioncancel)="noop($event.animation_type)"
      (accessibilityaction)="noop($event.detail.name)"
      (bgload)="noop($event.detail.width)"
      (bgerror)="noop($event.detail.errMsg)"
      (mouseclick)="noop($event.type)"
    >
      <app-back-button></app-back-button>
      <text
        class="title"
        [flatten]="false"
        text-single-line-vertical-align="center"
        [text-selection]="true"
        [custom-context-menu]="false"
        [custom-text-selection]="false"
        [selection-background-color]="1073741824"
        [selection-handle-color]="4278190080"
        [selection-handle-size]="8"
      >Long presses: {{ presses() }}</text>
      <view
        class="button"
        [flatten]="false"
        a11y-id="press"
        accessibility-label="Long press me"
        (longpress)="presses.set(presses() + 1)"
      >
        <text class="button-label">Long press me</text>
      </view>
      <input class="field" [flatten]="false" default-value="Preset" />
      <markdown
        class="markdown"
        content="**Bold** and a [link](https://lynxjs.org)"
        animation-type="none"
        [text-maxline]="2"
        (drawEnd)="markdownDrawn.set(true)"
        (link)="noop($event.detail.url)"
        (overflow)="noop($event.detail.type)"
      ></markdown>
      <text class="line" [flatten]="false">Markdown drawn: {{ markdownDrawn() ? 'yes' : 'no' }}</text>
      <view class="images" [flatten]="false">
        <filter-image class="thumb" [src]="square" mode="aspectFill" blur-radius="2px" (load)="filterLoaded.set(true)"></filter-image>
        <text class="line" [flatten]="false">
          Inline <inline-text text-maxline="1">text</inline-text> and
          <inline-image class="inline" [src]="square" custom-baseline-shift="-2px"></inline-image>
          <inline-truncation><inline-text>…</inline-text></inline-truncation>
        </text>
      </view>
      <text class="line" [flatten]="false">Filter image loaded: {{ filterLoaded() ? 'yes' : 'no' }}</text>
      <list
        class="list"
        list-type="single"
        [span-count]="1"
        scroll-orientation="vertical"
        [initial-scroll-index]="40"
        [upper-threshold-item-count]="1"
        [lower-threshold-item-count]="1"
      >
        @for (row of rows; track row) {
          <list-item class="row" [attr.item-key]="row" [estimated-main-axis-size-px]="48">
            <text class="line" [flatten]="false">Row {{ row }}</text>
          </list-item>
        }
      </list>
    </view>
  `,
})
export class AttributesComponent {
  protected readonly presses = signal(0);
  protected readonly markdownDrawn = signal(false);
  protected readonly filterLoaded = signal(false);
  protected readonly square = lynxAssetUrl('square.png');
  protected readonly rows = Array.from({ length: 80 }, (_, index) => index);
  protected noop(_value: unknown): void {}
}
