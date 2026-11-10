/**
 * Replace the Web globals that Node has and a real Lynx engine's Background Thread only
 * partly has. A harness imports this first, ahead of Angular, so what fails on a device
 * fails here too. Angular 22's router reads `new URL(url, base).origin`: on the engine's
 * `URL`, as here, that's `undefined`, so every route became `/` on a device while the
 * harnesses stayed green.
 */

/** Node's own, for comparing with. */
export const NodeURL = URL;
export const NodeURLSearchParams = URLSearchParams;

export class EngineURL {
  private readonly _url: string;

  constructor(url: string, base?: string) {
    this._url = base === undefined ? String(url) : `${String(base)}${String(url)}`;
  }

  get href(): string {
    return this._url;
  }

  toString(): string {
    return this._url;
  }
}

const g = globalThis as Record<string, unknown>;

g['URL'] = EngineURL;
delete g['URLSearchParams'];
