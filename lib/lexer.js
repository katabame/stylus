
/*!
 * Stylus - Lexer
 * Copyright (c) Automattic <developer.wordpress.com>
 * MIT Licensed
 */

/**
 * Module dependencies.
 */

var Token = require('./token')
  , nodes = require('./nodes')
  , errors = require('./errors');

/**
 * Operator aliases.
 */

var alias = {
  'and': '&&'
  , 'or': '||'
  , 'is': '=='
  , 'isnt': '!='
  , 'is not': '!='
  , ':=': '?='
};

/**
 * Return the index of the `close` char balancing the
 * bracket opened just before `start` in `str`, or -1.
 * Nested brackets and quoted strings are skipped.
 *
 * @param {String} str
 * @param {Number} start
 * @param {String} close
 * @return {Number}
 * @api private
 */

function scanBalanced(str, start, close) {
  var stack = [close]
    , pairs = { '(': ')', '[': ']', '{': '}' }
    , quote = null
    , ch;
  for (var i = start, len = str.length; i < len; ++i) {
    ch = str[i];
    if (quote) {
      if ('\\' == ch) ++i;
      else if (quote == ch) quote = null;
    } else if ('"' == ch || "'" == ch) {
      quote = ch;
    } else if (pairs[ch]) {
      stack.push(pairs[ch]);
    } else if (ch == stack[stack.length - 1]) {
      stack.pop();
      if (!stack.length) return i;
    } else if (')' == ch || ']' == ch || '}' == ch) {
      return -1;
    }
  }
  return -1;
}

/**
 * Join the lines of CSS declarations whose value spans several lines
 * without commas, ended by `;` (as in CSS, not in the indented syntax):
 *
 *     --highlight:
 *       0 0 0
 *       var(--size);
 *
 * The continuation lines must be more indented than the declaration,
 * not look like declarations themselves, and end with `;`.
 *
 * @param {String} str
 * @return {String}
 * @api private
 */

