
/**
 * Broken input must fail with a ParseError, not with an internal error
 * (TypeError...) nor hang, e.g. while a file is being edited in watch mode.
 */

var stylus = require('../')
  , should = require('chai').should();

var cases = {
  'unclosed string': ['@import "impo', 'unclosed string'],
  'unclosed string in a block': ['.a { b: c; }\n.d { e: "f }', 'unclosed string'],
  'missing right-hand operand': ['.a\n  b: c(1).d <\n', 'missing right-hand operand'],
  'missing right-hand operand of +': ['.a\n  b: 1 +\n', 'missing right-hand operand'],
  'missing left-hand operand of &&': ['body\n  one foo\n  t && bar\n', 'missing left-hand operand'],
  'missing left-hand operand of =': ['a {  = 24px\n', 'missing left-hand operand'],
  'unclosed attribute selector at the end': ['a.button\ninput[typ', '']
};

describe('errors', function () {
  Object.keys(cases).forEach(function (name) {
    var src = cases[name][0]
      , message = cases[name][1];

    it(name, function () {
      var err;
      try {
        stylus(src).render();
      } catch (e) {
        err = e;
      }
      should.exist(err, 'expected an error');
      err.name.should.equal('ParseError');
      err.message.should.contain(message);
    });
  });
});
