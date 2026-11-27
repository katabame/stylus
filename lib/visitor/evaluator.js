
/*!
 * Stylus - Evaluator
 * Copyright (c) Automattic <developer.wordpress.com>
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

var Visitor = require('./')
  , units = require('../units')
  , nodes = require('../nodes')
  , Stack = require('../stack')
  , Frame = require('../stack/frame')
  , utils = require('../utils')
  , bifs = require('../functions')
  , dirname = require('path').dirname
  , colors = require('../colors')
  , debug = require('debug')('stylus:evaluator')
  , fs = require('fs');

/**
 * Path of the built-in functions defined in Stylus.
 */

var builtinStylPath = normalizePath(require('path').join(__dirname, '..', 'functions', 'index.styl'));

/**
 * CSS functions whose arguments are math expressions.
 */

var cssMathFunctions = [
  'calc', 'calc-size', 'min', 'max', 'clamp', 'round', 'mod', 'rem'
  , 'sin', 'cos', 'tan', 'asin', 'acos', 'atan', 'atan2', 'pow', 'sqrt'
  , 'hypot', 'log', 'exp', 'abs', 'sign'
];

function isCssMathFunction(name) {
  return !!~cssMathFunctions.indexOf(name.replace(/^-(moz|webkit|o|ms)-/, ''));
}

/**
 * Unit groups that can be converted to each other.
 */

var convertibleUnits = {
  mm: 'length', cm: 'length', in: 'length', pt: 'length'
  , ms: 'time', s: 'time'
  , Hz: 'frequency', kHz: 'frequency'
};

/**
 * Check if `left op right` can be computed by Stylus within
 * CSS math functions: operands must be units of compatible types.
 *
 * In media queries `em` and `rem` are the same unit, both relative
 * to the initial font size, so they can be added (`remIsEm`).
 *
 * @param {String} op
 * @param {Node} left
 * @param {Node} right
 * @param {Boolean} remIsEm
 * @return {Boolean}
 * @api private
 */

function isComputableMathOp(op, left, right, remIsEm) {
  if (!~['+', '-', '*', '/'].indexOf(op)) return true;
  left = left.first;
  right = right.first;
  if ('unit' != left.nodeName || 'unit' != right.nodeName) return false;
  var a = left.type
    , b = right.type;
  if (remIsEm && ('em' == a || 'rem' == a) && ('em' == b || 'rem' == b)) return true;
  return !a || !b || a == b
    || (convertibleUnits[a] && convertibleUnits[a] == convertibleUnits[b]);
}

/**
 * Check if `node` is a CSS value usable in `calc()`: a unit,
 * a CSS function such as `var()`, or a generated `calc()`.
 *
 * @param {Node} node
 * @return {Boolean}
 * @api private
 */

function isCalcValue(node) {
  switch (node.nodeName) {
    case 'unit':
    case 'call':
      return true;
    case 'literal':
      return /^calc\(.*\)$/.test(node.val);
  }
  return false;
}

/**
 * Check if `left op right` must be resolved by the browser.
 *
 * @param {String} op
 * @param {Node} left
 * @param {Node} right
 * @return {Boolean}
 * @api private
 */

function needsCalc(op, left, right, remIsEm) {
  if (!~['+', '-', '*', '/'].indexOf(op)) return false;
  var l = left.first
    , r = right.first;
  if (!isCalcValue(l) || !isCalcValue(r)) return false;
  // CSS can't multiply or divide two dimensions either: keep
  // Stylus semantics (`2px * 5em` is `10px`)
  if (('*' == op || '/' == op) && 'unit' == l.nodeName && 'unit' == r.nodeName) return false;
  return !isComputableMathOp(op, l, r, remIsEm);
}

/**
 * Compute the generated `calc()` of `node` (an expression) that can be
 * computed in media queries, where `em` and `rem` are the same unit.
 *
 * @param {Node} node
 * @return {Node}
 * @api private
 */

function mediaCalc(node) {
  if (!node || 'expression' != node.nodeName) return node;
  node.nodes = node.nodes.map(function (child) {
    if ('expression' == child.nodeName) return mediaCalc(child);
    var calc = 'literal' == child.nodeName && child.calcOp;
    if (calc && isComputableMathOp(calc.op, calc.left, calc.right, true)) {
      return calc.left.operate(calc.op, calc.right);
    }
    return child;
  });
  return node;
}

/**
 * Return the CSS of a `calc()` operand, nested `calc()` being
 * turned into parens.
 *
 * @param {Node} node
 * @return {String}
 * @api private
 */

function calcOperand(node) {
  node = node.first;
  if ('literal' == node.nodeName && /^calc\(.*\)$/.test(node.val)) {
    return node.val.slice(4);
  }
  return node.toString();
}

/**
 * Return the CSS of an evaluated expression.
 *
 * @param {Node} node
 * @return {String}
 * @api private
 */

function cssString(node) {
  if ('expression' == node.nodeName) {
    return node.nodes.map(cssString).join(node.isList ? ', ' : ' ');
  }
  return node.toString();
}

/**
 * Normalize `path` for comparison, e.g. on Windows
 * `//?/D:/a/b` and `D:\\a\\b` are the same file.
 *
 * @param {String} path
 * @return {String}
 * @api private
 */

