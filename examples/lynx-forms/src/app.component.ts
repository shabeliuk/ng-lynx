import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  NO_ERRORS_SCHEMA,
  signal,
} from '@angular/core';
import { LynxGlobalEvents, LynxModel } from 'ng-lynx';

/**
 * Two-way input binding with `[(lynxModel)]` (or the signal-friendly
 * `[lynxModel]` + `(lynxModelChange)` split). No `@angular/forms` needed.
 *
 * The form sits at the bottom of the screen, where the keyboard opens over it.
 * Lynx's `<input>` doesn't avoid the keyboard on its own, so the form moves up
 * by the height `keyboardstatuschanged` reports, and back when it closes.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LynxModel],
  schemas: [NO_ERRORS_SCHEMA],
  template: `
    <view class="app">
      <view class="form" [style.transform]="keyboardLift()">
        <text class="title">Sign up</text>

        <input
          class="field field-name"
          placeholder="Your name"
          [lynxModel]="name()"
          (lynxModelChange)="name.set($event)"
        />
        <input
          class="field field-email"
          placeholder="Email"
          confirm-type="done"
          [lynxModel]="email()"
          (lynxModelChange)="email.set($event)"
          (confirm)="submit()"
        />

        <text class="greeting">{{ greeting() }}</text>

        <view class="submit" [class.disabled]="!valid()" (tap)="submit()">
          <text class="submit-label">Submit</text>
        </view>

        <text class="status">{{ status() }}</text>
      </view>
    </view>
  `,
})
export class AppComponent {
  private readonly keyboard = inject(LynxGlobalEvents).latest<[status: string, height: number, compatHeight: number]>(
    'keyboardstatuschanged',
  );
  readonly keyboardLift = computed(() => {
    const keyboard = this.keyboard();
    return keyboard?.[0] === 'on' ? `translateY(-${keyboard[1]}px)` : 'translateY(0px)';
  });

  readonly name = signal('');
  readonly email = signal('');

  readonly greeting = computed(() =>
    this.name() ? `Hi, ${this.name()}!` : 'Tell us your name',
  );
  readonly valid = computed(() => this.name().length > 0 && this.email().includes('@'));
  readonly status = signal('');

  submit(): void {
    this.status.set(
      this.valid() ? `Submitted ${this.name()} <${this.email()}>` : 'Fill all fields',
    );
  }
}
