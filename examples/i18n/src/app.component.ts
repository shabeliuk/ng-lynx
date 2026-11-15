import { ChangeDetectionStrategy, Component, computed, NO_ERRORS_SCHEMA, signal } from '@angular/core';

/**
 * `$localize` under this package's AOT build (`@ngtools/webpack`, not
 * Angular CLI's own builder — see docs/35-i18n.md for why that distinction
 * matters here). Every message is a `$localize` tagged template literal
 * directly in component TypeScript code, rather than the declarative
 * `i18n="..."` template attribute — both forms work (a past bug once made
 * the attribute form silently stop rendering everything past the first
 * `i18n`-attributed element; see docs/35-i18n.md for the root cause and fix).
 * This example sticks with `$localize` fields because the bundled extractor,
 * `ng-lynx-extract-i18n`, only scans `.ts` source for `$localize` calls
 * — see docs/35-i18n.md.
 *
 * Every message below has an explicit custom id (`@@id`) — hand-authored
 * translations in `src/locales/*.json` key off exactly these ids, matching
 * what a real project would do whether or not it also uses the extraction
 * tooling (not used here — see docs/35-i18n.md for why).
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="app">
      <text class="title">{{ title }}</text>
      <text class="greeting">{{ greeting() }}</text>
      <text class="subtitle">{{ subtitle }}</text>
      <view class="btn" (tap)="sayHello()">
        <text class="btn-label">{{ sayHelloButton }}</text>
      </view>
      <text class="response">{{ response() }}</text>

      <view class="about">
        <text class="about-language">{{ language }}</text>
        <text class="about-body">{{ about }}</text>
      </view>
    </view>
  `,
})
export class AppComponent {
  readonly name = signal('Ada');
  readonly response = signal('');

  readonly title = $localize`:@@title:Welcome`;
  readonly subtitle = $localize`:An instruction below the greeting@@subtitle:Tap the button below to say hello back.`;
  readonly sayHelloButton = $localize`:@@sayHelloButton:Say hello`;

  /** What this demo shows, translated like everything else. */
  readonly language = $localize`:The language this build was made in@@language:Language: English`;
  readonly about = $localize`:What the demo shows@@about:This screen was translated when the app was built, not on your phone. npm run dev builds it in English and npm run dev:ua in Ukrainian. Each bundle holds one language, so changing the phone's language changes nothing here. The greeting puts a name into a translated sentence.`;

  // `$localize` isn't itself reactive — re-evaluate it inside a `computed()`
  // so the greeting still tracks `name()`, the same way any other derived
  // signal would.
  readonly greeting = computed(() => $localize`:@@greeting:Hello, ${this.name()}:name:!`);

  sayHello(): void {
    this.response.set($localize`:@@helloBack:Hello to you too!`);
  }
}