function joinDeclarationLines(str) {
  var lines = str.split('\n')
    , decl = /^([ \t]*)(?:--[-\w]+|[-a-zA-Z_][-\w]*)[ \t]*:(?:[ \t]|$)/
    , other = /^[ \t]*(?:(?:--[-\w]+|[-a-zA-Z_][-\w]*)[ \t]*:(?:[ \t]|$)|[{}@&]|\/\/)/
    , m, indent, end, j;
  for (var i = 0; i < lines.length; ++i) {
    if (!(m = decl.exec(lines[i]))) continue;
    if (/[;{},(]\s*$|\/\/|\{/.test(lines[i])) continue;
    indent = m[1].length;
    end = -1;
    for (j = i + 1; j < lines.length; ++j) {
      var line = lines[j];
      if (!line.trim()) break;
      if (/^[ \t]*/.exec(line)[0].length <= indent) {
        // a lone `;` closing the value
        if (/^[ \t]*;/.test(line)) end = j;
        break;
      }
      if (other.test(line) || /[{}]/.test(line)) break;
      if (/;\s*$/.test(line)) { end = j; break; }
    }
    if (-1 == end) continue;
    lines.splice(i, end - i + 1, lines.slice(i, end + 1).join('\r'));
  }
  return lines.join('\n');
}

/**
 * Join the lines of parenthesized expressions spanning several
 * lines, e.g. `calc(1px +\n  2px)`, replacing newlines with `\r`
 * which the lexer treats as a line continuation.
 *
 * @param {String} str
 * @return {String}
 * @api private
 */

function joinParenLines(str) {
  var out = ''
    , stack = []
    , quote = null
    , ch, end, depth;
  for (var i = 0, len = str.length; i < len; ++i) {
    ch = str[i];
    // only the lines of the innermost parens are joined, not those of
    // objects or blocks within them
    depth = '(' == stack[stack.length - 1];
    if ('\\' == ch) {
      out += ch + (str[++i] || '');
      continue;
    } else if (quote) {
      if (quote == ch || '\n' == ch) quote = null;
    } else if ('/' == ch && '*' == str[i + 1]) {
      end = str.indexOf('*/', i + 2);
      end = -1 == end ? len : end + 2;
      out += str.slice(i, end);
      i = end - 1;
      continue;
    } else if ('/' == ch && '/' == str[i + 1] && (!depth || /\s/.test(str[i - 1]))) {
      end = str.indexOf('\n', i);
      if (-1 == end) end = len;
      // drop line comments within parens, they would swallow the joined line
      if (!depth) out += str.slice(i, end);
      i = end - 1;
      continue;
    } else if ('"' == ch || "'" == ch) {
      quote = ch;
    } else if ('(' == ch || '{' == ch || '[' == ch) {
      stack.push(ch);
    } else if (')' == ch || '}' == ch || ']' == ch) {
      stack.pop();
    } else if ('\n' == ch && depth) {
      ch = '\r';
    }
    out += ch;
  }
  return out;
}

/**
 * Split `str` by `sep` at the top level (outside brackets and strings).
 *
 * @param {String} str
 * @param {String} sep
 * @return {Array}
 * @api private
 */

function splitTopLevel(str, sep) {
  var parts = []
    , start = 0
    , pairs = { '(': ')', '[': ']', '{': '}' }
    , close
    , ch;
  for (var i = 0; i < str.length; ++i) {
    ch = str[i];
    if ('"' == ch || "'" == ch) {
      close = str.indexOf(ch, i + 1);
      if (-1 == close) return null;
      i = close;
    } else if (pairs[ch]) {
      close = scanBalanced(str, i + 1, pairs[ch]);
      if (-1 == close) return null;
      i = close;
    } else if (sep == ch) {
      parts.push(str.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(str.slice(start));
  return parts;
}

/**
 * Parse the `<condition>: <value>` branches of a CSS `if()`.
 * Returns `null` when they can't be told apart.
 *
 * @param {String} str
 * @return {Array}
 * @api private
 */

function parseCssIfBranches(str) {
  var parts = splitTopLevel(str, ';')
    , branches = []
    , part, pos, m, end;
  if (!parts) return null;
  for (var i = 0; i < parts.length; ++i) {
    part = parts[i].trim();
    if (!part) continue;
    if (m = /^else\s*:/.exec(part)) {
      branches.push({ cond: 'else', value: part.slice(m[0].length).trim() });
      continue;
    }
    pos = 0;
    while (true) {
      m = /^\s*(?:not\s+)?(?:style|media|supports)\(/.exec(part.slice(pos));
      if (!m) return null;
      end = scanBalanced(part, pos + m[0].length, ')');
      if (-1 == end) return null;
      pos = end + 1;
      if (m = /^\s+(?:and|or)\s+/.exec(part.slice(pos))) {
        pos += m[0].length;
        continue;
      }
      if (m = /^\s*:/.exec(part.slice(pos))) break;
      return null;
    }
    branches.push({
      cond: part.slice(0, pos).trim(),
      value: part.slice(pos + m[0].length).trim()
    });
  }
  return branches;
}

exports = module.exports = class Lexer {
  /**
   * Initialize a new `Lexer` with the given `str` and `options`.
   *
   * @param {String} str
   * @param {Object} options
   * @api private
   */

  constructor(str, options) {
    options = options || {};
    this.stash = [];
    this.indentStack = [];
    this.indentRe = null;
    this.lineno = 1;
    this.column = 1;

    // HACK!
    function comment(str, val, offset, s) {
      var inComment = s.lastIndexOf('/*', offset) > s.lastIndexOf('*/', offset)
        , commentIdx = s.lastIndexOf('//', offset)
        , i = s.lastIndexOf('\n', offset)
        , double = 0
        , single = 0;

      if (~commentIdx && commentIdx > i) {
        while (i != offset) {
          if ("'" == s[i]) single ? single-- : single++;
          if ('"' == s[i]) double ? double-- : double++;

          if ('/' == s[i] && '/' == s[i + 1]) {
            inComment = !single && !double;
            break;
          }
          ++i;
        }
      }

      if (inComment) return str;

      // `--foo:` ending a line is an empty custom property,
      // unless its value is on the next, more indented, line
      if (':' == val) {
        var lineStart = s.lastIndexOf('\n', offset) + 1
          , prefix = s.slice(lineStart, offset);
        if (/^[ \t]*--[-\w]+[ \t]*$/.test(prefix)) {
          var indent = /^[ \t]*/.exec(prefix)[0].length
            , next = str.slice(str.lastIndexOf('\n') + 1).length;
          if (next <= indent) return str;
        }
      }

      return (val === ',' && /^[,\t\n]+$/.test(str)) ? str.replace(/\n/, '\r') : val + '\r';
    };

    // Remove UTF-8 BOM.
    if ('\uFEFF' == str.charAt(0)) str = str.slice(1);

    this.str = joinDeclarationLines(str
      .replace(/\s+$/, '\n')
      .replace(/\r\n?/g, '\n'))
      .replace(/\\ *\n/g, '\r')
      // join lines ending with `,`, `(` or `:`
      .replace(/([,(:](?!\/\/[^ ])) *(?:\/\/[^\n]*|\/\*.*?\*\/)?\n\s*/g, comment)
      // join lines starting with `,`, `)` or `;`
      .replace(/\s*\n[ \t]*([,);])/g, comment)
      // join lines ending with `and` / `or`, e.g. in `@supports` conditions
      .replace(/([\s)](?:and|or))[ \t]*\n\s*/g, '$1 \r');

    this.str = joinParenLines(this.str);
  };

  /**
     * Custom inspect.
     */

  inspect() {
    var tok
      , tmp = this.str
      , buf = [];
    while ('eos' != (tok = this.next()).type) {
      buf.push(tok.inspect());
    }
    this.str = tmp;
    return buf.concat(tok.inspect()).join('\n');
  }

  /**
   * Lookahead `n` tokens.
   *
   * @param {Number} n
   * @return {Object}
   * @api private
   */

  lookahead(n) {
    var fetch = n - this.stash.length;
    while (fetch-- > 0) this.stash.push(this.advance());
    return this.stash[--n];
  }

  /**
   * Consume the given `len`.
   *
   * @param {Number|Array} len
   * @api private
   */

  skip(len) {
    var chunk = len[0];
    len = chunk ? chunk.length : len;
    if (len) this.prevChar = this.str[len - 1];
    this.str = this.str.substr(len);
    if (chunk) {
      this.move(chunk);
    } else {
      this.column += len;
    }
  }

  /**
   * Move current line and column position.
   *
   * @param {String} str
   * @api private
   */

  move(str) {
    var lines = str.match(/\n/g)
      , idx = str.lastIndexOf('\n');

    if (lines) this.lineno += lines.length;
    this.column = ~idx
      ? str.length - idx
      : this.column + str.length;
  }

  /**
   * Fetch next token including those stashed by peek.
   *
   * @return {Token}
   * @api private
   */

  next() {
    var tok = this.stashed() || this.advance();
    this.prev = tok;
    return tok;
  }

  /**
   * Check if the current token is a part of selector.
   *
   * @return {Boolean}
   * @api private
   */

  isPartOfSelector() {
    var tok = this.stash[this.stash.length - 1] || this.prev;
    switch (tok && tok.type) {
      // #for
      case 'color':
        return 2 == tok.val.raw.length;
      // .or
      case '.':
      // [is]
      case '[':
        return true;
    }
    return false;
  }

  /**
   * Fetch next token.
   *
   * @return {Token}
   * @api private
   */

  advance() {
    var column = this.column
      , line = this.lineno
      , tok = this.pendingToken()
        || this.eos()
        || this.null()
        || this.sep()
        || this.customProperty()
        || this.cssIf()
        || this.cssType()
        || this.keyword()
        || this.urlchars()
        || this.comment()
        || this.newline()
        || this.escaped()
        || this.important()
        || this.literal()
        || this.anonFunc()
        || this.atrule()
        || this.function()
        || this.brace()
        || this.paren()
        || this.color()
        || this.string()
        || this.unit()
        || this.namedop()
        || this.boolean()
        || this.unicode()
        || this.ident()
        || this.op()
        || (function () {
          var token = this.eol();

          if (token) {
            column = token.column;
            line = token.lineno;
          }

          return token;
        }).call(this)
        || this.space()
        || this.selector();

    // no rule matched, e.g. an unclosed string
    if (!tok) {
      var ch = this.str[0];
      throw new errors.ParseError('"' == ch || "'" == ch
        ? 'unclosed string, missing ' + ch
        : 'unexpected ' + JSON.stringify(this.str.slice(0, 20)));
    }

    tok.lineno = line;
    tok.column = column;

    return tok;
  }

  /**
   * Lookahead a single token.
   *
   * @return {Token}
   * @api private
   */

  peek() {
    return this.lookahead(1);
  }

  /**
   * Return the next possibly stashed token.
   *
   * @return {Token}
   * @api private
   */

  stashed() {
    return this.stash.shift();
  }

  /**
   * EOS | trailing outdents.
   */

  eos() {
    if (this.str.length) return;
    if (this.indentStack.length) {
      this.indentStack.shift();
      return new Token('outdent');
    } else {
      return new Token('eos');
    }
  }

  /**
   * url char
   */

  urlchars() {
    var captures;
    if (!this.isURL) return;
    if (captures = /^[\/:@.;?&=*!,<>#%0-9]+/.exec(this.str)) {
      this.skip(captures);
      return new Token('literal', new nodes.Literal(captures[0]));
    }
  }

  /**
   * ';' [ \t]*
   */

  sep() {
    var captures;
    if (captures = /^;[ \t]*/.exec(this.str)) {
      this.skip(captures);
      return new Token(';');
    }
  }

  /**
   * '\r'
   */

  eol() {
    if ('\r' == this.str[0]) {
      ++this.lineno;
      this.skip(1);

      this.column = 1;
      while (this.space());

      return this.advance();
    }
  }

  /**
   * ' '+
   */

  space() {
    var captures;
    if (captures = /^([ \t]+)/.exec(this.str)) {
      this.skip(captures);
      return new Token('space');
    }
  }

  /**
   * '\\' . ' '*
   */

  escaped() {
    var captures;
    if (captures = /^\\(.)[ \t]*/.exec(this.str)) {
      var c = captures[1];
      this.skip(captures);
      return new Token('ident', new nodes.Literal(c));
    }
  }

  /**
   * '@css' ' '* '{' .* '}' ' '*
   */

  literal() {
    // HACK attack !!!
    var captures;
    if (captures = /^@css[ \t]*\{/.exec(this.str)) {
      this.skip(captures);
      var c
        , braces = 1
        , css = ''
        , node;
      while (c = this.str[0]) {
        this.str = this.str.substr(1);
        switch (c) {
          case '{': ++braces; break;
          case '}': --braces; break;
          case '\n':
          case '\r':
            ++this.lineno;
            break;
        }
        css += c;
        if (!braces) break;
      }
      css = css.replace(/\s*}$/, '');
      node = new nodes.Literal(css);
      node.css = true;
      return new Token('literal', node);
    }
  }

  /**
   * '!important' ' '*
   */

  important() {
    var captures;
    if (captures = /^!important[ \t]*/.exec(this.str)) {
      this.skip(captures);
      return new Token('ident', new nodes.Literal('!important'));
    }
  }

  /**
   * '{' | '}'
   */

  brace() {
    var captures;
    if (captures = /^([{}])/.exec(this.str)) {
      this.skip(1);
      var brace = captures[1];
      return new Token(brace, brace);
    }
  }

  /**
   * '(' | ')' ' '*
   */

  paren() {
    var captures;
    if (captures = /^([()])([ \t]*)/.exec(this.str)) {
      var paren = captures[1];
      this.skip(captures);
      if (')' == paren) this.isURL = false;
      var tok = new Token(paren, paren);
      tok.space = captures[2];
      return tok;
    }
  }

  /**
   * 'null'
   */

  null() {
    var captures
      , tok;
    if (captures = /^(null)\b[ \t]*/.exec(this.str)) {
      this.skip(captures);
      if (this.isPartOfSelector()) {
        tok = new Token('ident', new nodes.Ident(captures[0]));
      } else {
        tok = new Token('null', nodes.null);
      }
      return tok;
    }
  }

  /**
   *   'if'
   * | 'else'
   * | 'unless'
   * | 'return'
   * | 'for'
   * | 'in'
   */

  /**
   * Tokens queued by a rule emitting several tokens at once.
   */

  pendingToken() {
    if (!this.pending || !this.pending.length) return;
    var item = this.pending.shift();
    // line continuations within raw values
    this.lineno += (item.str.match(/\r/g) || []).length;
    this.skip([item.str]);
    return item.tok;
  }

  /**
   * Custom property with a value Stylus can't parse, kept as is,
   * e.g. `--foo: { a: b }` or `--list: [1, 2, 3]`.
   */

  customProperty() {
    var captures = /^(--[-\w]+)([ \t]*:[ \t]*)/.exec(this.str);
    if (!captures) return;

    var str = this.str
      , start = captures[0].length
      , raw = false
      , end = start
      , ch, close;

    while (end < str.length) {
      ch = str[end];
      if (';' == ch || '\n' == ch || '}' == ch || ')' == ch) break;
      if ('"' == ch || "'" == ch) {
        close = str.indexOf(ch, end + 1);
        if (-1 == close) return;
        end = close + 1;
      } else if ('(' == ch || '[' == ch || '{' == ch) {
        close = scanBalanced(str, end + 1, { '(': ')', '[': ']', '{': '}' }[ch]);
        if (-1 == close) return;
        if ('[' == ch) raw = true;
        // `{ a: b }`, `{}`, not Stylus interpolation `{expr}`
        if ('{' == ch && /^[^:;]*$/.test(str.slice(end + 1, close)) && str.slice(end + 1, close).trim()) {
          // interpolation
        } else if ('{' == ch) {
          raw = true;
        }
        end = close + 1;
      } else {
        ++end;
      }
    }
    // empty value at the end of the line, e.g. `--foo:` in indented syntax
    if (!raw && start == end && (end == str.length || '\n' == str[end])) {
      raw = true;
    }
    if (!raw) return;

    var value = str.slice(start, end)
      , trimmed = value.replace(/\s+$/, '').replace(/\r/g, ' ');
    this.skip(captures[1].length);
    this.pending = [
      { tok: new Token(':', ':'), str: captures[2] }
      , { tok: new Token('literal', new nodes.Literal(trimmed)), str: value }
    ];
    this.pending[0].tok.space = ' ';
    return new Token('ident', new nodes.Ident(captures[1]));
  }

  /**
   * CSS `if()` function, e.g. `if(style(--x: 1): red; else: blue)`,
   * distinguished from the Stylus `if` keyword by its conditions.
   */

  cssIf() {
    if (!/^if\([ \t]*(?:(?:not[ \t]+)?(?:style|media|supports)\(|else[ \t]*:)/.test(this.str)) return;
    var end = scanBalanced(this.str, 3, ')');
    if (-1 == end) return;
    var captures = /^[ \t]*/.exec(this.str.slice(end + 1))
      , raw = this.str.slice(0, end + 1)
      , node = new nodes.Literal(raw);
    this.skip(raw.length + captures[0].length);
    // branches whose values are evaluated as Stylus expressions
    node.cssIf = parseCssIfBranches(raw.slice(3, -1));
    return new Token('literal', node);
  }

  /**
   * CSS `type()` syntax function used by `attr()`, e.g. `type(<length>)`,
   * distinguished from the Stylus `type()` built-in by its argument.
   */

  cssType() {
    if (!/^type\([ \t]*[<*]/.test(this.str)) return;
    var end = scanBalanced(this.str, 5, ')');
    if (-1 == end) return;
    var captures = /^[ \t]*/.exec(this.str.slice(end + 1))
      , raw = this.str.slice(0, end + 1);
    this.skip(raw.length + captures[0].length);
    return new Token('literal', new nodes.Literal(raw));
  }

  keyword() {
    var captures
      , tok;
    if (captures = /^(return|if|else|unless|for|in)\b(?!-)[ \t]*/.exec(this.str)) {
      var keyword = captures[1];
      this.skip(captures);
      if (this.isPartOfSelector()) {
        tok = new Token('ident', new nodes.Ident(captures[0]));
      } else {
        tok = new Token(keyword, keyword);
      }
      return tok;
    }
  }

  /**
   *   'not'
   * | 'and'
   * | 'or'
   * | 'is'
   * | 'is not'
   * | 'isnt'
   * | 'is a'
   * | 'is defined'
   */

  namedop() {
    var captures
      , tok;
    if (captures = /^(not|and|or|is a|is defined|isnt|is not|is)(?!-)\b([ \t]*)/.exec(this.str)) {
      var op = captures[1];
      this.skip(captures);
      if (this.isPartOfSelector()) {
        tok = new Token('ident', new nodes.Ident(captures[0]));
      } else {
        op = alias[op] || op;
        tok = new Token(op, op);
      }
      tok.space = captures[2];
      return tok;
    }
  }

  /**
   *   ','
   * | '+'
   * | '+='
   * | '-'
   * | '-='
   * | '*'
   * | '*='
   * | '/'
   * | '/='
   * | '%'
   * | '%='
   * | '**'
   * | '!'
   * | '&'
   * | '&&'
   * | '||'
   * | '>'
   * | '>='
   * | '<'
   * | '<='
   * | '='
   * | '=='
   * | '!='
   * | '!'
   * | '~'
   * | '?='
   * | ':='
   * | '?'
   * | ':'
   * | '['
   * | ']'
   * | '.'
   * | '..'
   * | '...'
   */

  op() {
    var captures;
    if (captures = /^([.]{1,3}|&&|\|\||[!<>=?:]=|\*\*|[-+*\/%]=?|[,=?:!~<>&\[\]])([ \t]*)/.exec(this.str)) {
      var op = captures[1]
        , before = this.prevChar;
      this.skip(captures);
      op = alias[op] || op;
      var tok = new Token(op, op);
      tok.space = captures[2];
      // whitespace before `[`, e.g. grid line names `1fr [name]`
      if ('[' == op) tok.spaceBefore = !before || /\s/.test(before);
      this.isURL = false;
      return tok;
    }
  }

  /**
   * '@('
   */

  anonFunc() {
    var tok;
    if ('@' == this.str[0] && '(' == this.str[1]) {
      this.skip(2);
      tok = new Token('function', new nodes.Ident('anonymous'));
      tok.anonymous = true;
      return tok;
    }
  }

  /**
   * '@' (-(\w+)-)?[a-zA-Z0-9-_]+
   */

  atrule() {
    var captures;
    if (captures = /^@(?!apply)(?:-(\w+)-)?([a-zA-Z0-9-_]+)[ \t]*/.exec(this.str)) {
      this.skip(captures);
      var vendor = captures[1]
        , type = captures[2]
        , tok;
      switch (type) {
        case 'require':
        case 'import':
        case 'charset':
        case 'namespace':
        case 'media':
        case 'scope':
        case 'supports':
          return new Token(type);
        case 'document':
          return new Token('-moz-document');
        case 'block':
          return new Token('atblock');
        case 'extend':
        case 'extends':
          return new Token('extend');
        case 'keyframes':
          return new Token(type, vendor);
        default:
          return new Token('atrule', (vendor ? '-' + vendor + '-' + type : type));
      }
    }
  }

  /**
   * '//' *
   */

  comment() {
    // Single line
    if ('/' == this.str[0] && '/' == this.str[1]) {
      var end = this.str.indexOf('\n');
      if (-1 == end) end = this.str.length;
      this.skip(end);
      return this.advance();
    }

    // Multi-line
    if ('/' == this.str[0] && '*' == this.str[1]) {
      var end = this.str.indexOf('*/');
      if (-1 == end) end = this.str.length;
      var str = this.str.substr(0, end + 2)
        , lines = str.split(/\n|\r/).length - 1
        , suppress = true
        , inline = false;
      this.lineno += lines;
      this.skip(end + 2);
      // output
      if ('!' == str[2]) {
        str = str.replace('*!', '*');
        suppress = false;
      }
      if (this.prev && ';' == this.prev.type) inline = true;
      return new Token('comment', new nodes.Comment(str, suppress, inline));
    }
  }

  /**
   * 'true' | 'false'
   */

  boolean() {
    var captures;
    if (captures = /^(true|false)\b([ \t]*)/.exec(this.str)) {
      var val = new nodes.Boolean('true' == captures[1]);
      this.skip(captures);
      var tok = new Token('boolean', val);
      tok.space = captures[2];
      return tok;
    }
  }

  /**
   * 'U+' [0-9A-Fa-f?]{1,6}(?:-[0-9A-Fa-f]{1,6})?
   */

  unicode() {
    var captures;
    if (captures = /^u\+[0-9a-f?]{1,6}(?:-[0-9a-f]{1,6})?/i.exec(this.str)) {
      this.skip(captures);
      return new Token('literal', new nodes.Literal(captures[0]));
    }
  }

  /**
   * -*[_a-zA-Z$] [-\w\d$]* '('
   */

  function() {
    var captures;
    if (captures = /^(-*[_a-zA-Z$][-\w\d$]*)\(([ \t]*)/.exec(this.str)) {
      var name = captures[1];
      this.skip(captures);
      this.isURL = 'url' == name;
      this.isVar = 'var' == name;
      var tok = new Token('function', new nodes.Ident(name));
      tok.space = captures[2];
      return tok;
    }
  }

  /**
   * -*[_a-zA-Z$] [-\w\d$]*
   */

  ident() {
    var captures;
    // custom property names starting with a digit, e.g. `--00-l: 1` or
    // `var(--00-l)`, rather than a double negation like `--3px`
    if (captures = /^--\d[-\w$]*/.exec(this.str)) {
      var rest = this.str.slice(captures[0].length);
      if (/^[ \t]*:/.test(rest)
        || (this.isVar && '(' == this.prevChar)
        || (/^[),]/.test(rest) && !/^--\d+(?:\.\d+)?(?:%|[a-zA-Z]+)?$/.test(captures[0]))) {
        this.skip(captures);
        return new Token('ident', new nodes.Ident(captures[0]));
      }
    }
    if (captures = /^-*([_a-zA-Z$]|@apply)[-\w\d$]*/.exec(this.str)) {
      this.skip(captures);
      return new Token('ident', new nodes.Ident(captures[0]));
    }
  }

  /**
   * '\n' ' '+
   */

  newline() {
    var captures, re;

    // we have established the indentation regexp
    if (this.indentRe) {
      captures = this.indentRe.exec(this.str);
      // figure out if we are using tabs or spaces
    } else {
      // try tabs
      re = /^\n([\t]*)[ \t]*/;
      captures = re.exec(this.str);

      // nope, try spaces
      if (captures && !captures[1].length) {
        re = /^\n([ \t]*)/;
        captures = re.exec(this.str);
      }

      // established
      if (captures && captures[1].length) this.indentRe = re;
    }


    if (captures) {
      var tok
        , indents = captures[1].length;

      this.skip(captures);
      if (this.str[0] === ' ' || this.str[0] === '\t') {
        throw new errors.SyntaxError('Invalid indentation. You can use tabs or spaces to indent, but not both.');
      }

      // Blank line
      if ('\n' == this.str[0]) return this.advance();

      // Outdent
      if (this.indentStack.length && indents < this.indentStack[0]) {
        while (this.indentStack.length && this.indentStack[0] > indents) {
          this.stash.push(new Token('outdent'));
          this.indentStack.shift();
        }
        tok = this.stash.pop();
        // Indent
      } else if (indents && indents != this.indentStack[0]) {
        this.indentStack.unshift(indents);
        tok = new Token('indent');
        // Newline
      } else {
        tok = new Token('newline');
      }

      return tok;
    }
  }

  /**
   * '-'? (digit+ | digit* '.' digit+) unit
   */

  unit() {
    var captures;
    if (captures = /^(-)?(\d+\.\d+|\d+|\.\d+)(%|[a-zA-Z]+)?[ \t]*/.exec(this.str)) {
      this.skip(captures);
      var n = parseFloat(captures[2]);
      if ('-' == captures[1]) n = -n;
      var node = new nodes.Unit(n, captures[3]);
      node.raw = captures[0];
      return new Token('unit', node);
    }
  }

  /**
   * '"' [^"]+ '"' | "'"" [^']+ "'"
   */

  string() {
    var captures;
    if (captures = /^("[^"]*"|'[^']*')([ \t]*)/.exec(this.str)) {
      var str = captures[1]
        , quote = captures[0][0];
      this.skip(captures);
      str = str.slice(1, -1).replace(/\\n/g, '\n');
      var tok = new Token('string', new nodes.String(str, quote));
      // whitespace after the string, e.g. `[a="b" i]`
      if (captures[2]) tok.space = captures[2];
      return tok;
    }
  }

  /**
   * #rrggbbaa | #rrggbb | #rgba | #rgb | #nn | #n
   */

  color() {
    return this.rrggbbaa()
      || this.rrggbb()
      || this.rgba()
      || this.rgb()
      || this.nn()
      || this.n()
  }

  /**
   * #n
   */

  n() {
    var captures;
    if (captures = /^#([a-fA-F0-9]{1})[ \t]*/.exec(this.str)) {
      this.skip(captures);
      var n = parseInt(captures[1] + captures[1], 16)
        , color = new nodes.RGBA(n, n, n, 1);
      color.raw = captures[0];
      return new Token('color', color);
    }
  }

  /**
   * #nn
   */

  nn() {
    var captures;
    if (captures = /^#([a-fA-F0-9]{2})[ \t]*/.exec(this.str)) {
      this.skip(captures);
      var n = parseInt(captures[1], 16)
        , color = new nodes.RGBA(n, n, n, 1);
      color.raw = captures[0];
      return new Token('color', color);
    }
  }

  /**
   * #rgb
   */

  rgb() {
    var captures;
    if (captures = /^#([a-fA-F0-9]{3})[ \t]*/.exec(this.str)) {
      this.skip(captures);
      var rgb = captures[1]
        , r = parseInt(rgb[0] + rgb[0], 16)
        , g = parseInt(rgb[1] + rgb[1], 16)
        , b = parseInt(rgb[2] + rgb[2], 16)
        , color = new nodes.RGBA(r, g, b, 1);
      color.raw = captures[0];
      return new Token('color', color);
    }
  }

  /**
   * #rgba
   */

  rgba() {
    var captures;
    if (captures = /^#([a-fA-F0-9]{4})[ \t]*/.exec(this.str)) {
      this.skip(captures);
      var rgb = captures[1]
        , r = parseInt(rgb[0] + rgb[0], 16)
        , g = parseInt(rgb[1] + rgb[1], 16)
        , b = parseInt(rgb[2] + rgb[2], 16)
        , a = parseInt(rgb[3] + rgb[3], 16)
        , color = new nodes.RGBA(r, g, b, a / 255);
      color.raw = captures[0];
      return new Token('color', color);
    }
  }

  /**
   * #rrggbb
   */

  rrggbb() {
    var captures;
    if (captures = /^#([a-fA-F0-9]{6})[ \t]*/.exec(this.str)) {
      this.skip(captures);
      var rgb = captures[1]
        , r = parseInt(rgb.substr(0, 2), 16)
        , g = parseInt(rgb.substr(2, 2), 16)
        , b = parseInt(rgb.substr(4, 2), 16)
        , color = new nodes.RGBA(r, g, b, 1);
      color.raw = captures[0];
      return new Token('color', color);
    }
  }

  /**
   * #rrggbbaa
   */

  rrggbbaa() {
    var captures;
    if (captures = /^#([a-fA-F0-9]{8})[ \t]*/.exec(this.str)) {
      this.skip(captures);
      var rgb = captures[1]
        , r = parseInt(rgb.substr(0, 2), 16)
        , g = parseInt(rgb.substr(2, 2), 16)
        , b = parseInt(rgb.substr(4, 2), 16)
        , a = parseInt(rgb.substr(6, 2), 16)
        , color = new nodes.RGBA(r, g, b, a / 255);
      color.raw = captures[0];
      return new Token('color', color);
    }
  }

  /**
   * ^|[^\n,;]+
   */

  selector() {
    var captures;
    if (captures = /^\^|.*?(?=\/\/(?![^\[]*\])|[,\n{])/.exec(this.str)) {
      var selector = captures[0];
      this.skip(captures);
      return new Token('selector', selector);
    }
  }
};
