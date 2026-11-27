// Type definitions for @katabame/stylus

import { EventEmitter } from 'events';

/**
 * Create a `Renderer` for the Stylus source `str`.
 *
 *     stylus(str).set('filename', 'style.styl').render();
 */
declare function stylus(str: string, options?: stylus.RenderOptions): stylus.Renderer;

declare namespace stylus {
  /** Library version. */
  const version: string;

  /** Render `str` to CSS. */
  function render(str: string, options?: RenderOptions): string;
  function render(str: string, callback: RenderCallback): void;
  function render(str: string, options: RenderOptions, callback: RenderCallback): void;

  /** Express / Connect middleware compiling `.styl` files on request. */
  function middleware(src: string): Middleware;
  function middleware(options: MiddlewareOptions): Middleware;

  /** `url()` function inlining files as data URIs, for `define('url', stylus.url())`. */
  function url(options?: UrlOptions): DefinedFunction;

  /** `url()` function resolving relative URLs, for `define('url', stylus.resolver())`. */
  function resolver(options?: ResolverOptions): DefinedFunction;

  /** Convert CSS to Stylus. */
  function convertCSS(css: string): string;

  /** AST nodes. */
  const nodes: { [name: string]: any };

  /** Built-in functions. */
  const functions: { [name: string]: any };

  /** Utilities. */
  const utils: { [name: string]: any };

  const Visitor: new (root: any) => any;
  const Parser: new (str: string, options?: RenderOptions) => { parse(): any; [key: string]: any };
  const Evaluator: new (root: any, options?: RenderOptions) => { evaluate(): any; [key: string]: any };
  const Normalizer: new (root: any, options?: RenderOptions) => { normalize(): any; [key: string]: any };
  const Compiler: new (root: any, options?: RenderOptions) => { compile(): string; [key: string]: any };

  type RenderCallback = (err: Error | null, css?: string) => void;

  /** Function given to `define()`, receiving and returning AST nodes. */
  type DefinedFunction = (this: any, ...args: any[]) => any;

  /** Plugin given to `use()`. */
  type Plugin = (renderer: Renderer) => void;

  interface SourceMapOptions {
    /** Include the sources in the map. */
    inline?: boolean;
    /** `sourceRoot` of the map. */
    sourceRoot?: string;
    /** Base path the sources are relative to. */
    basePath?: string;
    /** Add the `sourceMappingURL` comment (default `true`). */
    comment?: boolean;
  }

  interface RenderOptions {
    /** Filename, used for errors, relative imports and source maps. */
    filename?: string;
    /** Lookup paths for `@import` and `url()`. */
    paths?: string[];
    /** Compress the CSS output. */
    compress?: boolean;
    /** Emit comments with the corresponding Stylus line. */
    linenos?: boolean;
    /** Emit debug info for the (obsolete) FireStylus Firebug plugin. */
    firebug?: boolean;
    /** Generate a source map (`renderer.sourcemap`). */
    sourcemap?: boolean | SourceMapOptions;
    /** Inline regular CSS on `@import`. */
    'include css'?: boolean;
    /** Move `@import` and `@charset` to the top. */
    'hoist atrules'?: boolean;
    /** Resolve relative urls inside imports. */
    'resolve url'?: boolean;
    /** Prefix all CSS classes. */
    prefix?: string;
    /** Files imported before the source. */
    imports?: string[];
    /** Plugins. */
    use?: Plugin | Plugin[];
    /** Global variables, as AST nodes. */
    globals?: { [name: string]: any };
    /** Functions, as given to `define()`. */
    functions?: { [name: string]: DefinedFunction };
    /** Cache the parsed imports. */
    cache?: boolean;
    [key: string]: any;
  }

  interface Renderer extends EventEmitter {
    options: RenderOptions;
    /** Source map, when the `sourcemap` option is set, after rendering. */
    sourcemap?: any;

    /** Render to CSS, throwing on errors. */
    render(): string;
    /** Render to CSS. */
    render(callback: RenderCallback): void;

    /** Return the paths of the files imported by the source. */
    deps(filename?: string): string[];

    /** Set the option `key` to `val`. */
    set<K extends keyof RenderOptions>(key: K, val: RenderOptions[K]): this;
    /** Get the option `key`. */
    get<K extends keyof RenderOptions>(key: K): RenderOptions[K];

    /** Add a lookup path for `@import` and `url()`. */
    include(path: string): this;

    /** Use the plugin `fn`. */
    use(fn: Plugin): this;

    /** Define a global variable (an AST node or a JavaScript value) or a function. */
    define(name: string, value: any, raw?: boolean): this;

    /** Import `file` before the source. */
    import(file: string): this;
  }

  interface UrlOptions {
    /** Lookup paths of the files to inline. */
    paths?: string[];
    /** Maximum size in bytes of the files to inline (default 30000), `false` for no limit. */
    limit?: number | false;
    /** MIME types by extension, e.g. `{ '.png': 'image/png' }`. */
    mimes?: { [ext: string]: string };
  }

  interface ResolverOptions {
    /** Lookup paths. */
    paths?: string[];
    /** Don't check that the files exist. */
    nocheck?: boolean;
  }

  interface MiddlewareOptions {
    /** Directory of the `.styl` files, or a function mapping a request path to a file. */
    src: string | ((path: string) => string);
    /** Directory of the `.css` files (default `src`), or a function mapping a request path to a file. */
    dest?: string | ((path: string) => string);
    /** Return the renderer of a source. */
    compile?: (str: string, path: string) => Renderer;
    /** Always recompile. */
    force?: boolean;
    compress?: boolean;
    firebug?: boolean;
    linenos?: boolean;
    sourcemap?: boolean | SourceMapOptions;
  }

  type Middleware = (req: { method?: string; url?: string }, res: any, next: (err?: any) => void) => void;
}

export = stylus;
