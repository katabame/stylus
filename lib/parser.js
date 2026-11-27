/*!
 * Stylus - Parser
 * Copyright (c) Automattic <developer.wordpress.com>
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

var Lexer = require('./lexer')
  , nodes = require('./nodes')
  , Token = require('./token')
  , units = require('./units')
  , errors = require('./errors')
  , cache = require('./cache');

// debuggers

var debug = {
  lexer: require('debug')('stylus:lexer')
  , selector: require('debug')('stylus:parser:selector')
};

/**
 * Media/container query range comparison operators.
 */

var rangeOperators = ['<', '>', '<=', '>=', '='];

/**
 * CSS color spaces, for color interpolation (`in oklab`).
 */

var colorSpaces = [
  'srgb', 'srgb-linear', 'display-p3', 'a98-rgb', 'prophoto-rgb', 'rec2020'
  , 'lab', 'oklab', 'xyz', 'xyz-d50', 'xyz-d65'
  , 'hsl', 'hwb', 'lch', 'oklch'
];

/**
 * CSS color functions supporting the `/ <alpha>` syntax.
 */

var colorFunctions = [
  'rgb'
  , 'rgba'
  , 'hsl'
  , 'hsla'
  , 'hwb'
  , 'lab'
  , 'lch'
  , 'oklab'
  , 'oklch'
  , 'color'
];

/**
 * Check if the given selector parts have unclosed parens.
 *
 * @param {Array} arr
 * @return {Boolean}
 * @api private
 */

function unclosedParens(arr) {
  var depth = 0;
  arr.forEach(function (node) {
    if ('literal' != node.nodeName) return;
    var str = node.val;
    for (var i = 0, len = str.length; i < len; ++i) {
      if ('(' == str[i]) ++depth;
      else if (')' == str[i]) --depth;
    }
  });
  return depth > 0;
}

/**
 * Selector composite tokens.
 */

var selectorTokens = [
  'ident'
  , 'string'
  , 'selector'
  , 'function'
  , 'comment'
  , 'boolean'
  , 'space'
  , 'color'
  , 'unit'
  , 'for'
  , 'in'
  , '['
  , ']'
  , '('
  , ')'
  , '+'
  , '-'
  , '*'
  , '*='
  , '<'
  , '>'
  , '<='
  , '>='
  , '='
  , ':'
  , '&'
  , '&&'
  , '~'
  , '{'
  , '}'
  , '.'
  , '..'
  , '/'
];

/**
 * CSS pseudo-classes and pseudo-elements.
 * See http://dev.w3.org/csswg/selectors4/
 */

var pseudoSelectors = [
  // https://www.w3.org/TR/selectors-4/#logical-combination
  // Logical Combinations
  'is'
  , 'has'
  , 'where'
  , 'not'

  // Linguistic Pseudo-classes
  , 'dir'
  , 'lang'

  // Location Pseudo-classes
  , 'any-link'
  , 'link'
  , 'visited'
  , 'local-link'
  , 'target'
  , 'scope'

  // User Action Pseudo-classes
  , 'hover'
  , 'active'
  , 'focus'
  , 'drop'

  // Time-dimensional Pseudo-classes
  , 'current'
  , 'past'
  , 'future'

  // The Input Pseudo-classes
  , 'enabled'
  , 'disabled'
  , 'read-only'
  , 'read-write'
  , 'placeholder-shown'
  , 'checked'
  , 'indeterminate'
  , 'valid'
  , 'invalid'
  , 'in-range'
  , 'out-of-range'
  , 'required'
  , 'optional'
  , 'user-error'

  // Tree-Structural pseudo-classes
  , 'root'
  , 'empty'
  , 'blank'
  , 'nth-child'
  , 'nth-last-child'
  , 'first-child'
  , 'last-child'
  , 'only-child'
  , 'nth-of-type'
  , 'nth-last-of-type'
  , 'first-of-type'
  , 'last-of-type'
  , 'only-of-type'
  , 'nth-match'
  , 'nth-last-match'

  // Grid-Structural Selectors
  , 'nth-column'
  , 'nth-last-column'

  // Pseudo-elements
  , 'first-line'
  , 'first-letter'
  , 'before'
  , 'after'

  // Non-standard
  , 'selection'
];

