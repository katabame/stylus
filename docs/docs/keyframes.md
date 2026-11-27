---
layout: default
permalink: docs/keyframes.html
---

# @keyframes

Stylus supports `@keyframes` both with curly braces or without them, you can also use interpolation both in names or steps of @keyframes:

```stylus
$keyframe-name = pulse
@keyframes {$keyframe-name}
  for i in 0..10
    {10% * i}
      opacity (i/10)
```

Yielding (expanded prefixes ommited):

```css
@keyframes pulse {
  0% {
    opacity: 0;
  }
  20% {
    opacity: 0.2;
  }
  40% {
    opacity: 0.4;
  }
  60% {
    opacity: 0.6;
  }
  80% {
    opacity: 0.8;
  }
  100% {
    opacity: 1;
  }
}
```

## Expansion

`@keyframes` are expanded to the vendor prefixes defined by the `vendors` variable. Modern browsers need no prefix, so the default is `official`, the unprefixed syntax only:

```stylus
@keyframes foo {
  from {
    color: black
  }
  to {
    color: white
  }
}
```

Yielding:

```css
@keyframes foo {
  from {
    color: #000;
  }
  to {
    color: #fff;
  }
}
```

To support legacy browsers, alter `vendors` (the default of upstream Stylus):

```stylus
vendors = moz webkit o ms official
```

The `@keyframes` are then also output as `@-moz-keyframes`, `@-webkit-keyframes` and `@-o-keyframes` (IE never used a prefix for keyframes).
