const assert = require('assert');
const { clean } = require('../ui/clean.js');
assert.strictEqual(clean('https://a.com/p?id=3&utm_source=x&fbclid=y'), 'https://a.com/p?id=3');
assert.strictEqual(clean('https://a.com/p?utm_medium=x'), 'https://a.com/p');
assert.strictEqual(clean('https://a.com/p?q=cats#top'), 'https://a.com/p?q=cats#top');
assert.strictEqual(clean('tobari://about/?utm_x=1'), 'tobari://about/?utm_x=1');
assert.strictEqual(clean('not a url'), 'not a url');
console.log('clean: PASS');
