// Strips tracking parameters from a link: utm_*, fbclid, gclid and friends. Everything else stays.
'use strict';
(function () {
  const TRACK = /^(utm_.+|fbclid|gclid|dclid|gbraid|wbraid|msclkid|mc_eid|mc_cid|igshid|yclid|_hsenc|_hsmi|ref_src|spm|si)$/i;
  function clean(url) {
    let u;
    try { u = new URL(url); } catch { return url; }
    if (!/^https?:$/.test(u.protocol)) return url;
    for (const k of [...u.searchParams.keys()]) if (TRACK.test(k)) u.searchParams.delete(k);
    return u.toString();
  }
  if (typeof module !== 'undefined') module.exports = { clean };
  else window.Clean = { clean };
})();
