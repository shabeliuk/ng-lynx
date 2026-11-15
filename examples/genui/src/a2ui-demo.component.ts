/**
 * A2UI demo: a scripted in-process "agent" pushes protocol messages into a
 * `MessageStore`, `<a2ui-surface>` renders them from the Angular basic
 * catalog, and user actions loop back to the agent — the full client loop
 * from the a2ui docs ("push messages in, render, send actions out"), no
 * network required.
 */
import { ChangeDetectionStrategy, Component, NO_ERRORS_SCHEMA, signal } from '@angular/core';

import { basicFunctions } from '@lynx-js/genui/a2ui/functions';
import {
  A2UI_BASIC_CATALOG,
  A2uiSurface,
  createMessageStore,
  defineA2uiCatalog,
  type ServerToClientMessage,
  type UserActionPayload,
} from 'ng-lynx/genui';

const INITIAL_MESSAGES = [
  { createSurface: { surfaceId: 'shop' } },
  {
    updateComponents: {
      surfaceId: 'shop',
      components: [
        { id: 'root', component: 'Column', children: ['title', 'card', 'qty-row', 'buy', 'status'] },
        { id: 'title', component: 'Text', text: 'Lynx Gear Shop', variant: 'headline' },
        { id: 'card', component: 'Card', child: 'card-body' },
        { id: 'card-body', component: 'Column', children: ['name', 'price', 'badges'] },
        { id: 'name', component: 'Text', text: { path: '/product/name' } },
        { id: 'price', component: 'Text', text: { path: '/product/price' } },
        { id: 'badges', component: 'Row', children: { path: '/product/badges', componentId: 'badge-tpl' } },
        { id: 'badge-tpl', component: 'Text', text: { path: 'label' } },
        { id: 'qty-row', component: 'Row', children: ['qty-label', 'qty'] },
        { id: 'qty-label', component: 'Text', text: 'Qty' },
        { id: 'qty', component: 'Slider', value: { path: '/order/qty' }, minValue: 1, maxValue: 5 },
        { id: 'buy-label', component: 'Text', text: 'Add to cart' },
        {
          id: 'buy',
          component: 'Button',
          child: 'buy-label',
          action: { event: { name: 'add-to-cart', context: { qty: { path: '/order/qty' } } } },
        },
        { id: 'status', component: 'Text', text: { path: '/order/status' } },
      ],
    },
  },
  {
    updateDataModel: {
      surfaceId: 'shop',
      path: '/',
      value: {
        product: {
          name: 'Lynx Hoodie',
          price: '$49',
          badges: [{ label: '★ NEW' }, { label: 'SOFT' }],
        },
        order: { qty: 1, status: 'Pick a quantity and add to cart.' },
      },
    },
  },
] as unknown as ServerToClientMessage[];

@Component({
  selector: 'a2ui-demo',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  schemas: [NO_ERRORS_SCHEMA],
  imports: [A2uiSurface],
  template: `
    <view class="demo">
      <a2ui-surface [messageStore]="store" [catalog]="catalog" (action)="onAction($event)" />
      <text class="event-log">{{ lastEvent() }}</text>
    </view>
  `,
})
export class A2uiDemoComponent {
  readonly store = createMessageStore({ initialMessages: INITIAL_MESSAGES });
  readonly catalog = defineA2uiCatalog([
    ...A2UI_BASIC_CATALOG,
    ...(basicFunctions as never[]),
  ]);
  readonly lastEvent = signal('agent events appear here');

  /** The "agent": responds to user actions with new protocol messages. */
  onAction(action: UserActionPayload): void {
    this.lastEvent.set(`→ agent: ${action.name} ${JSON.stringify(action.context)}`);
    if (action.name === 'add-to-cart') {
      const qty = Number(action.context['qty'] ?? 1);
      this.store.push([
        {
          updateDataModel: {
            surfaceId: 'shop',
            path: '/order/status',
            value: `✓ Added ${qty} × Lynx Hoodie to your cart.`,
          },
        },
      ] as unknown as ServerToClientMessage[]);
    }
  }
}
