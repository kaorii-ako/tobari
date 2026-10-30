import assert from "node:assert/strict";
import { parseCookies } from "../src/sidepanel/cookies.js";

const txt = [
  "# Netscape HTTP Cookie File",
  ".example.com\tTRUE\t/\tTRUE\t1999999999\tsid\tabc",
  "#HttpOnly_host.test\tFALSE\t/app\tFALSE\t0\tk\tv\tw",
  "",
].join("\n");
const [a, b] = parseCookies(txt);
assert.deepEqual(a, { url: "https://example.com/", name: "sid", value: "abc", path: "/", secure: true, httpOnly: false, domain: ".example.com", expirationDate: 1999999999 });
assert.deepEqual(b, { url: "http://host.test/app", name: "k", value: "v\tw", path: "/app", secure: false, httpOnly: true });

const [j] = parseCookies(JSON.stringify([
  { domain: "x.org", hostOnly: true, path: "/", secure: false, httpOnly: false, name: "n", value: "1", sameSite: "no_restriction", session: true },
]));
assert.deepEqual(j, { url: "http://x.org/", name: "n", value: "1", path: "/", secure: false, httpOnly: false });
console.log("cookies ok");
