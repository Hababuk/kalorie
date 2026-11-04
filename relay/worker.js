/* Kalorie search relay — a tiny Cloudflare Worker.
   The app can't read other websites itself (browsers block that), so this relay does it:
   it searches the web for a food's nutrition facts, opens the top results and sends back
   the short piece of text around "kcal" from each page. The app pulls the numbers out.

   Setup: Cloudflare dashboard → Workers & Pages → Create → "Start with Hello World" →
   Deploy → Edit code → replace everything with this file → Deploy.
   Optional: Settings → Variables → add TOKEN (any password) and put the same in the app.
*/
const ALLOWED_ORIGINS = ["https://hababuk.github.io"];
const UA = "Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36";
const SKIP = /(youtube\.|youtu\.be|facebook\.|instagram\.|tiktok\.|pinterest\.|twitter\.|x\.com|reddit\.|allegro\.|olx\.|duckduckgo\.|bing\.com|google\.)/i;
const MAX_PAGES = 5;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const allowed = ALLOWED_ORIGINS.concat((env.EXTRA_ORIGINS || "").split(",").map(s => s.trim()).filter(Boolean));
    const cors = {
      "Access-Control-Allow-Origin": allowed.includes(origin) ? origin : allowed[0],
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Vary": "Origin",
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    };
    if (request.method === "OPTIONS") return new Response(null, { headers: cors });
    const url = new URL(request.url);
    const reply = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: cors });

    if (env.TOKEN && url.searchParams.get("t") !== env.TOKEN) return reply({ error: "wrong token" }, 403);
    if (origin && !allowed.includes(origin)) return reply({ error: "origin not allowed" }, 403);
    const q = (url.searchParams.get("q") || "").trim().slice(0, 120);
    if (!q) return reply({ ok: true, hint: "add ?q=product" });

    const query = q + " kalorie wartości odżywcze 100 g";
    let results = [], engine = "", errors = [];
    for (const [name, fn] of [["duckduckgo", ddgHtml], ["duckduckgo-lite", ddgLite], ["bing", bing]]) {
      try {
        results = await fn(query);
        if (results.length) { engine = name; break; }
        errors.push(name + ": no results");
      } catch (e) { errors.push(name + ": " + (e.message || e)); }
    }
    if (!results.length) return reply({ q, error: "search engines didn't answer", details: errors }, 502);

    results = results.filter(r => !SKIP.test(r.url)).slice(0, MAX_PAGES);
    const pages = await Promise.all(results.map(async r => {
      let text = "";
      try { text = await nutritionWindow(r.url); } catch (e) { }
      return { title: r.title, url: r.url, host: hostOf(r.url), snippet: r.snippet, text };
    }));
    return reply({ q, engine, results: pages });
  },
};

/* ---------- search engines ---------- */
async function get(url, ms = 6000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), ms);
  try {
    const r = await fetch(url, { signal: ctl.signal, redirect: "follow", headers: { "User-Agent": UA, "Accept-Language": "pl-PL,pl;q=0.9,en;q=0.7", "Accept": "text/html,application/xhtml+xml" } });
    if (!r.ok) throw new Error("HTTP " + r.status);
    return await r.text();
  } finally { clearTimeout(t); }
}
/* split the page into one chunk per result, then read link, title and snippet inside each chunk */
function chunks(html, marker) { const parts = html.split(marker); parts.shift(); return parts; }
async function ddgHtml(q) {
  const html = await get("https://html.duckduckgo.com/html/?kl=pl-pl&q=" + encodeURIComponent(q));
  const out = [];
  for (const c of chunks(html, 'class="result__a"')) {
    const h = /href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(c); if (!h) continue;
    const sn = /class="result__snippet"[^>]*>([\s\S]*?)<\/(?:a|div|td)>/.exec(c);
    const u = ddgTarget(h[1]);
    if (u) out.push({ url: u, title: clean(h[2]), snippet: clean(sn ? sn[1] : "") });
    if (out.length >= 10) break;
  }
  return out;
}
async function ddgLite(q) {
  const html = await get("https://lite.duckduckgo.com/lite/?kl=pl-pl&q=" + encodeURIComponent(q));
  const out = [];
  for (const c of html.split(/<a(?=[^>]*class=['"]result-link['"])/).slice(1)) {
    const h = /href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(c); if (!h) continue;
    const sn = /class=['"]result-snippet['"][^>]*>([\s\S]*?)<\/td>/.exec(c);
    const u = ddgTarget(h[1]);
    if (u) out.push({ url: u, title: clean(h[2]), snippet: clean(sn ? sn[1] : "") });
    if (out.length >= 10) break;
  }
  return out;
}
async function bing(q) {
  const html = await get("https://www.bing.com/search?setlang=pl&cc=PL&q=" + encodeURIComponent(q));
  const out = [];
  for (const c of chunks(html, '<li class="b_algo"')) {
    const h = /<h2[^>]*>\s*<a[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/.exec(c); if (!h) continue;
    const sn = /<p[^>]*>([\s\S]*?)<\/p>/.exec(c);
    let u = decodeEntities(h[1]);
    const w = /[?&]u=a1([^&]+)/.exec(u);   // Bing sometimes wraps links: /ck/a?...&u=a1<base64url>
    if (w) { try { u = atob(w[1].replace(/-/g, "+").replace(/_/g, "/")); } catch (e) { } }
    if (/^https?:\/\//.test(u)) out.push({ url: u, title: clean(h[2]), snippet: clean(sn ? sn[1] : "") });
    if (out.length >= 10) break;
  }
  return out;
}
function ddgTarget(href) {
  href = decodeEntities(href);
  const m = /[?&]uddg=([^&]+)/.exec(href);
  if (m) { try { return decodeURIComponent(m[1]); } catch (e) { return null; } }
  if (href.startsWith("//")) href = "https:" + href;
  if (/^https?:\/\//.test(href) && !/duckduckgo\.com\/y\.js|ad_domain|ad_provider/.test(href)) return href;
  return null;
}

/* ---------- reading a result page cheaply ---------- */
async function nutritionWindow(url) {
  let html = await get(url, 5000);
  if (html.length > 400000) html = html.slice(0, 400000);
  // find the nutrition table without parsing the whole page (plain indexOf is very cheap)
  let i = -1;
  for (const key of ["Wartość energetyczna", "wartość energetyczna", "WARTOŚĆ ENERGETYCZNA", "Wartosc energetyczna", "Wartości odżywcze", "wartości odżywcze", "Nutrition", "kcal", "Kcal", "KCAL", "Energy", "Kal<"]) {
    const k = html.indexOf(key);
    if (k >= 0 && (i < 0 || k < i)) i = k;
  }
  if (i < 0) return "";
  const piece = html.slice(Math.max(0, i - 400), i + 5000);
  return clean(piece).slice(0, 1200);
}
function clean(s) {
  return decodeEntities(String(s || "")
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|td|th|h\d)>/gi, "\n")
    .replace(/<[^>]*>/g, " "))
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .trim();
}
function decodeEntities(s) {
  return String(s).replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n)).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16)));
}
function hostOf(u) { try { return new URL(u).hostname.replace(/^www\./, ""); } catch (e) { return ""; } }

export const _test = { ddgTarget, clean, nutritionWindow, ddgHtml, ddgLite, bing };
