import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LYNX_ELEMENTS } from 'ng-lynx/elements';
import {
  LynxCheckbox,
  LynxSelect,
  type LynxSelectOption,
  LynxToggle,
  LynxValueAccessor,
} from 'ng-lynx/forms';

/**
 * `@angular/forms` on Lynx: `LynxValueAccessor` bridges `[(ngModel)]` to the
 * Lynx `<input>`, and the headless controls from `ng-lynx/forms`
 * (select, checkbox, toggle, pickers, …) are ControlValueAccessors too.
 * They ship unstyled; index.ts imports the optional default theme,
 * `ng-lynx/forms/theme.css`. See docs/09-forms.md#theming.
 */
@Component({
  selector: 'app-root',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [LYNX_ELEMENTS, FormsModule, LynxValueAccessor, LynxSelect, LynxCheckbox, LynxToggle],
  template: `
    <scroll-view class="app" scroll-orientation="vertical">
      <text class="title">Sign up</text>

      <text class="label">Name</text>
      <input class="field" placeholder="Ada Lovelace" [(ngModel)]="name" />

      <text class="label">Favorite framework</text>
      <lynx-select [options]="frameworks" placeholder="Pick one…" [(ngModel)]="framework" />

      <lynx-checkbox [(ngModel)]="subscribe">
        <text class="label">Subscribe to updates</text>
      </lynx-checkbox>

      <lynx-toggle [(ngModel)]="dark">
        <text class="label">Dark mode</text>
      </lynx-toggle>

      <view class="submit" (tap)="submit()">
        <text class="submit-label">Submit</text>
      </view>

      <text class="result">{{ result() }}</text>
    </scroll-view>
  `,
})
export class AppComponent {
  readonly frameworks: LynxSelectOption[] = [
    { label: 'Angular', value: 'angular' },
    { label: 'React', value: 'react' },
    { label: 'Vue', value: 'vue' },
  ];

  name = '';
  framework = '';
  subscribe = false;
  dark = false;

  readonly result = signal('');

  submit(): void {
    this.result.set(
      `Hello ${this.name || 'stranger'} — ${this.framework || 'no pick'}, `
        + `subscribe: ${this.subscribe}, dark: ${this.dark}`,
    );
  }
}
