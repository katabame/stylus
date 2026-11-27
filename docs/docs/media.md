---
layout: default
permalink: docs/media.html
---

# @media

The `@media` queries work just as they do within regular CSS, but with Stylus's block notation:

```stylus
@media print
  #header
  #footer
    display none
```

Yielding:

```css
@media print {
  #header,
  #footer {
    display: none;
  }
}
```

## Media Query Bubbling

Media queries can be nested, too, and they will be expanded to wrap the context in which they are used. For example:

```stylus
.widget
  padding 10px
  
  @media screen and (min-width: 600px)
    padding 20px
```

Yielding:

```css
.widget {
  padding: 10px;
}

@media screen and (min-width: 600px) {
  .widget {
    padding: 20px;
  }
}
```

## Nested media queries

You can nest `@media`s one into another and they would combine into one:

```stylus
@media (max-width: 500px)
  .foo
    color: #000

  @media (min-width: 100px), (min-height: 200px)
    .foo
      color: #100
```

Would yield to

```css
@media (max-width: 500px) {
  .foo {
    color: #000;
  }
}
@media (max-width: 500px) and (min-width: 100px), (max-width: 500px) and (min-height: 200px) {
  .foo {
    color: #100;
  }
}
```

## Interpolations and variables

You can use both interpolations and variables inside media queries, so it is possible to do things like this:

```stylus
foo = 'width'
bar = 30em
@media (max-{foo}: bar)
  body
    color #fff
```

This would yield

```stylus
@media (max-width: 30em) {
  body {
    color: #fff;
  }
}
```

It is also possible to use expressions inside MQ:

```stylus
.foo
  for i in 1..4
    @media (min-width: 2**(i+7)px)
      width: 100px*i
```

would yield to

```css
@media (min-width: 256px) {
  .foo {
    width: 100px;
  }
}
@media (min-width: 512px) {
  .foo {
    width: 200px;
  }
}
@media (min-width: 1024px) {
  .foo {
    width: 300px;
  }
}
@media (min-width: 2048px) {
  .foo {
    width: 400px;
  }
}
```

## Range syntax and conditions

The range syntax of Media Queries Level 4 is supported, with variables and expressions in its values (the feature name is kept as is):

```stylus
bp = 600px

@media (width >= bp) and (400px <= height < 800px)
  .a
    color red
```

As well as `or`, `not` and nested conditions:

```stylus
@media (width < 400px) or (width > 800px)
  .b
    color red

@media screen and (not (hover: hover))
  .c
    color red
```

When merged with a nested media query, `or` conditions are wrapped in parens: `((width < 400px) or (hover)) and (min-width: 5px)`.
