/**
 * The one test that boots the served Remote's document imports jsdom directly.
 * The package ships no declaration and the window has no `@types/node`; the
 * surface this project uses is small and is declared here rather than pulling
 * a type package into the runtime-only dependency.
 */
declare module "jsdom" {
  export class JSDOM {
    constructor(html?: string, options?: Record<string, unknown>);
    readonly window: any;
  }
}