function normalizePath(path) {
  path = path.replace(/\\/g, '/').replace(/^\/\/\?\//, '');
  return 'win32' == process.platform ? path.toLowerCase() : path;
}

/**
 * Import `file` and return Block node.
 *
 * @api private
 */
function importFile(node, file, literal) {
  var importStack = this.importStack
    , Parser = require('../parser')
    , stat;

  // Handling the `require`
  if (node.once) {
    if (this.requireHistory[file]) return nodes.null;
    this.requireHistory[file] = true;

    if (literal && !this.includeCSS) {
      return node;
    }
  }

  // Avoid overflows from importing the same file over again
  if (~importStack.indexOf(file))
    throw new Error('import loop has been found');

  var str = fs.readFileSync(file, 'utf8');

  // shortcut for empty files
  if (!str.trim()) return nodes.null;

  // Expose imports
  node.path = file;
  node.dirname = dirname(file);
  // Store the modified time
  stat = fs.statSync(file);
  node.mtime = stat.mtime;
  this.paths.push(node.dirname);

  if (this.options._imports) this.options._imports.push(node.clone());

  // Parse the file
  importStack.push(file);
  nodes.filename = file;

  if (literal) {
    literal = new nodes.Literal(str.replace(/\r\n?/g, '\n'));
    literal.lineno = literal.column = 1;
    if (!this.resolveURL) return literal;
  }

  // parse
  var block = new nodes.Block
    , parser = new Parser(str, utils.merge({ root: block }, this.options));

  try {
    block = parser.parse();
  } catch (err) {
    var line = parser.lexer.lineno
      , column = parser.lexer.column;

    if (literal && this.includeCSS && this.resolveURL) {
      this.warn('ParseError: ' + file + ':' + line + ':' + column + '. This file included as-is');
      return literal;
    } else {
      err.filename = file;
      err.lineno = line;
      err.column = column;
      err.input = str;
      throw err;
    }
  }

  // Evaluate imported "root"
  block = block.clone(this.currentBlock);
  block.parent = this.currentBlock;
  block.scope = false;
  var ret = this.visit(block);
  importStack.pop();
  if (!this.resolveURL || this.resolveURL.nocheck) this.paths.pop();

  return ret;
}

module.exports = class Evaluator extends Visitor {
  /**
   * Initialize a new `Evaluator` with the given `root` Node
   * and the following `options`.
   *
   * Options:
   *
   *   - `compress`  Compress the css output, defaults to false
   *   - `warn`  Warn the user of duplicate function definitions etc
   *
   * @param {Node} root
   * @api private
   */

  constructor(root, options) {
    super(root);
    options = options || {};
    var functions = this.functions = options.functions || {};
    this.stack = new Stack;
    this.imports = options.imports || [];
    this.globals = options.globals || {};
    this.paths = options.paths || [];
    this.prefix = options.prefix || '';
    this.filename = options.filename;
    this.includeCSS = options['include css'];
    this.resolveURL = functions.url
      && 'resolver' == functions.url.name
      && functions.url.options;
    this.paths.push(dirname(options.filename || '.'));
    this.stack.push(this.global = new Frame(root));
    this.warnings = options.warn;
    this.options = options;
    this.calling = []; // TODO: remove, use stack
    this.importStack = [];
    this.requireHistory = {};
    this.return = 0;
  }

  /**
   * Proxy visit to expose node line numbers.
   *
   * @param {Node} node
   * @return {Node}
   * @api private
   */

  visit(node) {
    try {
      return super.visit(node);
    } catch (err) {
      if (err.filename || !node) throw err;
      err.lineno = node.lineno;
      err.column = node.column;
      err.filename = node.filename;
      err.stylusStack = this.stack.toString();
      try {
        err.input = fs.readFileSync(err.filename, 'utf8');
      } catch (err) {
        // ignore
      }
      throw err;
    }
  };

  /**
   * Perform evaluation setup:
   *
   *   - populate global scope
   *   - iterate imports
   *
   * @api private
   */

  setup() {
    var root = this.root;
    var imports = [];

    this.populateGlobalScope();
    this.imports.forEach(function (file) {
      var expr = new nodes.Expression;
      expr.push(new nodes.String(file));
      imports.push(new nodes.Import(expr));
    }, this);

    root.nodes = imports.concat(root.nodes);
  };

  /**
   * Populate the global scope with:
   *
   *   - css colors
   *   - user-defined globals
   *
   * @api private
   */

  populateGlobalScope() {
    var scope = this.global.scope;

    // colors
    Object.keys(colors).forEach(function (name) {
      var color = colors[name]
        , rgba = new nodes.RGBA(color[0], color[1], color[2], color[3])
        , node = new nodes.Ident(name, rgba);
      rgba.name = name;
      scope.add(node);
    });

    // expose url function
    scope.add(new nodes.Ident(
      'embedurl',
      new nodes.Function('embedurl', require('../functions/url')({
        limit: false
      }))
    ));

    // user-defined globals
    var globals = this.globals;
    Object.keys(globals).forEach(function (name) {
      var val = globals[name];
      if (!val.nodeName) val = new nodes.Literal(val);
      scope.add(new nodes.Ident(name, val));
    });
  };

  /**
   * Evaluate the tree.
   *
   * @return {Node}
   * @api private
   */

  evaluate() {
    debug('eval %s', this.filename);
    this.setup();
    return this.visit(this.root);
  };

  /**
   * Visit Group.
   */

  visitGroup(group) {
    group.nodes = group.nodes.map(function (selector) {
      selector.val = this.interpolate(selector);
      debug('ruleset %s', selector.val);
      return selector;
    }, this);

    group.block = this.visit(group.block);
    return group;
  };

  /**
   * Visit Return.
   */

  visitReturn(ret) {
    ret.expr = this.visit(ret.expr);
    throw ret;
  };

  /**
   * Visit Media.
   */

  visitMedia(media) {
    media.block = this.visit(media.block);
    var inMediaQuery = this.inMediaQuery;
    this.inMediaQuery = true;
    try {
      media.val = this.visit(media.val);
      // `calc(1em + 1rem)` computed before, e.g. in a mixin, is `2em` here
      media.val.nodes.forEach(function (query) {
        query.nodes.forEach(function (feature) {
          if (feature.expr) feature.expr = mediaCalc(feature.expr);
          if (feature.range) feature.range = feature.range.map(function (part) {
            return 'string' == typeof part ? part : mediaCalc(part);
          });
        });
      });
    } finally {
      this.inMediaQuery = inMediaQuery;
    }
    return media;
  };

  /**
   * Visit QueryList.
   */

  visitQueryList(queries) {
    var val, query;
    queries.nodes.forEach(this.visit, this);

    if (1 == queries.nodes.length) {
      query = queries.nodes[0];
      if (val = this.lookup(query.type)) {
        val = val.first.string;
        if (!val) return queries;
        var Parser = require('../parser')
          , parser = new Parser(val, this.options);
        queries = this.visit(parser.queries());
      }
    }
    return queries;
  };

  /**
   * Visit Query.
   */

  visitQuery(node) {
    node.predicate = this.visit(node.predicate);
    node.type = this.visit(node.type);
    node.nodes.forEach(this.visit, this);
    return node;
  };

  /**
   * Visit Feature.
   */

  visitFeature(node) {
    if (node.condition) {
      node.condition = node.condition.map(function (part) {
        return 'string' == typeof part ? part : this.visit(part);
      }, this);
      return node;
    }
    if (node.range) return this.visitRangeFeature(node);
    node.name = this.interpolate(node);
    if (node.expr) {
      this.return++;
      node.expr = this.visit(node.expr);
      this.return--;
    }
    return node;
  };

  /**
   * Visit range Feature, e.g. `(400px <= width < $max)`.
   *
   * The feature name is left as is, while the other
   * operands are evaluated.
   */

  visitRangeFeature(node) {
    var range = node.range
      , self = this
      , nameIndex;

    function isBareIdent(expr) {
      return 1 == expr.nodes.length && 'ident' == expr.first.nodeName;
    }

    function isDefined(expr) {
      return isBareIdent(expr) && !!self.lookup(expr.first.name);
    }

    if (5 == range.length) {
      nameIndex = 2;
    } else if (isBareIdent(range[0]) && !isBareIdent(range[2])) {
      nameIndex = 0;
    } else if (isBareIdent(range[2]) && !isBareIdent(range[0])) {
      nameIndex = 2;
    } else {
      // both sides are idents, the undefined one is the feature name
      nameIndex = isDefined(range[0]) && !isDefined(range[2]) ? 2 : 0;
    }

    node.name = range[nameIndex].first.name;
    node.range = range.map(function (part, i) {
      if ('string' == typeof part || i == nameIndex) return part;
      this.return++;
      part = this.visit(part);
      this.return--;
      return part;
    }, this);
    return node;
  };

  /**
   * Visit Object.
   */

  visitObject(obj) {
    for (var key in obj.vals) {
      obj.vals[key] = this.visit(obj.vals[key]);
    }
    return obj;
  };

  /**
   * Visit Member.
   */

  visitMember(node) {
    var left = node.left
      , right = node.right
      , obj = this.visit(left).first;

    if ('object' != obj.nodeName) {
      throw new Error(left.toString() + ' has no property .' + right);
    }
    if (node.val) {
      this.return++;
      obj.set(right.name, this.visit(node.val));
      this.return--;
    }
    return obj.get(right.name);
  };

  /**
   * Visit Keyframes.
   */

  visitKeyframes(keyframes) {
    var val;
    if (keyframes.fabricated) return keyframes;
    keyframes.val = this.interpolate(keyframes).trim();
    if (val = this.lookup(keyframes.val)) {
      keyframes.val = val.first.string || val.first.name;
    }
    keyframes.block = this.visit(keyframes.block);

    if ('official' != keyframes.prefix) return keyframes;

    // no vendor copies (the default): keep the keyframes in place
    // rather than moving them to the end of the block
    var vendors = this.vendors.filter(function (prefix) { return 'ms' != prefix; });
    if (1 == vendors.length && 'official' == vendors[0]) {
      // a copy, as the node is evaluated again in loops (`for`)
      var node = keyframes.clone();
      node.val = keyframes.val;
      node.block = keyframes.block;
      node.fabricated = true;
      return node;
    }

    this.vendors.forEach(function (prefix) {
      // IE never had prefixes for keyframes
      if ('ms' == prefix) return;
      var node = keyframes.clone();
      node.val = keyframes.val;
      node.prefix = prefix;
      node.block = keyframes.block;
      node.fabricated = true;
      this.currentBlock.push(node);
    }, this);

    return nodes.null;
  };

  /**
   * Visit Function.
   */

  visitFunction(fn) {
    // check local
    var local = this.stack.currentFrame.scope.lookup(fn.name);
    if (local) this.warn('local ' + local.nodeName + ' "' + fn.name + '" previously defined in this scope');

    // user-defined
    var user = this.functions[fn.name];
    if (user) this.warn('user-defined function "' + fn.name + '" is already defined');

    // BIF
    var bif = bifs[fn.name];
    if (bif) this.warn('built-in function "' + fn.name + '" is already defined');

    return fn;
  };

  /**
   * Visit Each.
   */

  visitEach(each) {
    this.return++;
    var expr = utils.unwrap(this.visit(each.expr))
      , len = expr.nodes.length
      , val = new nodes.Ident(each.val)
      , key = new nodes.Ident(each.key || '__index__')
      , scope = this.currentScope
      , block = this.currentBlock
      , vals = []
      , self = this
      , body
      , obj;
    this.return--;

    each.block.scope = false;

    function visitBody(key, val) {
      scope.add(val);
      scope.add(key);
      body = self.visit(each.block.clone());
      vals = vals.concat(body.nodes);
    }

    // for prop in obj
    if (1 == len && 'object' == expr.nodes[0].nodeName) {
      obj = expr.nodes[0];
      for (var prop in obj.vals) {
        val.val = new nodes.String(prop);
        key.val = obj.get(prop);
        visitBody(key, val);
      }
    } else {
      for (var i = 0; i < len; ++i) {
        val.val = expr.nodes[i];
        key.val = new nodes.Unit(i);
        visitBody(key, val);
      }
    }

    this.mixin(vals, block);
    return vals[vals.length - 1] || nodes.null;
  };

  /**
   * Visit Call.
   */

  visitCall(call) {
    // arithmetic is only kept literal within the arguments of
    // CSS math functions, not in nested calls or function bodies
    var cssMath = this.cssMath;
    this.cssMath = false;
    try {
      return this.visitCallNode(call);
    } finally {
      this.cssMath = cssMath;
    }
  };

  /**
   * Visit Call, see `visitCall()`.
   *
   * @api private
   */

  visitCallNode(call) {
    debug('call %s', call);
    var fn = this.lookup(call.name)
      , literal
      , ret;

    // url()
    this.ignoreColors = 'url' == call.name;

    // Variable function
    if (fn && 'expression' == fn.nodeName) {
      fn = fn.nodes[0];
    }

    // Not a function? try user-defined or built-ins
    if (fn && 'function' != fn.nodeName) {
      fn = this.lookupFunction(call.name);
    }

    // Undefined function? render literal CSS
    if (!fn || fn.nodeName != 'function') {
      debug('%s is undefined', call);
      // Special case for `calc`
      if ('calc' == this.unvendorize(call.name)) {
        literal = call.args.nodes && call.args.nodes[0];
        // `calc(a + b)` may be parsed as nested expressions: `((a + b))`
        while (literal && 'expression' == literal.nodeName
          && 1 == literal.nodes.length
          && 'expression' == literal.nodes[0].nodeName) {
          literal = literal.nodes[0];
        }
        if (literal) ret = new nodes.Literal(call.name + literal);
      } else {
        ret = this.literalCall(call);
      }
      this.ignoreColors = false;
      return ret;
    }

    this.calling.push(call.name);

    // Massive stack
    if (this.calling.length > 200) {
      throw new RangeError('Maximum stylus call stack size exceeded');
    }

    // First node in expression
    if ('expression' == fn.nodeName) fn = fn.first;

    // Evaluate arguments
    this.return++;
    this.cssMath = isCssMathFunction(call.name);
    var args = this.visit(call.args);

    for (var key in args.map) {
      args.map[key] = this.visit(args.map[key].clone());
    }
    this.cssMath = false;
    this.return--;

    // CSS functions shadowed by built-ins whose arguments can only
    // be resolved by the browser (var(), mixed units, keywords...):
    // render literal CSS
    if ((fn.fn && ~['rgb', 'rgba', 'hsl', 'hsla'].indexOf(call.name)
      && !utils.isComputableColorArgs(args))
      || (this.isBuiltinFunction(fn) && !utils.isComputableMathArgs(call.name, args))) {
      this.calling.pop();
      this.ignoreColors = false;
      call.args = args;
      return call;
    }

    // Built-in
    if (fn.fn) {
      debug('%s is built-in', call);
      ret = this.invokeBuiltin(fn.fn, args);
      // User-defined
    } else if ('function' == fn.nodeName) {
      debug('%s is user-defined', call);
      // Evaluate mixin block
      if (call.block) call.block = this.visit(call.block);
      ret = this.invokeFunction(fn, args, call.block);
    }

    this.calling.pop();
    this.ignoreColors = false;
    return ret;
  };

  /**
   * Check if `fn` is a built-in function, either
   * a js function or defined by functions/index.styl.
   *
   * @param {Function} fn
   * @return {Boolean}
   * @api private
   */

  isBuiltinFunction(fn) {
    return !!fn.fn
      || (!!fn.filename && builtinStylPath == normalizePath(fn.filename));
  };

  /**
   * Visit Literal.
   */

  visitLiteral(lit) {
    if (lit.cssIf) return this.visitCssIf(lit);
    return lit;
  };

  /**
   * Evaluate the branch values of a CSS `if()`, and interpolate
   * `{expr}` in its conditions: `if(media(width > {bp}): $a; else: $b)`.
   *
   * @param {Literal} lit
   * @return {Literal}
   * @api private
   */

  visitCssIf(lit) {
    var Parser = require('../parser')
      , self = this;

    function evaluate(str) {
      var parser = new Parser(str, self.options)
        , expr;
      try {
        parser.inProperty = true;
        parser.state.push('expression');
        expr = parser.list();
      } catch (err) {
        return str;
      }
      if (!expr || expr.isEmpty) return str;
      self.return++;
      expr = self.visit(expr);
      self.return--;
      return cssString(expr);
    }

    var branches = lit.cssIf.map(function (branch) {
      var cond = branch.cond.replace(/\{([^{}]+)\}/g, function (_, code) {
        return evaluate(code);
      });
      return cond + ': ' + (branch.value ? evaluate(branch.value) : '');
    });
    var ret = new nodes.Literal('if(' + branches.join('; ') + ')');
    ret.lineno = lit.lineno;
    ret.column = lit.column;
    ret.filename = lit.filename;
    return ret;
  };

  /**
   * Visit Ident.
   */

  visitIdent(ident) {
    var prop;
    // Property lookup
    if (ident.property) {
      if (prop = this.lookupProperty(ident.name)) {
        return this.visit(prop.expr.clone());
      }
      return nodes.null;
      // Lookup
    } else if (ident.val.isNull) {
      var val = this.lookup(ident.name);
      // Object or Block mixin
      if (val && ident.mixin) this.mixinNode(val);
      return val ? this.visit(val) : ident;
      // Assign
    } else {
      this.return++;
      ident.val = this.visit(ident.val);
      this.return--;
      this.currentScope.add(ident);
      return ident.val;
    }
  };

  /**
   * Visit BinOp.
   */

  visitBinOp(binop) {
    // Special-case "is defined" pseudo binop
    if ('is defined' == binop.op) return this.isDefined(binop.left);

    this.return++;
    // Visit operands
    var op = binop.op
      , left = this.visit(binop.left)
      , right = ('||' == op || '&&' == op)
        ? binop.right : this.visit(binop.right);

    // HACK: ternary
    var val = binop.val
      ? this.visit(binop.val)
      : null;
    this.return--;

    // CSS math function arguments the browser has to resolve,
    // e.g. `clamp(1rem, 1vw + 1rem, 2rem)`
    if (this.cssMath && !isComputableMathOp(op, left, right, this.inMediaQuery)) {
      return new nodes.Literal(left.toString() + ' ' + op + ' ' + right.toString());
    }

    // elsewhere, the browser resolves it with `calc()`,
    // e.g. `100% - 10px`, `var(--gap) * 2`
    if (!this.cssMath && needsCalc(op, left, right, this.inMediaQuery)) {
      var calc = new nodes.Literal('calc(' + calcOperand(left) + ' ' + op + ' ' + calcOperand(right) + ')');
      // kept to compute it again where possible, e.g. `em + rem` in media queries
      calc.calcOp = { op: op, left: left.first, right: right.first };
      return calc;
    }

    // Operate
    try {
      return this.visit(left.operate(op, right, val));
    } catch (err) {
      // disregard coercion issues in equality
      // checks, and simply return false
      if ('CoercionError' == err.name) {
        switch (op) {
          case '==':
            return nodes.false;
          case '!=':
            return nodes.true;
        }
      }
      throw err;
    }
  };

  /**
   * Visit UnaryOp.
   */

  visitUnaryOp(unary) {
    var op = unary.op
      , node = this.visit(unary.expr);

    if ('!' != op) {
      node = node.first.clone();
      // negated CSS values, e.g. `-(100% - 10px)`, `-var(--x)`
      if ('-' == op && 'unit' != node.nodeName && isCalcValue(node)) {
        return new nodes.Literal('calc(-1 * ' + calcOperand(node) + ')');
      }
      utils.assertType(node, 'unit');
    }

    switch (op) {
      case '-':
        node.val = -node.val;
        break;
      case '+':
        node.val = +node.val;
        break;
      case '~':
        node.val = ~node.val;
        break;
      case '!':
        return node.toBoolean().negate();
    }

    return node;
  };

  /**
   * Visit TernaryOp.
   */

  visitTernary(ternary) {
    var ok = this.visit(ternary.cond).toBoolean();
    return ok.isTrue
      ? this.visit(ternary.trueExpr)
      : this.visit(ternary.falseExpr);
  };

  /**
   * Visit Expression.
   */

  visitExpression(expr) {
    for (var i = 0, len = expr.nodes.length; i < len; ++i) {
      expr.nodes[i] = this.visit(expr.nodes[i]);
    }

    // support (n * 5)px etc
    if (this.castable(expr)) expr = this.cast(expr);

    return expr;
  };

  /**
   * Visit Arguments.
   */

  get visitArguments() {
    return this.visitExpression;
  }

  /**
   * Visit Property.
   */

  visitProperty(prop) {
    var name = this.interpolate(prop)
      , fn = this.lookup(name)
      // transparent mixins are user-defined, built-ins like `round()`
      // must not hijack properties of the same name
      , call = fn && 'function' == fn.first.nodeName
        && !this.isBuiltinFunction(fn.first)
      , literal = ~this.calling.indexOf(name)
      , _prop = this.property;

    // Function of the same name
    if (call && !literal && !prop.literal) {
      var args = nodes.Arguments.fromExpression(utils.unwrap(prop.expr.clone()));
      prop.name = name;
      this.property = prop;
      this.return++;
      this.property.expr = this.visit(prop.expr);
      this.return--;
      var ret = this.visit(new nodes.Call(name, args));
      this.property = _prop;
      return ret;
      // Regular property
    } else {
      this.return++;
      prop.name = name;
      prop.literal = true;
      this.property = prop;
      prop.expr = this.visit(prop.expr);
      this.property = _prop;
      this.return--;
      return prop;
    }
  };

  /**
   * Visit Root.
   */

  visitRoot(block) {
    // normalize cached imports
    if (block != this.root) {
      block.constructor = nodes.Block;
      return this.visit(block);
    }

    for (var i = 0; i < block.nodes.length; ++i) {
      block.index = i;
      block.nodes[i] = this.visit(block.nodes[i]);
    }
    return block;
  };

  /**
   * Visit Block.
   */

  visitBlock(block) {
    this.stack.push(new Frame(block));
    for (block.index = 0; block.index < block.nodes.length; ++block.index) {
      try {
        block.nodes[block.index] = this.visit(block.nodes[block.index]);
      } catch (err) {
        if ('return' == err.nodeName) {
          if (this.return) {
            this.stack.pop();
            throw err;
          } else {
            block.nodes[block.index] = err;
            break;
          }
        } else {
          throw err;
        }
      }
    }
    this.stack.pop();
    return block;
  };

  /**
   * Visit Atblock.
   */

  visitAtblock(atblock) {
    atblock.block = this.visit(atblock.block);
    return atblock;
  };

  /**
   * Visit Atrule.
   */

  visitAtrule(atrule) {
    atrule.val = this.interpolate(atrule);
    if (atrule.block) atrule.block = this.visit(atrule.block);
    return atrule;
  };

  /**
   * Visit Supports.
   */

  visitSupports(node) {
    var condition = node.condition
      , val;

    this.return++;
    node.condition = this.visit(condition);
    this.return--;

    val = condition.first;
    if (1 == condition.nodes.length
      && 'string' == val.nodeName) {
      node.condition = val.string;
    }
    node.block = this.visit(node.block);
    return node;
  };

  /**
   * Visit If.
   */

  visitIf(node) {
    var ret
      , block = this.currentBlock
      , negate = node.negate;

    this.return++;
    var ok = this.visit(node.cond).first.toBoolean();
    this.return--;

    node.block.scope = node.block.hasMedia;

    // Evaluate body
    if (negate) {
      // unless
      if (ok.isFalse) {
        ret = this.visit(node.block);
      }
    } else {
      // if
      if (ok.isTrue) {
        ret = this.visit(node.block);
        // else
      } else if (node.elses.length) {
        var elses = node.elses
          , len = elses.length
          , cond;
        for (var i = 0; i < len; ++i) {
          // else if
          if (elses[i].cond) {
            elses[i].block.scope = elses[i].block.hasMedia;
            this.return++;
            cond = this.visit(elses[i].cond).first.toBoolean();
            this.return--;
            if (cond.isTrue) {
              ret = this.visit(elses[i].block);
              break;
            }
            // else
          } else {
            elses[i].scope = elses[i].hasMedia;
            ret = this.visit(elses[i]);
          }
        }
      }
    }

    // mixin conditional statements within
    // a selector group or at-rule
    if (ret && !node.postfix && block.node
      && ~['group'
        , 'atrule'
        , 'media'
        , 'supports'
        , 'keyframes'].indexOf(block.node.nodeName)) {
      this.mixin(ret.nodes, block);
      return nodes.null;
    }

    return ret || nodes.null;
  };

  /**
   * Visit Extend.
   */

  visitExtend(extend) {
    var block = this.currentBlock;
    if ('group' != block.node.nodeName) block = this.closestGroup;
    extend.selectors.forEach(function (selector) {
      block.node.extends.push({
        // Cloning the selector for when we are in a loop and don't want it to affect
        // the selector nodes and cause the values to be different to expected
        selector: this.interpolate(selector.clone()).trim(),
        optional: selector.optional,
        lineno: selector.lineno,
        column: selector.column
      });
    }, this);
    return nodes.null;
  };

  /**
   * Visit Import.
   */

  visitImport(imported) {
    this.return++;

    var path = this.visit(imported.path).first
      , nodeName = imported.once ? 'require' : 'import'
      , found
      , literal;

    this.return--;
    debug('import %s', path);

    // url() passed
    if ('url' == path.name) {
      if (imported.once) throw new Error('You cannot @require a url');

      return imported;
    }

    // Ensure string
    if (!path.string) throw new Error('@' + nodeName + ' string expected');

    var name = path = path.string;

    // Absolute URL or hash
    if (/(?:url\s*\(\s*)?['"]?(?:#|(?:https?:)?\/\/)/i.test(path)) {
      if (imported.once) throw new Error('You cannot @require a url');
      return imported;
    }

    // Literal
    if (/\.css(?:"|$)/.test(path)) {
      literal = true;
      // CSS import conditions (layer, supports, media) can't be inlined
      var conditions = imported.path.nodes && imported.path.nodes.length > 1;
      if (!imported.once && (!this.includeCSS || conditions)) {
        return imported;
      }
    }

    // support optional .styl
    if (!literal && !/\.styl$/i.test(path)) path += '.styl';

    // Lookup
    found = utils.find(path, this.paths, this.filename);
    if (!found) {
      found = utils.lookupIndex(name, this.paths, this.filename);
    }

    // Throw if import failed
    if (!found) throw new Error('failed to locate @' + nodeName + ' file ' + path);

    var block = new nodes.Block;

    for (var i = 0, len = found.length; i < len; ++i) {
      block.push(importFile.call(this, imported, found[i], literal));
    }

    return block;
  };

  /**
   * Invoke `fn` with `args`.
   *
   * @param {Function} fn
   * @param {Array} args
   * @return {Node}
   * @api private
   */

  invokeFunction(fn, args, content) {
    var block = new nodes.Block(fn.block.parent);

    // Clone the function body
    // to prevent mutation of subsequent calls
    var body = fn.block.clone(block);

    // mixin block
    var mixinBlock = this.stack.currentFrame.block;

    // new block scope
    this.stack.push(new Frame(block));
    var scope = this.currentScope;

    // normalize arguments
    if ('arguments' != args.nodeName) {
      var expr = new nodes.Expression;
      expr.push(args);
      args = nodes.Arguments.fromExpression(expr);
    }

    // arguments local
    scope.add(new nodes.Ident('arguments', args));

    // mixin scope introspection
    scope.add(new nodes.Ident('mixin', this.return
      ? nodes.false
      : new nodes.String(mixinBlock.nodeName)));

    // current property
    if (this.property) {
      var prop = this.propertyExpression(this.property, fn.name);
      scope.add(new nodes.Ident('current-property', prop));
    } else {
      scope.add(new nodes.Ident('current-property', nodes.null));
    }

    // current call stack
    var expr = new nodes.Expression;
    for (var i = this.calling.length - 1; i--;) {
      expr.push(new nodes.Literal(this.calling[i]));
    };
    scope.add(new nodes.Ident('called-from', expr));

    // inject arguments as locals
    var i = 0
      , len = args.nodes.length;
    fn.params.nodes.forEach(function (node) {
      // rest param support
      if (node.rest) {
        node.val = new nodes.Expression;
        for (; i < len; ++i) node.val.push(args.nodes[i]);
        node.val.preserve = true;
        node.val.isList = args.isList;
        // argument default support
      } else {
        var arg = args.map[node.name] || args.nodes[i++];
        node = node.clone();
        if (arg) {
          arg.isEmpty ? args.nodes[i - 1] = this.visit(node) : node.val = arg;
        } else {
          args.push(node.val);
        }

        // required argument not satisfied
        if (node.val.isNull) {
          throw new Error('argument "' + node + '" required for ' + fn);
        }
      }

      scope.add(node);
    }, this);

    // mixin block
    if (content) scope.add(new nodes.Ident('block', content, true));

    // invoke
    return this.invoke(body, true, fn.filename);
  };

  /**
   * Invoke built-in `fn` with `args`.
   *
   * @param {Function} fn
   * @param {Array} args
   * @return {Node}
   * @api private
   */

  invokeBuiltin(fn, args) {
    // Map arguments to first node
    // providing a nicer js api for
    // BIFs. Functions may specify that
    // they wish to accept full expressions
    // via .raw
    if (fn.raw) {
      args = args.nodes;
    } else {
      if (!fn.params) {
        fn.params = utils.params(fn);
      }
      args = fn.params.reduce(function (ret, param) {
        var arg = args.map[param] || args.nodes.shift()
        if (arg) {
          arg = utils.unwrap(arg);
          var len = arg.nodes.length;
          if (len > 1) {
            for (var i = 0; i < len; ++i) {
              ret.push(utils.unwrap(arg.nodes[i].first));
            }
          } else {
            ret.push(arg.first);
          }
        }
        return ret;
      }, []);
    }

    // Invoke the BIF
    var body = utils.coerce(fn.apply(this, args));

    // Always wrapping allows js functions
    // to return several values with a single
    // Expression node
    var expr = new nodes.Expression;
    expr.push(body);
    body = expr;

    // Invoke
    return this.invoke(body);
  };

  /**
   * Invoke the given function `body`.
   *
   * @param {Block} body
   * @return {Node}
   * @api private
   */

  invoke(body, stack, filename) {
    var self = this
      , ret;

    if (filename) this.paths.push(dirname(filename));

    // Return
    if (this.return) {
      ret = this.eval(body.nodes);
      if (stack) this.stack.pop();
      // Mixin
    } else {
      body = this.visit(body);
      if (stack) this.stack.pop();
      this.mixin(body.nodes, this.currentBlock);
      ret = nodes.null;
    }

    if (filename) this.paths.pop();

    return ret;
  };

  /**
   * Mixin the given `nodes` to the given `block`.
   *
   * @param {Array} nodes
   * @param {Block} block
   * @api private
   */

  mixin(nodes, block) {
    if (!nodes.length) return;
    var len = block.nodes.length
      , head = block.nodes.slice(0, block.index)
      , tail = block.nodes.slice(block.index + 1, len);
    this._mixin(nodes, head, block);
    block.index = 0;
    block.nodes = head.concat(tail);
  };

  /**
   * Mixin the given `items` to the `dest` array.
   *
   * @param {Array} items
   * @param {Array} dest
   * @param {Block} block
   * @api private
   */

  _mixin(items, dest, block) {
    var node
      , len = items.length;
    for (var i = 0; i < len; ++i) {
      switch ((node = items[i]).nodeName) {
        case 'return':
          return;
        case 'block':
          this._mixin(node.nodes, dest, block);
          break;
        case 'media':
          // fix link to the parent block
          var parentNode = node.block.parent.node;
          if (parentNode && 'call' != parentNode.nodeName) {
            node.block.parent = block;
          }
        case 'property':
          var val = node.expr;
          // prevent `block` mixin recursion
          if (node.literal && 'block' == val.first.name) {
            val = utils.unwrap(val);
            val.nodes[0] = new nodes.Literal('block');
          }
        default:
          dest.push(node);
      }
    }
  };

  /**
   * Mixin the given `node` to the current block.
   *
   * @param {Node} node
   * @api private
   */

  mixinNode(node) {
    node = this.visit(node.first);
    switch (node.nodeName) {
      case 'object':
        this.mixinObject(node);
        return nodes.null;
      case 'block':
      case 'atblock':
        this.mixin(node.nodes, this.currentBlock);
        return nodes.null;
    }
  };

  /**
   * Mixin the given `object` to the current block.
   *
   * @param {Object} object
   * @api private
   */

  mixinObject(object) {
    var Parser = require('../parser')
      , root = this.root
      , str = '$block ' + object.toBlock()
      , parser = new Parser(str, utils.merge({ root: block }, this.options))
      , block;

    try {
      block = parser.parse();
    } catch (err) {
      err.filename = this.filename;
      err.lineno = parser.lexer.lineno;
      err.column = parser.lexer.column;
      err.input = str;
      throw err;
    }

    block.parent = root;
    block.scope = false;
    var ret = this.visit(block)
      , vals = ret.first.nodes;
    for (var i = 0, len = vals.length; i < len; ++i) {
      if (vals[i].block) {
        this.mixin(vals[i].block.nodes, this.currentBlock);
        break;
      }
    }
  };

  /**
   * Evaluate the given `vals`.
   *
   * @param {Array} vals
   * @return {Node}
   * @api private
   */

  eval(vals) {
    if (!vals) return nodes.null;
    var len = vals.length
      , node = nodes.null;

    try {
      for (var i = 0; i < len; ++i) {
        node = vals[i];
        switch (node.nodeName) {
          case 'if':
            if ('block' != node.block.nodeName) {
              node = this.visit(node);
              break;
            }
          case 'each':
          case 'block':
            node = this.visit(node);
            if (node.nodes) node = this.eval(node.nodes);
            break;
          default:
            node = this.visit(node);
        }
      }
    } catch (err) {
      if ('return' == err.nodeName) {
        return err.expr;
      } else {
        throw err;
      }
    }

    return node;
  };

  /**
   * Literal function `call`.
   *
   * @param {Call} call
   * @return {call}
   * @api private
   */

  literalCall(call) {
    this.cssMath = isCssMathFunction(call.name);
    call.args = this.visit(call.args);
    this.cssMath = false;
    return call;
  };

  /**
   * Lookup property `name`.
   *
   * @param {String} name
   * @return {Property}
   * @api private
   */

  lookupProperty(name) {
    var i = this.stack.length
      , index = this.currentBlock.index
      , top = i
      , nodes
      , block
      , len
      , other;

    while (i--) {
      block = this.stack[i].block;
      if (!block.node) continue;
      switch (block.node.nodeName) {
        case 'group':
        case 'function':
        case 'if':
        case 'each':
        case 'atrule':
        case 'media':
        case 'atblock':
        case 'call':
          nodes = block.nodes;
          // scan siblings from the property index up
          if (i + 1 == top) {
            while (index--) {
              // ignore current property
              if (this.property == nodes[index]) continue;
              other = this.interpolate(nodes[index]);
              if (name == other) return nodes[index].clone();
            }
            // sequential lookup for non-siblings (for now)
          } else {
            len = nodes.length;
            while (len--) {
              if ('property' != nodes[len].nodeName
                || this.property == nodes[len]) continue;
              other = this.interpolate(nodes[len]);
              if (name == other) return nodes[len].clone();
            }
          }
          break;
      }
    }

    return nodes.null;
  };

  /**
   * Return the closest mixin-able `Block`.
   *
   * @return {Block}
   * @api private
   */

  get closestBlock() {
    var i = this.stack.length
      , block;
    while (i--) {
      block = this.stack[i].block;
      if (block.node) {
        switch (block.node.nodeName) {
          case 'group':
          case 'keyframes':
          case 'atrule':
          case 'atblock':
          case 'media':
          case 'call':
            return block;
        }
      }
    }
  };

  /**
   * Return the closest group block.
   *
   * @return {Block}
   * @api private
   */

  get closestGroup() {
    var i = this.stack.length
      , block;
    while (i--) {
      block = this.stack[i].block;
      if (block.node && 'group' == block.node.nodeName) {
        return block;
      }
    }
  };

  /**
   * Return the current selectors stack.
   *
   * @return {Array}
   * @api private
   */

  get selectorStack() {
    var block
      , stack = [];
    for (var i = 0, len = this.stack.length; i < len; ++i) {
      block = this.stack[i].block;
      if (block.node && 'group' == block.node.nodeName) {
        block.node.nodes.forEach(function (selector) {
          if (!selector.val) selector.val = this.interpolate(selector);
        }, this);
        stack.push(block.node.nodes);
      }
    }
    return stack;
  };

  /**
   * Lookup `name`, with support for JavaScript
   * functions, and BIFs.
   *
   * @param {String} name
   * @return {Node}
   * @api private
   */

  lookup(name) {
    var val;
    if (this.ignoreColors && name in colors) return;
    if (val = this.stack.lookup(name)) {
      return utils.unwrap(val);
    } else {
      return this.lookupFunction(name);
    }
  };

  /**
   * Map segments in `node` returning a string.
   *
   * @param {Node} node
   * @return {String}
   * @api private
   */

  interpolate(node) {
    var self = this
      , isSelector = ('selector' == node.nodeName);
    function toString(node) {
      switch (node.nodeName) {
        case 'function':
        case 'ident':
          return node.name;
        case 'literal':
        case 'string':
          if (self.prefix && !node.prefixed && !node.val.nodeName) {
            node.val = node.val.replace(/\.(?=[\w-])|^\.$/g, '.' + self.prefix);
            node.prefixed = true;
          }
          return node.val;
        case 'unit':
          // Interpolation inside keyframes
          return '%' == node.type ? node.val + '%' : node.val;
        case 'member':
          return toString(self.visit(node));
        case 'expression':
          // Prevent cyclic `selector()` calls.
          if (self.calling && ~self.calling.indexOf('selector') && self._selector) return self._selector;
          self.return++;
          var ret = toString(self.visit(node).first);
          self.return--;
          if (isSelector) self._selector = ret;
          return ret;
      }
    }

    if (node.segments) {
      return node.segments.map(toString).join('');
    } else {
      return toString(node);
    }
  };

  /**
   * Lookup JavaScript user-defined or built-in function.
   *
   * @param {String} name
   * @return {Function}
   * @api private
   */

  lookupFunction(name) {
    var fn = this.functions[name] || bifs[name];
    if (fn) return new nodes.Function(name, fn);
  };

  /**
   * Check if the given `node` is an ident, and if it is defined.
   *
   * @param {Node} node
   * @return {Boolean}
   * @api private
   */

  isDefined(node) {
    if ('ident' == node.nodeName) {
      return new nodes.Boolean(this.lookup(node.name));
    } else {
      throw new Error('invalid "is defined" check on non-variable ' + node);
    }
  };

  /**
   * Return `Expression` based on the given `prop`,
   * replacing cyclic calls to the given function `name`
   * with "__CALL__".
   *
   * @param {Property} prop
   * @param {String} name
   * @return {Expression}
   * @api private
   */

  propertyExpression(prop, name) {
    var expr = new nodes.Expression
      , val = prop.expr.clone();

    // name
    expr.push(new nodes.String(prop.name));

    // replace cyclic call with __CALL__
    function replace(node) {
      if ('call' == node.nodeName && name == node.name) {
        return new nodes.Literal('__CALL__');
      }

      if (node.nodes) node.nodes = node.nodes.map(replace);
      return node;
    }

    replace(val);
    expr.push(val);
    return expr;
  };

  /**
   * Cast `expr` to the trailing ident.
   *
   * @param {Expression} expr
   * @return {Unit}
   * @api private
   */

  cast(expr) {
    return new nodes.Unit(expr.first.val, expr.nodes[1].name);
  };

  /**
   * Check if `expr` is castable.
   *
   * @param {Expression} expr
   * @return {Boolean}
   * @api private
   */

  castable(expr) {
    return 2 == expr.nodes.length
      && 'unit' == expr.first.nodeName
      && ~units.indexOf(expr.nodes[1].name);
  };

  /**
   * Warn with the given `msg`.
   *
   * @param {String} msg
   * @api private
   */

  warn(msg) {
    if (!this.warnings) return;
    console.warn('\u001b[33mWarning:\u001b[0m ' + msg);
  };

  /**
   * Return the current `Block`.
   *
   * @return {Block}
   * @api private
   */

  get currentBlock() {
    return this.stack.currentFrame.block;
  };

  /**
   * Return an array of vendor names.
   *
   * @return {Array}
   * @api private
   */

  get vendors() {
    return this.lookup('vendors').nodes.map(function (node) {
      return node.string;
    });
  };

  /**
   * Return the property name without vendor prefix.
   *
   * @param {String} prop
   * @return {String}
   * @api public
   */

  unvendorize(prop) {
    // known prefixes, regardless of the generated `vendors`
    return prop.replace(/^-(moz|webkit|o|ms)-/, '');
  };

  /**
   * Return the current frame `Scope`.
   *
   * @return {Scope}
   * @api private
   */

  get currentScope() {
    return this.stack.currentFrame.scope;
  };

  /**
   * Return the current `Frame`.
   *
   * @return {Frame}
   * @api private
   */

  get currentFrame() {
    return this.stack.currentFrame;
  };
};
