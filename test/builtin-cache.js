
/**
 * Built-in functions must be recognized when the parse cache returns
 * nodes parsed with another `filename`, e.g. when bundlers (Parcel)
 * parse the built-in functions/index.styl while collecting dependencies.
 */

var stylus = require('../')
  , Parser = require('../lib/parser')
  , nodes = require('../lib/nodes')
  , fs = require('fs')
  , join = require('path').join;

var builtin = join(__dirname, '..', 'lib', 'functions', 'index.styl');

function render(str, parseFirst, filename) {
  var style = stylus(str).set('filename', '/x/user.styl');
  nodes.filename = filename;
  new Parser(parseFirst, style.options).parse();
  return style.render().trim();
}

describe('built-in functions and the parse cache', function () {
  var cache;

  beforeEach(function () {
    cache = Parser.cache;
    Parser.cache = null;
  });

  afterEach(function () {
    Parser.cache = cache;
    nodes.filename = null;
  });

  it('keeps CSS math functions parsed with a user filename', function () {
    var css = render('.a\n  w: min(92vw, 50vh)\n  x: max(1px, 2em)\n  y: min(1px, 2px)\n'
      , fs.readFileSync(builtin, 'utf8'), '/x/user.styl');
    css.should.equal('.a {\n  w: min(92vw, 50vh);\n  x: max(1px, 2em);\n  y: 1px;\n}');
  });

  it("doesn't treat user functions parsed with the built-in filename as built-ins", function () {
    var mixin = 'size(w)\n  width: w\n  height: w\n'
      , css = render(mixin + '.a\n  size: 10px\n', mixin + '.a\n  size: 10px\n', builtin);
    css.should.equal('.a {\n  width: 10px;\n  height: 10px;\n}');
  });
});
