/** A plain Main-Thread helper, imported by a 'main thread' function in app.component.ts. */
export function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}