module.exports = class Parser {
  /**
   * Initialize a new `Parser` with the given `str` and `options`.
   *
   * @param {String} str
   * @param {Object} options
   * @api private
   */

  constructor(str, options) {
    var self = this;
    options = options || {};
    Parser.cache = Parser.cache || Parser.getCache(options);
    this.hash = Parser.cache.key(str, options);
    this.lexer = {};
    if (!Parser.cache.has(this.hash)) {
      this.lexer = new Lexer(str, options);
    }
    this.prefix = options.prefix || '';
    this.root = options.root || new nodes.Root;
    this.state = ['root'];
    this.stash = [];
    this.parens = 0;
    this.css = 0;
    this.state.pop = function () {
      self.prevState = [].pop.call(this);
    };
  };

  /**
   * Get cache instance.
   *
   * @param {Object} options
   * @return {Object}
   * @api private
   */

  static getCache(options) {
    return false === options.cache
      ? cache(false)
      : cache(options.cache || 'memory', options);
  };


  /**
   * Return current state.
   *
   * @return {String}
   * @api private
   */

  currentState() {
    return this.state[this.state.length - 1];
  }

  /**
   * Return previous state.
   *
   * @return {String}
   * @api private
   */

  previousState() {
    return this.state[this.state.length - 2];
  }

  /**
   * Parse the input, then return the root node.
   *
   * @return {Node}
   * @api private
   */

  parse() {
    var block = this.parent = this.root;
    if (Parser.cache.has(this.hash)) {
      block = Parser.cache.get(this.hash);
      // normalize cached imports
      if ('block' == block.nodeName) block.constructor = nodes.Root;
    } else {
      while ('eos' != this.peek().type) {
        this.skipWhitespace();
        if ('eos' == this.peek().type) break;
        var stmt = this.statement();
        this.accept(';');
        if (!stmt) this.error('unexpected token {peek}, not allowed at the root level');
        block.push(stmt);
      }
      Parser.cache.set(this.hash, block);
    }
    return block;
  }

  /**
   * Throw an `Error` with the given `msg`.
   *
   * @param {String} msg
   * @api private
   */

  error(msg) {
    var type = this.peek().type
      , val = undefined == this.peek().val
        ? ''
        : ' ' + this.peek().toString();
    if (val.trim() == type.trim()) val = '';
    throw new errors.ParseError(msg.replace('{peek}', '"' + type + val + '"'));
  }

  /**
   * Accept the given token `type`, and return it,
   * otherwise return `undefined`.
   *
   * @param {String} type
   * @return {Token}
   * @api private
   */

  accept(type) {
    if (type == this.peek().type) {
      return this.next();
    }
  }

  /**
   * Expect token `type` and return it, throw otherwise.
   *
   * @param {String} type
   * @return {Token}
   * @api private
   */

  expect(type) {
    if (type != this.peek().type) {
      this.error('expected "' + type + '", got {peek}');
    }
    return this.next();
  }

  /**
   * Get the next token.
   *
   * @return {Token}
   * @api private
   */

  next() {
    var tok = this.stash.length
      ? this.stash.pop()
      : this.lexer.next()
      , line = tok.lineno
      , column = tok.column || 1;

    if (tok.val && tok.val.nodeName) {
      tok.val.lineno = line;
      tok.val.column = column;
    }
    nodes.lineno = line;
    nodes.column = column;
    debug.lexer('%s %s', tok.type, tok.val || '');
    return tok;
  }

  /**
   * Peek with lookahead(1).
   *
   * @return {Token}
   * @api private
   */

  peek() {
    return this.lexer.peek();
  }

  /**
   * Lookahead `n` tokens.
   *
   * @param {Number} n
   * @return {Token}
   * @api private
   */

  lookahead(n) {
    return this.lexer.lookahead(n);
  }

  /**
   * Check if the token at `n` is a valid selector token.
   *
   * @param {Number} n
   * @return {Boolean}
   * @api private
   */

  isSelectorToken(n) {
    var la = this.lookahead(n).type;
    switch (la) {
      case 'for':
        return this.bracketed;
      case '[':
        this.bracketed = true;
        return true;
      case ']':
        this.bracketed = false;
        return true;
      default:
        return ~selectorTokens.indexOf(la);
    }
  }

  /**
   * Check if the token at `n` is a pseudo selector.
   *
   * @param {Number} n
   * @return {Boolean}
   * @api private
   */

  isPseudoSelector(n) {
    var val = this.lookahead(n).val;
    return val && ~pseudoSelectors.indexOf(val.name);
  }

  /**
   * Check if the current line contains `type`.
   *
   * @param {String} type
   * @return {Boolean}
   * @api private
   */

  lineContains(type) {
    var i = 1
      , la;

    while (la = this.lookahead(i++)) {
      if (~['indent', 'outdent', 'newline', 'eos'].indexOf(la.type)) return;
      if (type == la.type) return true;
    }
  }

  /**
   * Check if the declaration starting at lookahead `i` contains `type`,
   * stopping at the end of the line or of the declaration (`;`, `{`, `}`),
   * as minified CSS puts several rules on one line.
   *
   * @param {Number} i
   * @param {String} type
   * @return {Boolean}
   * @api private
   */

  declarationContains(i, type) {
    var la;
    while (la = this.lookahead(i++)) {
      if (~['indent', 'outdent', 'newline', 'eos', ';', '{', '}'].indexOf(la.type)) return false;
      if (type == la.type) return true;
    }
    return false;
  }

  /**
   * Valid selector tokens.
   */

  selectorToken() {
    if (this.isSelectorToken(1)) {
      if ('{' == this.peek().type) {
        // unclosed, must be a block
        if (!this.lineContains('}')) return;
        // check if ':' is within the braces.
        // though not required by Stylus, chances
        // are if someone is using {} they will
        // use CSS-style props, helping us with
        // the ambiguity in this case
        var i = 0
          , la;
        while (la = this.lookahead(++i)) {
          if ('}' == la.type) {
            // Check empty block.
            if (i == 2 || (i == 3 && this.lookahead(i - 1).type == 'space'))
              return;
            break;
          }
          if (':' == la.type) return;
        }
      }
      return this.next();
    }
  }

  /**
   * Skip the given `tokens`.
   *
   * @param {Array} tokens
   * @api private
   */

  skip(tokens) {
    while (~tokens.indexOf(this.peek().type))
      this.next();
  }

  /**
   * Consume whitespace.
   */

  skipWhitespace() {
    this.skip(['space', 'indent', 'outdent', 'newline']);
  }

  /**
   * Consume newlines.
   */

  skipNewlines() {
    while ('newline' == this.peek().type)
      this.next();
  }

  /**
   * Consume spaces.
   */

  skipSpaces() {
    while ('space' == this.peek().type)
      this.next();
  }

  /**
   * Consume spaces and comments.
   */

  skipSpacesAndComments() {
    while ('space' == this.peek().type
      || 'comment' == this.peek().type)
      this.next();
  }

  /**
   * Check if the following sequence of tokens
   * forms a function definition, ie trailing
   * `{` or indentation.
   */

  looksLikeFunctionDefinition(i) {
    return 'indent' == this.lookahead(i).type
      || '{' == this.lookahead(i).type;
  }

  /**
   * Check if the following sequence of tokens
   * forms a selector.
   *
   * @param {Boolean} [fromProperty]
   * @return {Boolean}
   * @api private
   */

  looksLikeSelector(fromProperty) {
    var i = 1
      , node
      , brace;

    // Real property
    if (fromProperty && ':' == this.lookahead(i + 1).type
      && (this.lookahead(i + 1).space || 'indent' == this.lookahead(i + 2).type))
      return false;

    // Assume selector when an ident is
    // followed by a selector
    while ('ident' == this.lookahead(i).type
      && ('newline' == this.lookahead(i + 1).type
        || ',' == this.lookahead(i + 1).type)) i += 2;

    while (this.isSelectorToken(i)
      || ',' == this.lookahead(i).type) {

      if ('selector' == this.lookahead(i).type)
        return true;

      if ('&' == this.lookahead(i + 1).type)
        return true;

      // Hash values inside properties
      if (
        i > 1 &&
        'ident' === this.lookahead(i - 1).type &&
        '.' === this.lookahead(i).type &&
        'ident' === this.lookahead(i + 1).type
      ) {
        while ((node = this.lookahead(i + 2))) {
          if ([
            'indent',
            'outdent',
            '{',
            ';',
            'eos',
            'selector',
            'media',
            'if',
            'atrule',
            ')',
            '}',
            'unit',
            '[',
            'for',
            'function'
          ].indexOf(node.type) !== -1) {
            if (node.type === '[') {
              // stop at the end of input too, e.g. `a.b\ninput[typ`
              while ((node = this.lookahead(i + 3)) && node.type !== ']' && node.type !== 'eos') {
                if (~['.', 'unit'].indexOf(node.type)) {
                  return false;
                }
                i += 1
              }
            } else {
              if (this.isPseudoSelector(i + 2)) {
                return true;
              }

              if (node.type === ')' && this.lookahead(i + 3) && this.lookahead(i + 3).type === '}') {
                break;
              }

              return [
                'outdent',
                ';',
                'eos',
                'media',
                'if',
                'atrule',
                ')',
                '}',
                'unit',
                'for',
                'function'
              ].indexOf(node.type) === -1;
            }
          }

          i += 1
        }

        return true;
      }

      if ('.' == this.lookahead(i).type && 'ident' == this.lookahead(i + 1).type) {
        return true;
      }

      if ('*' == this.lookahead(i).type && 'newline' == this.lookahead(i + 1).type)
        return true;

      // Pseudo-elements
      if (':' == this.lookahead(i).type
        && ':' == this.lookahead(i + 1).type)
        return true;

      // #a after an ident and newline
      if ('color' == this.lookahead(i).type
        && 'newline' == this.lookahead(i - 1).type)
        return true;

      if (this.looksLikeAttributeSelector(i))
        return true;

      if (('=' == this.lookahead(i).type || 'function' == this.lookahead(i).type)
        && '{' == this.lookahead(i + 1).type)
        return false;

      // Hash values inside properties, e.g. "foo: bar.baz"
      if (':' == this.lookahead(i).type
        && !brace
        && !this.isPseudoSelector(i + 1)
        && this.declarationContains(i, '.'))
        return false;

      // in css-style blocks, a '}' without '{' closes the enclosing block:
      // the declaration ends there, e.g. "a{b:c}p{c:d}"
      if (this.css && !brace && '}' == this.lookahead(i).type) return false;

      // the ':' token within braces signifies
      // a selector. ex: "foo{bar:'baz'}"
      if ('{' == this.lookahead(i).type) brace = true;
      else if ('}' == this.lookahead(i).type) brace = false;
      if (brace && ':' == this.lookahead(i).type) return true;

      // '{' preceded by a space is considered a selector.
      // for example "foo{bar}{baz}" may be a property,
      // however "foo{bar} {baz}" is a selector
      if ('space' == this.lookahead(i).type
        && '{' == this.lookahead(i + 1).type)
        return true;

      // Assume pseudo selectors are NOT properties
      // as 'td:th-child(1)' may look like a property
      // and function call to the parser otherwise
      if (':' == this.lookahead(i++).type
        && !this.lookahead(i - 1).space
        && this.isPseudoSelector(i))
        return true;

      // Trailing space
      if ('space' == this.lookahead(i).type
        && 'newline' == this.lookahead(i + 1).type
        && '{' == this.lookahead(i + 2).type)
        return true;

      if (',' == this.lookahead(i).type
        && 'newline' == this.lookahead(i + 1).type)
        return true;
    }

    // Trailing comma
    if (',' == this.lookahead(i).type
      && 'newline' == this.lookahead(i + 1).type)
      return true;

    // Trailing brace
    if ('{' == this.lookahead(i).type
      && 'newline' == this.lookahead(i + 1).type)
      return true;

    // css-style mode, false on ; }
    if (this.css) {
      if (';' == this.lookahead(i).type ||
        '}' == this.lookahead(i - 1).type)
        return false;
    }

    // Trailing separators
    while (!~[
      'indent'
      , 'outdent'
      , 'newline'
      , 'for'
      , 'if'
      , ';'
      , '}'
      , 'eos'].indexOf(this.lookahead(i).type))
      ++i;

    if ('indent' == this.lookahead(i).type)
      return true;
  }

  /**
   * Check if the following sequence of tokens
   * forms an attribute selector.
   */

  looksLikeAttributeSelector(n) {
    var type = this.lookahead(n).type;
    if ('=' == type && this.bracketed) return true;
    return ('ident' == type || 'string' == type)
      && ']' == this.lookahead(n + 1).type
      && ('newline' == this.lookahead(n + 2).type || this.isSelectorToken(n + 2))
      && !this.lineContains(':')
      && !this.lineContains('=');
  }

  /**
   * Check if the following sequence of tokens
   * forms a keyframe block.
   */

  looksLikeKeyframe() {
    var i = 2
      , type;
    switch (this.lookahead(i).type) {
      case '{':
      case 'indent':
      case ',':
        return true;
      case 'newline':
        while ('unit' == this.lookahead(++i).type
          || 'newline' == this.lookahead(i).type);
        type = this.lookahead(i).type;
        return 'indent' == type || '{' == type;
    }
  }

  /**
   * Check if the current state supports selectors.
   */

  stateAllowsSelector() {
    switch (this.currentState()) {
      case 'root':
      case 'atblock':
      case 'selector':
      case 'conditional':
      case 'function':
      case 'atrule':
      case 'for':
        return true;
    }
  }

  /**
   * Try to assign @block to the node.
   *
   * @param {Expression} expr
   * @private
   */

  assignAtblock(expr) {
    try {
      expr.push(this.atblock(expr));
    } catch (err) {
      this.error('invalid right-hand side operand in assignment, got {peek}');
    }
  }

  /**
   *   statement
   * | statement 'if' expression
   * | statement 'unless' expression
   */

  statement() {
    var stmt = this.stmt()
      , state = this.prevState
      , block
      , op;

    // special-case statements since it
    // is not an expression. We could
    // implement postfix conditionals at
    // the expression level, however they
    // would then fail to enclose properties
    if (this.allowPostfix) {
      this.allowPostfix = false;
      state = 'expression';
    }

    switch (state) {
      case 'assignment':
      case 'expression':
      case 'function arguments':
        while (op =
          this.accept('if')
          || this.accept('unless')
          || this.accept('for')) {
          switch (op.type) {
            case 'if':
            case 'unless':
              stmt = new nodes.If(this.expression(), stmt);
              stmt.postfix = true;
              stmt.negate = 'unless' == op.type;
              this.accept(';');
              break;
            case 'for':
              var key
                , val = this.id().name;
              if (this.accept(',')) key = this.id().name;
              this.expect('in');
              var each = new nodes.Each(val, key, this.expression());
              block = new nodes.Block(this.parent, each);
              block.push(stmt);
              each.block = block;
              stmt = each;
          }
        }
    }

    return stmt;
  }

  /**
   *    ident
   *  | selector
   *  | literal
   *  | charset
   *  | namespace
   *  | import
   *  | require
   *  | media
   *  | atrule
   *  | scope
   *  | keyframes
   *  | mozdocument
   *  | for
   *  | if
   *  | unless
   *  | comment
   *  | expression
   *  | 'return' expression
   */

  stmt() {
    var tok = this.peek(), selector;
    switch (tok.type) {
      case 'keyframes':
        return this.keyframes();
      case '-moz-document':
        return this.mozdocument();
      case 'comment':
      case 'selector':
      case 'literal':
      case 'charset':
      case 'namespace':
      case 'import':
      case 'require':
      case 'extend':
      case 'media':
      case 'atrule':
      case 'ident':
      case 'scope':
      case 'supports':
      case 'unless':
      case 'function':
      case 'for':
      case 'if':
        return this[tok.type]();
      case 'return':
        return this.return();
      case '{':
        return this.property();
      default:
        // Contextual selectors
        if (this.stateAllowsSelector()) {
          switch (tok.type) {
            case 'color':
            case '~':
            case '>':
            case '<':
            case ':':
            case '&':
            case '&&':
            case '[':
            case '.':
            case '/':
              selector = this.selector();
              selector.column = tok.column;
              selector.lineno = tok.lineno;
              return selector;
            // relative reference
            case '..':
              if ('/' == this.lookahead(2).type)
                return this.selector();
            case '+':
              return 'function' == this.lookahead(2).type
                ? this.functionCall()
                : this.selector();
            case '*':
              return this.property();
            // keyframe blocks (10%, 20% { ... })
            case 'unit':
              if (this.looksLikeKeyframe()) {
                selector = this.selector();
                selector.column = tok.column;
                selector.lineno = tok.lineno;
                return selector;
              }
            case '-':
              if ('{' == this.lookahead(2).type)
                return this.property();
          }
        }

        // Expression fallback
        var expr = this.expression();
        if (expr.isEmpty) this.error('unexpected {peek}');
        return expr;
    }
  }

  /**
   * indent (!outdent)+ outdent
   */

  block(node, scope) {
    var delim
      , stmt
      , next
      , block = this.parent = new nodes.Block(this.parent, node);

    if (false === scope) block.scope = false;

    this.accept('newline');

    // css-style
    if (this.accept('{')) {
      this.css++;
      delim = '}';
      this.skipWhitespace();
    } else {
      delim = 'outdent';
      this.expect('indent');
    }

    while (delim != this.peek().type) {
      // css-style
      if (this.css) {
        if (this.accept('newline') || this.accept('indent')) continue;
        stmt = this.statement();
        this.accept(';');
        this.skipWhitespace();
      } else {
        if (this.accept('newline')) continue;
        // skip useless indents and comments
        next = this.lookahead(2).type;
        if ('indent' == this.peek().type
          && ~['outdent', 'newline', 'comment'].indexOf(next)) {
          this.skip(['indent', 'outdent']);
          continue;
        }
        if ('eos' == this.peek().type) return block;
        stmt = this.statement();
        this.accept(';');
      }
      if (!stmt) this.error('unexpected token {peek} in block');
      block.push(stmt);
    }

    // css-style
    if (this.css) {
      this.skipWhitespace();
      this.expect('}');
      this.skipSpaces();
      this.css--;
    } else {
      this.expect('outdent');
    }

    this.parent = block.parent;
    return block;
  }

  /**
   * comment space*
   */

  comment() {
    var node = this.next().val;
    this.skipSpaces();
    return node;
  }

  /**
   * for val (',' key) in expr
   */

  for() {
    this.expect('for');
    var key
      , val = this.id().name;
    if (this.accept(',')) key = this.id().name;
    this.expect('in');
    this.state.push('for');
    this.cond = true;
    var each = new nodes.Each(val, key, this.expression());
    this.cond = false;
    each.block = this.block(each, false);
    this.state.pop();
    return each;
  }

  /**
   * return expression
   */

  return() {
    this.expect('return');
    var expr = this.expression();
    return expr.isEmpty
      ? new nodes.Return
      : new nodes.Return(expr);
  }

  /**
   * unless expression block
   */

  unless() {
    this.expect('unless');
    this.state.push('conditional');
    this.cond = true;
    var node = new nodes.If(this.expression(), true);
    this.cond = false;
    node.block = this.block(node, false);
    this.state.pop();
    return node;
  }

  /**
   * if expression block (else block)?
   */

  if() {
    var token = this.expect('if');

    this.state.push('conditional');
    this.cond = true;
    var node = new nodes.If(this.expression())
      , cond
      , block
      , item;

    node.column = token.column;

    this.cond = false;
    node.block = this.block(node, false);
    this.skip(['newline', 'comment']);
    while (this.accept('else')) {
      token = this.accept('if');
      if (token) {
        this.cond = true;
        cond = this.expression();
        this.cond = false;
        block = this.block(node, false);
        item = new nodes.If(cond, block);

        item.column = token.column;

        node.elses.push(item);
      } else {
        node.elses.push(this.block(node, false));
        break;
      }
      this.skip(['newline', 'comment']);
    }
    this.state.pop();
    return node;
  }

  /**
   * @block
   *
   * @param {Expression} [node]
   */

  atblock(node) {
    if (!node) this.expect('atblock');
    node = new nodes.Atblock;
    this.state.push('atblock');
    node.block = this.block(node, false);
    this.state.pop();
    return node;
  }

  /**
   * atrule selector? block?
   */

  atrule() {
    var type = this.expect('atrule').val
      , node = new nodes.Atrule(type)
      , tok;
    this.skipSpacesAndComments();
    node.segments = [];
    while (true) {
      node.segments = node.segments.concat(this.selectorParts());
      // comma-separated preludes, e.g. `@layer reset, base;`
      if (this.accept(',')) {
        this.skipSpacesAndComments();
        node.segments.push(new nodes.Literal(', '));
      // condition keywords, e.g. `@container not (a) or (b)`
      } else if (tok = this.accept('||') || this.accept('not')) {
        this.skipSpacesAndComments();
        var last = node.segments[node.segments.length - 1];
        if (last && 'literal' == last.nodeName && !/[\s(]$/.test(last.val)) {
          node.segments.push(new nodes.Literal(' '));
        }
        node.segments.push(new nodes.Literal(('||' == tok.type ? 'or' : 'not') + ' '));
      } else {
        break;
      }
    }
    // `and` is lexed as `&&`
    node.segments = node.segments.map(function (seg) {
      return 'literal' == seg.nodeName && '&&' == seg.val
        ? new nodes.Literal('and')
        : seg;
    });
    this.skipSpacesAndComments();
    tok = this.peek().type;
    if ('indent' == tok || '{' == tok || ('newline' == tok
      && '{' == this.lookahead(2).type)) {
      this.state.push('atrule');
      node.block = this.block(node);
      this.state.pop();
    }
    return node;
  }

  /**
   * scope
   */

  scope() {
    var tok = this.expect('scope')
      , parts;
    this.skipSpacesAndComments();
    parts = this.selectorParts();
    this.skipSpacesAndComments();

    // CSS `@scope (<start>) to (<end>) { ... }` at-rule,
    // distinguished from Stylus' `@scope <selector>` by its block
    var la = this.peek().type;
    if ('indent' == la || '{' == la
      || ('newline' == la && '{' == this.lookahead(2).type)) {
      var node = new nodes.Atrule('scope');
      node.lineno = tok.lineno;
      node.column = tok.column;
      node.segments = parts;
      this.state.push('atrule');
      node.block = this.block(node);
      this.state.pop();
      return node;
    }

    var selector = parts
      .map(function (selector) { return selector.val; })
      .join('');
    this.selectorScope = selector.trim();
    return nodes.null;
  }

  /**
   * supports
   */

  supports() {
    this.expect('supports');
    var node = new nodes.Supports(this.supportsCondition());
    this.state.push('atrule');
    node.block = this.block(node);
    this.state.pop();
    return node;
  }

  /**
   *   supports negation
   * | supports op
   * | expression
   */

  supportsCondition() {
    var node = this.supportsNegation()
      || this.supportsOp();
    if (!node) {
      this.cond = true;
      node = this.expression();
      this.cond = false;
    }
    return node;
  }

  /**
   * 'not' supports feature
   */

  supportsNegation() {
    if (this.accept('not')) {
      var node = new nodes.Expression;
      node.push(new nodes.Literal('not'));
      node.push(this.supportsFeature());
      return node;
    }
  }

  /**
   * supports feature (('and' | 'or') supports feature)+
   */

  supportsOp() {
    var feature = this.supportsFeature()
      , op
      , expr;
    if (feature) {
      expr = new nodes.Expression;
      expr.push(feature);
      while (op = this.accept('&&') || this.accept('||')) {
        expr.push(new nodes.Literal('&&' == op.val ? 'and' : 'or'));
        expr.push(this.supportsFeature());
      }
      return expr;
    }
  }

  /**
   *   ('(' supports condition ')')
   * | feature
   */

  supportsFeature() {
    this.skipSpacesAndComments();
    var tok = this.peek();
    // selector(<complex-selector>), font-tech(...), font-format(...)
    if ('function' == tok.type
      && ~['selector', 'font-tech', 'font-format'].indexOf(tok.val.name)) {
      var node = new nodes.Literal(this.rawFunction());
      this.skipSpacesAndComments();
      return node;
    }
    if ('(' == tok.type) {
      var la = this.lookahead(2).type;

      if ('ident' == la || '{' == la) {
        return this.feature();
      } else {
        this.expect('(');
        var node = new nodes.Expression;
        node.push(new nodes.Literal('('));
        node.push(this.supportsCondition());
        this.expect(')')
        node.push(new nodes.Literal(')'));
        this.skipSpacesAndComments();
        return node;
      }
    }
  }

  /**
   * extend
   */

  extend() {
    var tok = this.expect('extend')
      , selectors = []
      , sel
      , node
      , arr;

    do {
      arr = this.selectorParts();

      if (!arr.length) continue;

      sel = new nodes.Selector(arr);
      selectors.push(sel);

      if ('!' !== this.peek().type) continue;

      tok = this.lookahead(2);
      if ('ident' !== tok.type || 'optional' !== tok.val.name) continue;

      this.skip(['!', 'ident']);
      sel.optional = true;
    } while (this.accept(','));

    node = new nodes.Extend(selectors);
    node.lineno = tok.lineno;
    node.column = tok.column;
    return node;
  }

  /**
   * media queries
   */

  media() {
    var tok = this.expect('media');
    this.state.push('atrule');
    var media = new nodes.Media(this.queries());
    // the queries may span several lines
    media.lineno = tok.lineno;
    media.column = tok.column;
    media.block = this.block(media);
    this.state.pop();
    return media;
  }

  /**
   * query (',' query)*
   */

  queries() {
    var queries = new nodes.QueryList
      , skip = ['comment', 'newline', 'space'];

    do {
      this.skip(skip);
      queries.push(this.query());
      this.skip(skip);
    } while (this.accept(','));
    return queries;
  }

  /**
   *   expression
   * | (ident | 'not')? ident ('and' feature)*
   * | feature ('and' feature)*
   */

  query() {
    var query = new nodes.Query
      , expr
      , pred
      , id;

    // hash values support
    if ('ident' == this.peek().type
      && ('.' == this.lookahead(2).type
        || '[' == this.lookahead(2).type)) {
      this.cond = true;
      expr = this.expression();
      this.cond = false;
      query.push(new nodes.Feature(expr.nodes));
      return query;
    }

    if (pred = this.accept('ident') || this.accept('not')) {
      pred = new nodes.Literal(pred.val.string || pred.val);

      this.skipSpacesAndComments();
      // not (feature)
      if ('not' == pred.string && '(' == this.peek().type) {
        query.predicate = pred;
        query.push(this.feature());
        return query;
      }
      if (id = this.accept('ident')) {
        query.type = id.val;
        query.predicate = pred;
      } else {
        query.type = pred;
      }
      this.skipSpacesAndComments();

      if (!this.accept('&&')) return query;
    }

    var feature = this.feature();
    // (a) or (b) ...
    if ('||' == this.peek().type) {
      query.push(this.conditionChain(feature));
      return query;
    }
    query.push(feature);
    while (this.accept('&&')) query.push(this.feature());

    return query;
  }

  /**
   * Media Queries Level 4 condition:
   * feature (('and' | 'or') feature)*
   *
   * @param {Feature} first
   * @return {Feature}
   * @api private
   */

  conditionChain(first) {
    var node = new nodes.Feature([])
      , op;
    node.condition = [first];
    while (op = this.accept('&&') || this.accept('||')) {
      this.skipSpacesAndComments();
      node.condition.push('&&' == op.type ? 'and' : 'or');
      node.condition.push(this.feature());
    }
    return node;
  }

  /**
   * Check if the upcoming parenthesized feature is a nested
   * condition, e.g. `(not (hover))` or `((a) or (b))`.
   *
   * @return {Boolean}
   * @api private
   */

  isNestedCondition() {
    if ('(' != this.peek().type) return false;
    var i = 2
      , type;
    while ('space' == (type = this.lookahead(i).type)) ++i;
    return 'not' == type || '(' == type;
  }

  /**
   * '(' 'not' feature ')' | '(' condition ')'
   */

  nestedCondition() {
    var node;
    this.expect('(');
    this.skipSpacesAndComments();
    if (this.accept('not')) {
      this.skipSpacesAndComments();
      node = new nodes.Feature([]);
      node.condition = ['not', this.feature()];
    } else {
      node = this.conditionChain(this.feature());
    }
    this.skipSpacesAndComments();
    this.expect(')');
    this.skipSpacesAndComments();
    node.parens = true;
    return node;
  }

  /**
   * '(' ident ( ':'? expression )? ')'
   */

  feature() {
    this.skipSpacesAndComments();
    if (this.isNestedCondition()) return this.nestedCondition();
    if (this.isRangeFeature()) return this.rangeFeature();
    this.expect('(');
    this.skipSpacesAndComments();
    var node = new nodes.Feature(this.interpolate());
    this.skipSpacesAndComments();
    this.accept(':')
    this.skipSpacesAndComments();
    this.inProperty = true;
    node.expr = this.list();
    this.inProperty = false;
    this.skipSpacesAndComments();
    this.expect(')');
    this.skipSpacesAndComments();
    return node;
  }

  /**
   * Check if the upcoming parenthesized feature uses
   * the range syntax, e.g. `(width >= 600px)`.
   *
   * @return {Boolean}
   * @api private
   */

  isRangeFeature() {
    if ('(' != this.peek().type) return false;
    var i = 2
      , depth = 1
      , type;
    while (depth) {
      type = this.lookahead(i++).type;
      switch (type) {
        case '(':
        case 'function':
          ++depth;
          break;
        case ')':
          --depth;
          break;
        case ':':
        case 'eos':
        case 'newline':
        case 'indent':
        case 'outdent':
        case '{':
          return false;
        default:
          if (1 == depth && ~rangeOperators.indexOf(type)) return true;
      }
    }
    return false;
  }

  /**
   * '(' operand op operand (op operand)? ')'
   */

  rangeFeature() {
    var node = new nodes.Feature([])
      , range = []
      , op;

    this.expect('(');
    do {
      if (op) range.push(op.type);
      this.skipSpacesAndComments();
      range.push(this.rangeOperand());
      this.skipSpacesAndComments();
    } while (op = this.acceptRangeOperator());
    this.expect(')');
    this.skipSpacesAndComments();

    if (range.length != 3 && range.length != 5) {
      this.error('invalid media range syntax');
    }
    node.range = range;
    return node;
  }

  /**
   * Accept one of the range comparison operators.
   *
   * @return {Token}
   * @api private
   */

  acceptRangeOperator() {
    var type = this.peek().type;
    if (~rangeOperators.indexOf(type)) return this.next();
  }

  /**
   * Operand of a range feature.
   *
   * @return {Expression}
   * @api private
   */

  rangeOperand() {
    var expr = new nodes.Expression
      , i = 2
      , la;

    // bare ident: feature name or variable, resolved by the evaluator
    if ('ident' == this.peek().type) {
      while ('space' == (la = this.lookahead(i).type)) ++i;
      if (')' == la || ~rangeOperators.indexOf(la)) {
        expr.push(this.next().val);
        return expr;
      }
    }

    this.state.push('expression');
    this.inProperty = true;
    var node = this.additive();
    if (!node) this.error('unexpected {peek} in media range');
    expr.push(node);
    // literal '/' (e.g. aspect-ratio: 16/9)
    while (this.stash.length
      && 'literal' == this.stash[this.stash.length - 1].type) {
      expr.push(this.stash.pop().val);
      expr.push(this.additive());
    }
    this.inProperty = false;
    this.state.pop();
    return expr;
  }

  /**
   * @-moz-document call (',' call)* block
   */

  mozdocument() {
    this.expect('-moz-document');
    var mozdocument = new nodes.Atrule('-moz-document')
      , calls = [];
    do {
      this.skipSpacesAndComments();
      calls.push(this.functionCall());
      this.skipSpacesAndComments();
    } while (this.accept(','));
    mozdocument.segments = [new nodes.Literal(calls.join(', '))];
    this.state.push('atrule');
    mozdocument.block = this.block(mozdocument, false);
    this.state.pop();
    return mozdocument;
  }

  /**
   * import expression
   */

  import() {
    this.expect('import');
    this.allowPostfix = true;
    this.skipSpaces();
    if (!this.importHasConditions()) return new nodes.Import(this.expression(), false);

    // CSS import conditions: `@import url(a.css) layer(x) supports(...) screen;`
    var path = new nodes.Expression;
    path.push(this.primary());
    path.push(new nodes.Literal(this.rawUntilEndOfStatement()));
    return new nodes.Import(path, false);
  }

  /**
   * Check if the upcoming import path (string or `url()`) is followed
   * by CSS import conditions: `layer`, `supports()` or a media query.
   *
   * @return {Boolean}
   * @api private
   */

  importHasConditions() {
    var tok = this.peek()
      , i = 2
      , depth;
    if ('function' == tok.type && 'url' == tok.val.name) {
      depth = 1;
      while (depth) {
        tok = this.lookahead(i++);
        if ('(' == tok.type || 'function' == tok.type) ++depth;
        else if (')' == tok.type) --depth;
        else if ('eos' == tok.type || 'newline' == tok.type) return false;
      }
    } else if ('string' != tok.type) {
      return false;
    }
    while ('space' == (tok = this.lookahead(i)).type) ++i;
    switch (tok.type) {
      case 'function':
        return 'layer' == tok.val.name || 'supports' == tok.val.name;
      case 'ident':
      case '(':
      case 'not':
        return true;
    }
    return false;
  }

  /**
   * Consume the tokens up to the end of the statement,
   * returning their raw CSS source.
   *
   * @return {String}
   * @api private
   */

  rawUntilEndOfStatement() {
    var str = ''
      , tok;
    while (!~[';', 'newline', 'eos', 'indent', 'outdent', '}'].indexOf(this.peek().type)) {
      tok = this.next();
      switch (tok.type) {
        case 'space':
          str += ' ';
          break;
        case 'function':
          str += tok.val.name + '(';
          break;
        case 'ident':
          str += tok.val.name || tok.val.string;
          break;
        case 'color':
        case 'unit':
          str += tok.val.raw;
          break;
        case 'string':
          str += tok.val.toString();
          break;
        case '&&':
          str += ' and ';
          break;
        case '||':
          str += ' or ';
          break;
        case 'comment':
          break;
        default:
          str += tok.toString();
      }
      if (tok.space) str += ' ';
    }
    this.accept(';');
    return str.replace(/\s+/g, ' ').replace(/\(\s+/g, '(').replace(/\s+\)/g, ')').trim();
  }

  /**
   * require expression
   */

  require() {
    this.expect('require');
    this.allowPostfix = true;
    return new nodes.Import(this.expression(), true);
  }

  /**
   * charset string
   */

  charset() {
    this.expect('charset');
    var str = this.expect('string').val;
    this.allowPostfix = true;
    return new nodes.Charset(str);
  }

  /**
   * namespace ident? (string | url)
   */

  namespace() {
    var str
      , prefix;
    this.expect('namespace');

    this.skipSpacesAndComments();
    if (prefix = this.accept('ident')) {
      prefix = prefix.val;
    }
    this.skipSpacesAndComments();

    str = this.accept('string') || this.url();
    this.allowPostfix = true;
    return new nodes.Namespace(str, prefix);
  }

  /**
   * keyframes name block
   */

  keyframes() {
    var tok = this.expect('keyframes')
      , keyframes;

    this.skipSpacesAndComments();
    keyframes = new nodes.Keyframes(this.selectorParts(), tok.val);
    keyframes.column = tok.column;

    this.skipSpacesAndComments();

    // block
    this.state.push('atrule');
    keyframes.block = this.block(keyframes);
    this.state.pop();

    return keyframes;
  }

  /**
   * literal
   */

  literal() {
    return this.expect('literal').val;
  }

  /**
   * ident space?
   */

  id() {
    var tok = this.expect('ident');
    this.accept('space');
    return tok.val;
  }

  /**
   *   ident
   * | assignment
   * | property
   * | selector
   */

  ident() {
    var i = 2
      , la = this.lookahead(i).type;

    while ('space' == la) la = this.lookahead(++i).type;

    switch (la) {
      // Assignment
      case '=':
      case '?=':
      case '-=':
      case '+=':
      case '*=':
      case '/=':
      case '%=':
        return this.assignment();
      // Member
      case '.':
        if ('space' == this.lookahead(i - 1).type) return this.selector();
        if (this._ident == this.peek()) return this.id();
        while ('=' != this.lookahead(++i).type
          && !~['[', ',', 'newline', 'indent', 'eos'].indexOf(this.lookahead(i).type));
        if ('=' == this.lookahead(i).type) {
          this._ident = this.peek();
          return this.expression();
        } else if (this.looksLikeSelector() && this.stateAllowsSelector()) {
          return this.selector();
        }
      // Assignment []=
      case '[':
        if (this._ident == this.peek()) return this.id();
        while (']' != this.lookahead(i++).type
          && 'selector' != this.lookahead(i).type
          && 'eos' != this.lookahead(i).type);
        if ('=' == this.lookahead(i).type) {
          this._ident = this.peek();
          return this.expression();
        } else if (this.looksLikeSelector() && this.stateAllowsSelector()) {
          return this.selector();
        }
      // Operation
      case '-':
      case '+':
      case '/':
      case '*':
      case '%':
      case '**':
      case '&&':
      case '||':
      case '>':
      case '<':
      case '>=':
      case '<=':
      case '!=':
      case '==':
      case '?':
      case 'in':
      case 'is a':
      case 'is defined':
        // Prevent cyclic .ident, return literal
        if (this._ident == this.peek()) {
          return this.id();
        } else {
          this._ident = this.peek();
          switch (this.currentState()) {
            // unary op or selector in property / for
            case 'for':
            case 'selector':
              return this.property();
            // Part of a selector
            case 'root':
            case 'atblock':
            case 'atrule':
              return '[' == la
                ? this.subscript()
                : this.selector();
            case 'function':
            case 'conditional':
              return this.looksLikeSelector()
                ? this.selector()
                : this.expression();
            // Do not disrupt the ident when an operand
            default:
              return this.operand
                ? this.id()
                : this.expression();
          }
        }
      // Selector or property
      default:
        switch (this.currentState()) {
          case 'root':
            return this.selector();
          case 'for':
          case 'selector':
          case 'function':
          case 'conditional':
          case 'atblock':
          case 'atrule':
            return this.property();
          default:
            var id = this.id();
            if ('interpolation' == this.previousState()) id.mixin = true;
            return id;
        }
    }
  }

  /**
   * '*'? (ident | '{' expression '}')+
   */

  interpolate() {
    var node
      , segs = []
      , star;

    star = this.accept('*');
    if (star) segs.push(new nodes.Literal('*'));

    while (true) {
      if (this.accept('{')) {
        this.state.push('interpolation');
        segs.push(this.expression());
        this.expect('}');
        this.state.pop();
      } else if (node = this.accept('-')) {
        segs.push(new nodes.Literal('-'));
      } else if (node = this.accept('ident')) {
        segs.push(node.val);
      } else {
        break;
      }
    }
    if (!segs.length) this.expect('ident');
    return segs;
  }

  /**
   *   property ':'? expression
   * | ident
   */

  property() {
    if (this.looksLikeSelector(true)) return this.selector();

    // property
    var ident = this.interpolate()
      , prop = new nodes.Property(ident)
      , ret = prop;

    // optional ':'
    this.accept('space');
    var colon = this.accept(':');
    if (colon) this.accept('space');

    this.state.push('property');
    this.inProperty = true;
    prop.expr = this.list();
    if (prop.expr.isEmpty) {
      // empty custom property, e.g. `--foo: ;`
      if (colon && ident[0] && ident[0].name && 0 == ident[0].name.indexOf('--')) {
        prop.expr.push(new nodes.Literal(''));
      } else {
        ret = ident[0];
      }
    }
    this.inProperty = false;
    this.allowPostfix = true;
    this.state.pop();

    // optional ';'
    this.accept(';');

    return ret;
  }

  /**
   *   selector ',' selector
   * | selector newline selector
   * | selector block
   */

  selector() {
    var arr
      , group = new nodes.Group
      , scope = this.selectorScope
      , isRoot = 'root' == this.currentState()
      , selector;

    do {
      // Clobber newline after ,
      this.accept('newline');

      arr = this.selectorParts();

      // commas within parens belong to the selector, e.g. `:is(a, b)`
      while (unclosedParens(arr) && this.accept(',')) {
        this.skip(['space', 'newline']);
        arr.push(new nodes.Literal(', '));
        arr = arr.concat(this.selectorParts());
      }

      // Push the selector
      if (isRoot && scope) arr.unshift(new nodes.Literal(scope + ' '));
      if (arr.length) {
        selector = new nodes.Selector(arr);
        selector.lineno = arr[0].lineno;
        selector.column = arr[0].column;
        group.push(selector);
      }
    } while (this.accept(',') || this.accept('newline'));

    if ('selector-parts' == this.currentState()) return group.nodes;

    this.state.push('selector');
    group.block = this.block(group);
    this.state.pop();

    return group;
  }

  selectorParts() {
    var tok
      , arr = [];

    // Selector candidates,
    // stitched together to
    // form a selector.
    while (tok = this.selectorToken()) {
      debug.selector('%s', tok);
      // Selector component
      switch (tok.type) {
        case '{':
          this.skipSpaces();
          var expr = this.expression();
          this.skipSpaces();
          this.expect('}');
          arr.push(expr);
          break;
        case this.prefix && '.':
          var literal = new nodes.Literal(tok.val + this.prefix);
          literal.prefixed = true;
          arr.push(literal);
          break;
        case 'comment':
          // ignore comments
          break;
        case 'color':
        case 'unit':
          arr.push(new nodes.Literal(tok.val.raw));
          break;
        case 'space':
          arr.push(new nodes.Literal(' '));
          break;
        case 'function':
          arr.push(new nodes.Literal(tok.val.name + '('));
          break;
        case 'ident':
          arr.push(new nodes.Literal(tok.val.name || tok.val.string));
          break;
        default:
          arr.push(new nodes.Literal(tok.val));
          if (tok.space) arr.push(new nodes.Literal(' '));
      }
    }

    return arr;
  }

  /**
   * Check if the upcoming function call has a comma
   * separating its arguments.
   *
   * @return {Boolean}
   * @api private
   */

  hasTopLevelComma() {
    var i = 2
      , depth = 1
      , type;
    while (depth) {
      type = this.lookahead(i++).type;
      switch (type) {
        case '(':
        case 'function':
          ++depth;
          break;
        case ')':
          --depth;
          break;
        case ',':
          if (1 == depth) return true;
          break;
        case 'eos':
          return false;
      }
    }
    return false;
  }

  /**
   * Consume a function token and everything up to its
   * matching ')' returning the raw CSS source.
   *
   * @return {String}
   * @api private
   */

  rawFunction() {
    var tok = this.expect('function')
      , str = tok.val.name + '('
      , depth = 1;

    while (depth) {
      tok = this.next();
      switch (tok.type) {
        case 'eos':
        case 'newline':
        case 'indent':
        case 'outdent':
          this.error('expected ")", got "' + tok.type + '"');
        case 'function':
          ++depth;
          str += tok.val.name + '(';
          break;
        case '(':
          ++depth;
          str += '(';
          break;
        case ')':
          --depth;
          str += ')';
          break;
        case 'comment':
          break;
        case 'space':
          str += ' ';
          break;
        case 'ident':
          str += tok.val.name || tok.val.string;
          break;
        case 'color':
        case 'unit':
          str += tok.val.raw;
          break;
        default:
          str += tok.toString();
      }
      if (tok.space && depth) str += ' ';
    }

    return str;
  }

  /**
   * ident ('=' | '?=') expression
   */

  assignment() {
    var
      op,
      node,
      ident = this.id(),
      name = ident.name;

    if (op =
      this.accept('=')
      || this.accept('?=')
      || this.accept('+=')
      || this.accept('-=')
      || this.accept('*=')
      || this.accept('/=')
      || this.accept('%=')) {
      this.state.push('assignment');
      var expr = this.list();
      // @block support
      if (expr.isEmpty) this.assignAtblock(expr);
      node = new nodes.Ident(name, expr);

      node.lineno = ident.lineno;
      node.column = ident.column;

      this.state.pop();

      switch (op.type) {
        case '?=':
          var defined = new nodes.BinOp('is defined', node)
            , lookup = new nodes.Expression;
          lookup.push(new nodes.Ident(name));
          node = new nodes.Ternary(defined, lookup, node);
          break;
        case '+=':
        case '-=':
        case '*=':
        case '/=':
        case '%=':
          node.val = new nodes.BinOp(op.type[0], new nodes.Ident(name), expr);
          break;
      }
    }

    return node;
  }

  /**
   *   definition
   * | call
   */

  function() {
    var parens = 1
      , i = 2
      , tok;

    // Lookahead and determine if we are dealing
    // with a function call or definition. Here
    // we pair parens to prevent false negatives
    out:
    while (tok = this.lookahead(i++)) {
      switch (tok.type) {
        case 'function':
        case '(':
          ++parens;
          break;
        case ')':
          if (!--parens) break out;
          break;
        case 'eos':
          this.error('failed to find closing paren ")"');
      }
    }

    // Definition or call
    switch (this.currentState()) {
      case 'expression':
        return this.functionCall();
      default:
        return this.looksLikeFunctionDefinition(i)
          ? this.functionDefinition()
          : this.expression();
    }
  }

  /**
   * url '(' (expression | urlchars)+ ')'
   */

  url() {
    this.expect('function');
    this.state.push('function arguments');
    var args = this.args();
    this.expect(')');
    this.state.pop();
    return new nodes.Call('url', args);
  }

  /**
   * '+'? ident '(' expression ')' block?
   */

  functionCall() {
    var withBlock = this.accept('+');
    if ('url' == this.peek().val.name) return this.url();

    // CSS Color 4 space-separated syntax: `rgb(0 0 0 / 50%)`,
    // the slash separates alpha and must not be a division
    var slash = this.slashLiteral
      , name = this.peek().val.name;
    this.slashLiteral = ~colorFunctions.indexOf(name) && !this.hasTopLevelComma()
      ? this.parens + 1
      : 0;

    var tok = this.expect('function').val;

    this.state.push('function arguments');
    this.parens++;
    var args = this.args();
    this.expect(')');
    this.parens--;
    this.state.pop();
    this.slashLiteral = slash;
    var call = new nodes.Call(name, args);

    call.column = tok.column;
    call.lineno = tok.lineno;

    if (withBlock) {
      this.state.push('function');
      call.block = this.block(call);
      this.state.pop();
    }
    return call;
  }

  /**
   * ident '(' params ')' block
   */

  functionDefinition() {
    var
      tok = this.expect('function'),
      name = tok.val.name;

    // params
    this.state.push('function params');
    this.skipWhitespace();
    var params = this.params();
    this.skipWhitespace();
    this.expect(')');
    this.state.pop();

    // Body
    this.state.push('function');
    var fn = new nodes.Function(name, params);

    fn.column = tok.column;
    fn.lineno = tok.lineno;

    fn.block = this.block(fn);
    this.state.pop();
    return new nodes.Ident(name, fn);
  }

  /**
   *   ident
   * | ident '...'
   * | ident '=' expression
   * | ident ',' ident
   */

  params() {
    var tok
      , node
      , params = new nodes.Params;
    while (tok = this.accept('ident')) {
      this.accept('space');
      params.push(node = tok.val);
      if (this.accept('...')) {
        node.rest = true;
      } else if (this.accept('=')) {
        node.val = this.expression();
      }
      this.skipWhitespace();
      this.accept(',');
      this.skipWhitespace();
    }
    return params;
  }

  /**
   * (ident ':')? expression (',' (ident ':')? expression)*
   */

  args() {
    var args = new nodes.Arguments
      , keyword;

    do {
      // keyword
      if ('ident' == this.peek().type && ':' == this.lookahead(2).type) {
        keyword = this.next().val.string;
        this.expect(':');
        args.map[keyword] = this.expression();
        // CSS interpolation method, e.g. `color-mix(in srgb, ...)`
      } else if ('in' == this.peek().type) {
        this.next();
        this.skipSpaces();
        var expr = this.expression();
        expr.nodes.unshift(new nodes.Literal('in'));
        args.push(expr);
        // arg
      } else {
        args.push(this.expression());
      }
    } while (this.accept(','));

    return args;
  }

  /**
   * expression (',' expression)*
   */

  list() {
    var node = this.expression();

    while (this.accept(',')) {
      if (node.isList) {
        list.push(this.expression());
      } else {
        var list = new nodes.Expression(true);
        list.push(node);
        list.push(this.expression());
        node = list;
      }
    }
    return node;
  }

  /**
   * negation+
   */

  expression() {
    var node
      , expr = new nodes.Expression;
    this.state.push('expression');
    while (node = this.negation()) {
      if (!node) this.error('unexpected token {peek} in expression');
      expr.push(node);
    }
    this.state.pop();
    if (expr.nodes.length) {
      expr.lineno = expr.nodes[0].lineno;
      expr.column = expr.nodes[0].column;
    }
    return expr;
  }

  /**
   *   'not' ternary
   * | ternary
   */

  negation() {
    if (this.accept('not')) {
      return new nodes.UnaryOp('!', this.negation());
    }
    return this.ternary();
  }

  /**
   * logical ('?' expression ':' expression)?
   */

  ternary() {
    var node = this.logical();
    if (this.accept('?')) {
      var trueExpr = this.expression();
      this.expect(':');
      var falseExpr = this.expression();
      node = new nodes.Ternary(node, trueExpr, falseExpr);
    }
    return node;
  }

  /**
   * typecheck (('&&' | '||') typecheck)*
   */

  logical() {
    var op
      , node = this.typecheck();
    while (op = this.accept('&&') || this.accept('||')) {
      if (!node) this.error('illegal unary "' + op + '", missing left-hand operand');
      node = new nodes.BinOp(op.type, node, this.rightOperand(op, this.typecheck()));
    }
    return node;
  }

  /**
   * equality ('is a' equality)*
   */

  typecheck() {
    var op
      , node = this.equality();
    while (op = this.accept('is a')) {
      this.operand = true;
      if (!node) this.error('illegal unary "' + op + '", missing left-hand operand');
      node = new nodes.BinOp(op.type, node, this.rightOperand(op, this.equality()));
      this.operand = false;
    }
    return node;
  }

  /**
   * in (('==' | '!=') in)*
   */

  equality() {
    var op
      , node = this.in();
    while (op = this.accept('==') || this.accept('!=')) {
      this.operand = true;
      if (!node) this.error('illegal unary "' + op + '", missing left-hand operand');
      node = new nodes.BinOp(op.type, node, this.rightOperand(op, this.in()));
      this.operand = false;
    }
    return node;
  }

  /**
   * relational ('in' relational)*
   */

  in() {
    var node = this.relational();
    // CSS color interpolation, e.g. `to right in oklab`: `in` is a keyword
    if (this.isColorInterpolation()) {
      this.next();
      var literal = new nodes.Literal('in');
      if (!node) return literal;
      this.stash.push(new Token('literal', literal));
      return node;
    }
    while (this.accept('in')) {
      this.operand = true;
      if (!node) this.error('illegal unary "in", missing left-hand operand');
      node = new nodes.BinOp('in', node, this.rightOperand('in', this.relational()));
      this.operand = false;
    }
    return node;
  }

  /**
   * range (('>=' | '<=' | '>' | '<') range)*
   */

  relational() {
    var op
      , node = this.range();
    while (op =
      this.accept('>=')
      || this.accept('<=')
      || this.accept('<')
      || this.accept('>')
    ) {
      this.operand = true;
      if (!node) this.error('illegal unary "' + op + '", missing left-hand operand');
      node = new nodes.BinOp(op.type, node, this.rightOperand(op, this.range()));
      this.operand = false;
    }
    return node;
  }

  /**
   * additive (('..' | '...') additive)*
   */

  range() {
    var op
      , node = this.additive();
    if (op = this.accept('...') || this.accept('..')) {
      this.operand = true;
      if (!node) this.error('illegal unary "' + op + '", missing left-hand operand');
      node = new nodes.BinOp(op.val, node, this.rightOperand(op, this.additive()));
      this.operand = false;
    }
    return node;
  }

  /**
   * multiplicative (('+' | '-') multiplicative)*
   */

  additive() {
    var op
      , node = this.multiplicative();
    while (op = this.accept('+') || this.accept('-')) {
      this.operand = true;
      node = new nodes.BinOp(op.type, node, this.rightOperand(op, this.multiplicative()));
      this.operand = false;
    }
    return node;
  }

  /**
   * defined (('**' | '*' | '/' | '%') defined)*
   */

  multiplicative() {
    var op
      , node = this.defined();
    while (op =
      this.accept('**')
      || this.accept('*')
      || this.accept('/')
      || this.accept('%')) {
      this.operand = true;
      if ('/' == op && ((this.inProperty && !this.parens)
        || (this.slashLiteral && this.slashLiteral == this.parens))) {
        this.stash.push(new Token('literal', new nodes.Literal('/')));
        this.operand = false;
        return node;
      } else {
        if (!node) this.error('illegal unary "' + op + '", missing left-hand operand');
        node = new nodes.BinOp(op.type, node, this.rightOperand(op, this.defined()));
        this.operand = false;
      }
    }
    return node;
  }

  /**
   *    unary 'is defined'
   *  | unary
   */

  defined() {
    var node = this.unary();
    if (this.accept('is defined')) {
      if (!node) this.error('illegal unary "is defined", missing left-hand operand');
      node = new nodes.BinOp('is defined', node);
    }
    return node;
  }

  /**
   *   ('!' | '~' | '+' | '-') unary
   * | subscript
   */

  unary() {
    var op
      , node;
    if (op =
      this.accept('!')
      || this.accept('~')
      || this.accept('+')
      || this.accept('-')) {
      this.operand = true;
      node = this.unary();
      if (!node) this.error('illegal unary "' + op + '"');
      node = new nodes.UnaryOp(op.type, node);
      this.operand = false;
      return node;
    }
    return this.subscript();
  }

  /**
   *   member ('[' expression ']')+ '='?
   * | member
   */

  subscript() {
    var node = this.member()
      , id;
    while (!this.isGridLineNames() && this.accept('[')) {
      node = new nodes.BinOp('[]', node, this.expression());
      this.expect(']');
    }
    // TODO: TernaryOp :)
    if (this.accept('=')) {
      if (!node) this.error('illegal unary "=", missing left-hand operand');
      node.op += '=';
      node.val = this.list();
      // @block support
      if (node.val.isEmpty) this.assignAtblock(node.val);
    }
    return node;
  }

  /**
   *   primary ('.' id)+ '='?
   * | primary
   */

  member() {
    var node = this.primary();
    if (node) {
      while (this.accept('.')) {
        var id = new nodes.Ident(this.expect('ident').val.string);
        node = new nodes.Member(node, id);
      }
      this.skipSpaces();
      if (this.accept('=')) {
        node.val = this.list();
        // @block support
        if (node.val.isEmpty) this.assignAtblock(node.val);
      }
    }
    return node;
  }

  /**
   *   '{' '}'
   * | '{' pair (ws pair)* '}'
   */

  object() {
    var obj = new nodes.Object
      , id, val, comma, hash;
    this.expect('{');
    this.skipWhitespace();

    while (!this.accept('}')) {
      if (this.accept('comment')
        || this.accept('newline')) continue;

      if (!comma) this.accept(',');
      id = this.accept('ident') || this.accept('string');

      if (!id) {
        this.error('expected "ident" or "string", got {peek}');
      }

      hash = id.val.hash;

      this.skipSpacesAndComments();
      this.expect(':');

      val = this.expression();

      obj.setValue(hash, val);
      obj.setKey(hash, id.val);

      comma = this.accept(',');
      this.skipWhitespace();
    }

    return obj;
  }

  /**
   *   unit
   * | null
   * | color
   * | string
   * | ident
   * | boolean
   * | literal
   * | object
   * | atblock
   * | atrule
   * | '(' expression ')' '%'?
   */

  primary() {
    var tok;
    this.skipSpaces();

    // Parenthesis
    if (this.accept('(')) {
      ++this.parens;
      var expr = this.expression()
        , paren = this.expect(')');
      --this.parens;
      if (this.accept('%')) expr.push(new nodes.Ident('%'));
      tok = this.peek();
      // (1 + 2)px, (1 + 2)em, etc.
      if (!paren.space
        && 'ident' == tok.type
        && ~units.indexOf(tok.val.string)) {
        expr.push(new nodes.Ident(tok.val.string));
        this.next();
      }
      return expr;
    }

    // stashed literal, e.g. `/` in `a / [name] b`
    if (this.stash.length && 'literal' == this.stash[this.stash.length - 1].type) {
      return this.next().val;
    }

    tok = this.peek();

    // Primitive
    switch (tok.type) {
      case 'null':
      case 'unit':
      case 'color':
      case 'string':
      case 'literal':
      case 'boolean':
      case 'comment':
        return this.next().val;
      case !this.cond && '{':
        return this.object();
      case 'atblock':
        return this.atblock();
      // property lookup
      case 'atrule':
        var id = new nodes.Ident(this.next().val);
        id.property = true;
        return id;
      case 'ident':
        return this.ident();
      case 'function':
        return tok.anonymous
          ? this.functionDefinition()
          : this.functionCall();
      case '[':
        if (this.isGridLineNames()) return this.gridLineNames();
    }
  }

  /**
   * Return the right-hand operand `node` of the binary operator `op`,
   * failing with a parse error when it's missing, e.g. `a <` at the end
   * of a line, rather than with an internal error when evaluated.
   *
   * @param {Token|String} op
   * @param {Node} node
   * @return {Node}
   * @api private
   */

  rightOperand(op, node) {
    if (!node) {
      var name = 'string' == typeof op ? op : (op.val || op.type);
      this.error('illegal binary "' + name + '", missing right-hand operand');
    }
    return node;
  }

  /**
   * Check if the upcoming `in` is followed by a CSS color space,
   * e.g. `linear-gradient(in oklab, ...)`, `--space: in srgb`.
   *
   * @return {Boolean}
   * @api private
   */

  isColorInterpolation() {
    if ('in' != this.peek().type) return false;
    var i = 2
      , tok;
    while ('space' == (tok = this.lookahead(i)).type) ++i;
    return 'ident' == tok.type && !!~colorSpaces.indexOf(tok.val.name);
  }

  /**
   * Check if the upcoming `[` starts CSS grid line names
   * within a property value, e.g. `[full-start] 1fr [full-end]`,
   * rather than a subscript like `list[0]`.
   *
   * @return {Boolean}
   * @api private
   */

  isGridLineNames() {
    var tok = this.peek()
      , i = 2
      , type;
    if ('[' != tok.type || !tok.spaceBefore || !this.inProperty) return false;
    while (']' != (type = this.lookahead(i++).type)) {
      if ('ident' != type && 'space' != type) return false;
    }
    return true;
  }

  /**
   * '[' ident (space ident)* ']'
   */

  gridLineNames() {
    var names = [];
    this.expect('[');
    while (!this.accept(']')) {
      var tok = this.next();
      if ('ident' == tok.type) names.push(tok.val.name);
    }
    return new nodes.Literal('[' + names.join(' ') + ']');
  }
};
