// Command bar maths: "12*(3+4)", "5 km in mi", "20 c to f". Offline, no eval: a small recursive-descent parser.
'use strict';
(function () {
  const FN = { sqrt: Math.sqrt, abs: Math.abs, round: Math.round, floor: Math.floor, ceil: Math.ceil, sin: Math.sin, cos: Math.cos, tan: Math.tan, ln: Math.log, log: Math.log10 };
  const CONST = { pi: Math.PI, e: Math.E };

  function evaluate(src) {
    const s = src.replace(/×/g, '*').replace(/÷/g, '/').replace(/,/g, '').replace(/(\d+\.?\d*)\s*%/g, '($1/100)');
    let i = 0;
    const peek = () => { while (s[i] === ' ') i++; return s[i]; };
    const fail = () => { throw new Error('bad'); };
    function num() {
      const m = /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(s.slice(i));
      if (m) { i += m[0].length; return parseFloat(m[0]); }
      const w = /^[a-z]+/i.exec(s.slice(i));
      if (!w) fail();
      const name = w[0].toLowerCase();
      i += name.length;
      if (name in CONST) return CONST[name];
      if (!(name in FN) || peek() !== '(') fail();
      i++;
      const v = expr();
      if (peek() !== ')') fail();
      i++;
      return FN[name](v);
    }
    function atom() {
      const c = peek();
      if (c === '-') { i++; return -atom(); }
      if (c === '+') { i++; return atom(); }
      if (c === '(') { i++; const v = expr(); if (peek() !== ')') fail(); i++; return v; }
      return num();
    }
    function pow() { const b = atom(); if (peek() === '^') { i++; return Math.pow(b, pow()); } return b; }
    function term() {
      let v = pow();
      for (let c = peek(); c === '*' || c === '/'; c = peek()) { i++; const r = pow(); v = c === '*' ? v * r : v / r; }
      return v;
    }
    function expr() {
      let v = term();
      for (let c = peek(); c === '+' || c === '-'; c = peek()) { i++; const r = term(); v = c === '+' ? v + r : v - r; }
      return v;
    }
    const v = expr();
    if (peek() !== undefined) fail();
    return v;
  }

  // unit → [kind, factor to the kind's base]. Temperature is handled apart.
  const U = {};
  const add = (kind, base, names) => { for (const [n, f] of Object.entries(names)) for (const a of n.split('|')) U[a] = [kind, f * base]; };
  add('length', 1, { 'm|meter|meters': 1, 'km|kilometer|kilometers': 1000, 'cm': 0.01, 'mm': 0.001, 'mi|mile|miles': 1609.344, 'ft|foot|feet': 0.3048, 'in|inch|inches': 0.0254, 'yd|yard|yards': 0.9144 });
  add('mass', 1, { 'kg': 1, 'g': 0.001, 'mg': 1e-6, 'lb|lbs|pound|pounds': 0.45359237, 'oz|ounce|ounces': 0.028349523125 });
  add('volume', 1, { 'l|liter|liters': 1, 'ml': 0.001, 'gal|gallon|gallons': 3.785411784, 'cup|cups': 0.2365882365 });
  add('data', 1, { 'b|byte|bytes': 1, 'kb': 1e3, 'mb': 1e6, 'gb': 1e9, 'tb': 1e12, 'kib': 1024, 'mib': 1048576, 'gib': 1073741824 });
  add('time', 1, { 's|sec|seconds': 1, 'min|minutes': 60, 'h|hr|hour|hours': 3600, 'day|days': 86400, 'week|weeks': 604800 });
  const TEMP = { c: [(x) => x, (x) => x], f: [(x) => (x - 32) * 5 / 9, (x) => x * 9 / 5 + 32], k: [(x) => x - 273.15, (x) => x + 273.15] };

  function convert(text) {
    const m = /^(-?[\d.]+)\s*°?([a-z]+)\s+(?:in|to|as)\s+°?([a-z]+)$/i.exec(text.trim());
    if (!m) return null;
    const n = parseFloat(m[1]), a = m[2].toLowerCase(), b = m[3].toLowerCase();
    if (a in TEMP && b in TEMP && (a.length === 1 || 0)) return { value: TEMP[b][1](TEMP[a][0](n)), unit: b.toUpperCase() === b ? b : '°' + b.toUpperCase() };
    const from = U[a], to = U[b];
    if (!from || !to || from[0] !== to[0]) return null;
    return { value: (n * from[1]) / to[1], unit: b };
  }

  const fmt = (v) => (Math.abs(v) >= 1e15 || (v !== 0 && Math.abs(v) < 1e-6) ? v.toExponential(6) : String(parseFloat(v.toPrecision(10))));

  // → {label, value} or null. A lone number is not an answer worth showing.
  function calc(text) {
    const t = text.trim();
    if (!t) return null;
    const c = convert(t);
    if (c) return Number.isFinite(c.value) ? { label: `${fmt(c.value)} ${c.unit}`, value: fmt(c.value) } : null;
    if (!/[-+*/^×÷%()]|sqrt|abs|sin|cos|tan|ln|log|round|floor|ceil/i.test(t) || /^[-+]?[\d.]+$/.test(t)) return null;
    try {
      const v = evaluate(t);
      return Number.isFinite(v) ? { label: `= ${fmt(v)}`, value: fmt(v) } : null;
    } catch { return null; }
  }

  if (typeof module !== 'undefined') module.exports = { calc };
  else window.Calc = { calc };
})();
