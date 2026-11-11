// Turbopack (next dev) target for `@eshaz/web-worker`. The MP3 decoder that
// checks recap songs decodes on the calling thread; its worker shim is only
// subclassed when its module loads, never constructed on the server. The
// shim's dynamic `import(mod)` cannot be bundled by Turbopack, so dev uses
// this class instead. Production builds use Webpack and keep the real shim.
export default class ServerWebWorker {
  constructor() {
    throw new Error("Web workers are not available on the server.");
  }
}
