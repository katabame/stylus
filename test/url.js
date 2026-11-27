
/**
 * `utils.parseURL()` replaces the deprecated `url.parse()` (DEP0169) for
 * the fields Stylus uses, the expected values being those of `url.parse()`.
 */

var parseURL = require('../lib/utils').parseURL
  , should = require('chai').should();

var relative = {
  'a.css': ['a.css', null, null, 'a.css'],
  'fonts/a.eot?#iefix': ['fonts/a.eot', '?', '#iefix', 'fonts/a.eot?#iefix'],
  'circle.svg#some-id': ['circle.svg', null, '#some-id', 'circle.svg#some-id'],
  'img.png?v=1': ['img.png', '?v=1', null, 'img.png?v=1'],
  'a.png?x#y?z': ['a.png', '?x', '#y?z', 'a.png?x#y?z'],
  '/images/foo.png': ['/images/foo.png', null, null, '/images/foo.png'],
  '//foo.com/foo.css': ['//foo.com/foo.css', null, null, '//foo.com/foo.css'],
  '../a.png': ['../a.png', null, null, '../a.png'],
  'a b.png': ['a%20b.png', null, null, 'a%20b.png'],
  'a"b\'c.png': ['a%22b%27c.png', null, null, 'a%22b%27c.png'],
  'a\tb.png': ['a%09b.png', null, null, 'a%09b.png'],
  'dir\\a.png': ['dir/a.png', null, null, 'dir/a.png'],
  '#': [null, null, '#', '#']
};

var absolute = {
  'http://example.net/bar.png': ['http:', 'http://example.net/bar.png'],
  'HTTP://Example.COM': ['http:', 'http://example.com/'],
  'https://foo.com/a b.png': ['https:', 'https://foo.com/a%20b.png'],
  'data:image/png;base64,iVBORw0KGgo=': ['data:', 'data:image/png;base64,iVBORw0KGgo='],
  'data:image/svg+xml;utf8,<svg></svg>': ['data:', 'data:image/svg+xml;utf8,%3Csvg%3E%3C/svg%3E'],
  'mailto:a@b.c': ['mailto:', 'mailto:a@b.c']
};

describe('utils.parseURL()', function () {
  Object.keys(relative).forEach(function (str) {
    it('parses the relative URL ' + JSON.stringify(str), function () {
      var url = parseURL(str)
        , expected = relative[str];
      should.equal(url.protocol, null);
      should.equal(url.pathname, expected[0]);
      should.equal(url.search, expected[1]);
      should.equal(url.hash, expected[2]);
      url.href.should.equal(expected[3]);
    });
  });

  Object.keys(absolute).forEach(function (str) {
    it('parses the absolute URL ' + JSON.stringify(str), function () {
      var url = parseURL(str);
      url.protocol.should.equal(absolute[str][0]);
      url.href.should.equal(absolute[str][1]);
    });
  });
});
