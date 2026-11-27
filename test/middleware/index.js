var stylus = require('../../')
  , fs = require('fs');

describe('middleware', function() {
    var res = {};

    it('accepts functions for src and dest options', function(done){
      var req = { method: 'GET', url: 'foo/bar/all.css' };
      stylus.middleware({
        src: function(path) {
          return 'foo/bar' + path;
        },
        dest: function(path) {
          return 'baz/qux' + path;
        }
      })(req, res, done);
    });

    it('compiles a stylus file if it exists', function(done){
      var req = { method: 'GET', url: '/test.css' }
        , path;
      stylus.middleware({
        src: __dirname,
        dest: __dirname
      })(req, res, function() {
        path = __dirname + '/test.css';
        fs.readFileSync(path).toString().should.contain('color: #000');
        fs.unlinkSync(path);
        done();
      });
    });

    it('ignores paths outside of the src and dest directories', function(done){
      var outside = __dirname + '/../middleware-outside'
        , req = { method: 'GET', url: '/../middleware-outside.css' };
      fs.writeFileSync(outside + '.styl', 'body\n  color: #000\n');
      stylus.middleware({
        src: __dirname,
        dest: __dirname
      })(req, res, function(err) {
        try {
          (null == err).should.be.true;
          fs.existsSync(outside + '.css').should.be.false;
        } finally {
          fs.unlinkSync(outside + '.styl');
          if (fs.existsSync(outside + '.css')) fs.unlinkSync(outside + '.css');
        }
        done();
      });
    });

    it('should generate a sourcemap', function(done){
      var req = { method: 'GET', url: '/test.css' }
        , path;
      stylus.middleware({
        sourcemap: { sourceRoot: '/' },
        src: __dirname,
        dest: __dirname
      })(req, res, function() {
        path = __dirname + '/test.css';
        fs.readFileSync(path).toString().should.contain('sourceMappingURL=');
        fs.unlinkSync(path);
        done();
      });
    });
});
