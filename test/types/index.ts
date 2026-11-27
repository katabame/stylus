// Type-checked by `tsc -p test/types` (CI), not run
import stylus = require('../..');

const css: string = stylus('.a\n  color red')
  .set('filename', 'a.styl')
  .set('compress', true)
  .set('sourcemap', { inline: true })
  .include('styles')
  .import('mixins')
  .define('brand', '#abc')
  .define('url', stylus.url({ paths: ['images'], limit: false }))
  .use((r) => { r.include('lib'); })
  .render();

stylus('.a\n  color red').render((err, out) => { if (!err) console.log(out?.length); });
const deps: string[] = stylus('@import "b"').deps('a.styl');
const v: string = stylus.version;
const out: string = stylus.render('.a\n  b c', { compress: true });
stylus.render('.a\n  b c', (err, out) => {});
const styl: string = stylus.convertCSS('.a { color: red }');
const mw = stylus.middleware({ src: 'public', dest: (p) => 'out' + p, force: true });
mw({ method: 'GET', url: '/a.css' }, {}, () => {});
stylus('.a').define('url', stylus.resolver({ nocheck: true }));

// @ts-expect-error: unknown typed option value
stylus('.a').set('compress', 'yes');
// @ts-expect-error: render() returns a string, not a number
const n: number = stylus('.a').render();
// @ts-expect-error: middleware requires src
stylus.middleware({ dest: 'x' });
