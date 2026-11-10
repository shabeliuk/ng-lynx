/**
 * Capture entry for the first-screen snapshot (`npm run capture`): the default
 * export is the root component `angular-lynx-capture` boots headlessly to
 * record the first ops batch. Re-run the capture whenever the first screen
 * changes (a stale snapshot is safe — the app falls back to a re-render — but
 * wastes the fast first frame).
 */
export { AppComponent as default } from './app.component.js';
