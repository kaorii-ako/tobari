// Parses cookie exports from other browsers into chrome.cookies.set details.
// Accepts Netscape cookies.txt (curl, yt-dlp, "Get cookies.txt") and the JSON
// array Cookie-Editor / EditThisCookie export.

type SameSite = "no_restriction" | "lax" | "strict" | "unspecified";

export interface CookieDetails {
  url: string;
  name: string;
  value: string;
  domain?: string;
  path: string;
  secure: boolean;
  httpOnly: boolean;
  sameSite?: SameSite;
  expirationDate?: number;
}

function build(
  rawDomain: string,
  hostOnly: boolean,
  path: string,
  secure: boolean,
  httpOnly: boolean,
  name: string,
  value: string,
  expires: number | undefined,
  sameSite?: SameSite
): CookieDetails {
  const host = rawDomain.replace(/^\./, "");
  const d: CookieDetails = {
    url: `${secure ? "https" : "http"}://${host}${path || "/"}`,
    name,
    value,
    path: path || "/",
    secure,
    httpOnly
  };
  if (!hostOnly) d.domain = rawDomain.startsWith(".") ? rawDomain : `.${rawDomain}`;
  if (expires && expires > 0) d.expirationDate = expires;
  // Chrome rejects SameSite=None without Secure.
  if (sameSite && !(sameSite === "no_restriction" && !secure)) d.sameSite = sameSite;
  return d;
}

function sameSiteOf(v: unknown): SameSite | undefined {
  const s = String(v ?? "").toLowerCase();
  if (s === "lax" || s === "strict") return s;
  if (s === "none" || s === "no_restriction") return "no_restriction";
  return undefined;
}

export function parseCookies(text: string): CookieDetails[] {
  const trimmed = text.trim();
  if (trimmed.startsWith("[")) {
    const arr = JSON.parse(trimmed) as Array<Record<string, unknown>>;
    return arr
      .filter((c) => typeof c.name === "string" && typeof c.domain === "string")
      .map((c) =>
        build(
          c.domain as string,
          c.hostOnly === true || !(c.domain as string).startsWith("."),
          (c.path as string) ?? "/",
          c.secure === true,
          c.httpOnly === true,
          c.name as string,
          String(c.value ?? ""),
          c.session === true ? undefined : Number(c.expirationDate ?? c.expires ?? 0),
          sameSiteOf(c.sameSite)
        )
      );
  }
  const out: CookieDetails[] = [];
  for (let line of trimmed.split(/\r?\n/)) {
    let httpOnly = false;
    if (line.startsWith("#HttpOnly_")) {
      httpOnly = true;
      line = line.slice("#HttpOnly_".length);
    } else if (line.startsWith("#") || !line.trim()) {
      continue;
    }
    const f = line.split("\t");
    if (f.length < 7) continue;
    const [domain, sub, path, secure, expires, name, ...rest] = f;
    out.push(
      build(domain, sub.toUpperCase() !== "TRUE", path, secure.toUpperCase() === "TRUE",
        httpOnly, name, rest.join("\t"), Number(expires))
    );
  }
  return out;
}
