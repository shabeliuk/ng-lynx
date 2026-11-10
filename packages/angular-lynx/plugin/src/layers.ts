/** Webpack/Rspack module layers used to separate the two Lynx thread bundles. */
export const LAYERS = {
  /** The Background Thread: Angular runtime + your components + LynxRenderer2. */
  BACKGROUND: 'angular:background',
  /** The Main Thread (Lepus): the PAPI ops executor. */
  MAIN_THREAD: 'angular:main-thread',
} as const;

export type Layer = (typeof LAYERS)[keyof typeof LAYERS];
