# @katabame/stylus

A fork of [Stylus](https://github.com/stylus/stylus), the CSS preprocessor providing an efficient, dynamic, and expressive way to generate CSS. It supports both an indented syntax and regular CSS style, and aims to keep up with modern CSS.

Existing `.styl` files and Stylus plugins are intended to keep working.

## What's new compared to upstream Stylus

- Cascade layers: `@layer reset, base;`, `@layer name { ... }`
- `@container`, `@layer`, `@scope` and `@starting-style` can be nested in selectors and bubble up like `@media`
- CSS `@scope (.a) to (.b) { ... }` (the Stylus `@scope <selector>` directive still works when no block follows)
- Media query range syntax: `(width >= 600px)`, `(400px <= width < $max)`, `not (hover: hover)`
- `@supports selector(...)`
- Commas inside `:is()`, `:where()`, `:not()`, `:has()`, `:nth-child(... of ...)` are kept in a single selector
- CSS Color 4 syntax: `rgb(0 0 0 / 50%)`, `hsl(120deg 50% 50% / .5)`, `oklch(70% .1 200 / 50%)`, `color-mix(in srgb, red, blue)`, relative colors and `var()` / `none` channels
- CSS math functions shadowed by built-ins (`min()`, `max()`, `round()`, `abs()`...) are passed through to CSS when they can only be resolved by the browser, e.g. `min(100%, 500px)`
- Media Queries Level 4 conditions: `(a) or (b)`, `(not (a))`, and `and` / `or` / `not` in `@container`
- CSS `if()`: `color: if(style(--theme: dark): white; else: black)`
- Custom properties with arbitrary values: `--rules: { color: red }`, `--list: [1, 2, 3]`
- CSS grid line names: `grid-template-columns: [full-start] 1fr [full-end]`
- No legacy vendor prefixes: `@keyframes` are no longer duplicated as `@-moz-`, `@-webkit-` and `@-o-keyframes`. Set `vendors = moz webkit o ms official` to restore them

## Installation

```bash
$ npm install @katabame/stylus -g
```

## Basic Usage

Watch and compile a file from command line with

```bash
stylus -w style.styl -o style.css
```

From JavaScript:

```js
const stylus = require('@katabame/stylus');

stylus.render('.a\n  color: red', (err, css) => {
  if (err) throw err;
  console.log(css);
});
```

See the [Stylus documentation](https://stylus-lang.com/) for the language reference.

### Code of Conduct

Please note that this project is released with a [Contributor Code of Conduct](Code_of_Conduct.md). By participating in this project you agree to abide by its terms.

### Contribution

Please read our [Contribution Guide](Contributing.md) before making any pull requests to the project. Included are directions for opening issues, workflows, and coding standards.

## Credits

This project is a fork of [Stylus](https://github.com/stylus/stylus), created by [TJ Holowaychuk](https://github.com/tj) and developed by the [Stylus maintainers](https://github.com/orgs/stylus/people) and [contributors](https://github.com/stylus/stylus/graphs/contributors). Thank you to everyone who built Stylus.

## License

[MIT](LICENSE)

Copyright (c) 2026-present katabame
Copyright (c) 2010-present [TJ](https://github.com/tj) and [Stylus maintainers](https://github.com/orgs/stylus/people)
