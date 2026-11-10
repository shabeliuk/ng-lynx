import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';

import { lynxAssetUrl } from 'angular-lynx';
import { LYNX_ELEMENTS } from 'angular-lynx/elements';
import { LynxSlider, LynxStepper } from 'angular-lynx/forms';

/**
 * A single accessible screen, exercising the typed `accessibility-*` inputs
 * on `LynxStandardElement` (curated from `@lynx-js/types@3.7.0`'s
 * `StandardProps` — see docs/34-accessibility.md):
 *
 *  - `accessibility-traits="header"` on the title (screen readers announce it
 *    as a heading, not plain text);
 *  - `accessibility-label` on the avatar image (a real image needs a spoken
 *    description; its own text content, if any, is irrelevant to an image).
 *    The label describes **what is actually in the picture** rather than
 *    repeating the name next to it — a screen reader already reads that name
 *    from the adjacent text, so "Profile photo of Ada Lovelace" would be
 *    redundant *and*, here, untrue;
 *  - `[accessibility-elements-hidden]="true"` on the purely decorative divider
 *    — nothing for a screen reader to say about it, so it's removed from the
 *    accessibility tree entirely rather than read as a meaningless line;
 *  - `accessibility-role-description="progressbar"` + a live
 *    `accessibility-value` on the profile-completeness bar;
 *  - `accessibility-traits="button"` + `accessibility-label` on the follow
 *    toggle;
 *  - `[accessibility-actions]` on the message row (custom actions a screen
 *    reader can surface beyond a plain tap);
 *  - `LynxSlider` / `LynxStepper` (`angular-lynx/forms`) already carry their
 *    own `accessibility-traits`/`accessibility-value`/`accessibility-label`
 *    wiring internally — see slider.ts / stepper.ts.
 *
 * **Honest limitation:** these attributes are native-platform-only —
 * `@lynx-js/web-core` doesn't map any of them onto real ARIA attributes (its
 * compiled bundle has no `aria-*`/`role` handling at all — confirmed by
 * grepping it), so this screen can be verified structurally (the right
 * attribute values reach the wire protocol and the native tree — see
 * `npm run verify:elements` / `verify:controls`) but not with a live iOS
 * VoiceOver / Android TalkBack pass, since there's no device available here.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS, FormsModule, LynxSlider, LynxStepper],
  template: `
    <view class="app">
      <text class="title" accessibility-traits="header">Profile</text>

      <view class="row">
        <image
          class="avatar"
          [src]="avatarSrc"
          mode="aspectFill"
          accessibility-label="Profile photo: a tabby kitten looking at the camera"
          (error)="avatarFailed.set(true)"
        />
        <!-- Purely decorative — nothing for a screen reader to announce. -->
        <view class="divider" [accessibility-elements-hidden]="true"></view>
        <view class="identity">
          <text class="name">Ada Lovelace</text>
          <text class="handle">&#64;ada</text>
        </view>
      </view>

      <text class="label">Profile completeness</text>
      <view
        class="progress-track"
        accessibility-role-description="progressbar"
        [accessibility-value]="completeness() + '%'"
      >
        <view class="progress-fill" [style.width.%]="completeness()"></view>
      </view>

      <view
        class="follow"
        [class.following]="following()"
        accessibility-traits="button"
        [accessibility-label]="following() ? 'Unfollow Ada Lovelace' : 'Follow Ada Lovelace'"
        (tap)="toggleFollow()"
      >
        <text class="follow-label">{{ following() ? 'Following' : 'Follow' }}</text>
      </view>

      <view
        class="message-row"
        [accessibility-actions]="['Reply', 'Archive']"
        accessibility-label="Message from Ada: Analytical Engine draft attached"
      >
        <text class="message-preview">Analytical Engine draft attached…</text>
      </view>

      <text class="label">Notification volume</text>
      <lynx-slider class="control" [min]="0" [max]="100" [step]="10" [(ngModel)]="volume" />

      <text class="label">Team size</text>
      <lynx-stepper class="control" [min]="1" [max]="12" [(ngModel)]="teamSize" />
    </view>
  `,
})
export class AppComponent {
  /**
   * A real image, served from this example's own `public/`. It used to point
   * at `https://example.com/avatar.png` — a placeholder that never resolves,
   * so on-device the avatar was just an empty circle. `lynxAssetUrl()` makes
   * it absolute, which a real engine requires (docs/22-http.md).
   */
  readonly avatarSrc = lynxAssetUrl('media/avatar.jpg');
  /** Surfaced in the UI so a broken asset is visible rather than silent. */
  readonly avatarFailed = signal(false);
  readonly following = signal(false);
  readonly completeness = signal(80);
  volume = 50;
  teamSize = 3;

  toggleFollow(): void {
    this.following.update((v) => !v);
  }
}
