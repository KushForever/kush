// Фоновая функция (до 15 минут): публикует в Instagram ролики из content/posts.json.
// Переменные в Netlify:
//   IG_USER_ID — id профессионального аккаунта Instagram
//   IG_TOKEN   — долгоживущий токен (Instagram API with Instagram Login, права instagram_business_basic и instagram_business_content_publish)
//   IG_HOST    — необязательно: graph.instagram.com (по умолчанию) или graph.facebook.com
// Без IG_* ролик просто приходит тебе в Telegram, чтобы выложить вручную.
const TG = process.env.TG_BOT_TOKEN || "", ADMIN = process.env.TG_ADMIN_ID || "", SECRET = process.env.TG_SECRET || "";
const IG_ID = process.env.IG_USER_ID || "", IG_TOKEN = process.env.IG_TOKEN || "";
const IG = "https://" + (process.env.IG_HOST || "graph.instagram.com") + "/v25.0";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const esc = (s) => String(s || "").replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]);

async function tg(method, payload) {
  if (!TG || !ADMIN) return {};
  try { const r = await fetch(`https://api.telegram.org/bot${TG}/${method}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) }); return await r.json(); } catch (_) { return {}; }
}
async function ig(path, params = {}, method = "GET") {
  const u = new URL(IG + path);
  const body = new URLSearchParams({ ...params, access_token: IG_TOKEN });
  if (method === "GET") { body.forEach((v, k) => u.searchParams.set(k, v)); }
  const r = await fetch(u, method === "GET" ? {} : { method, body });
  return r.json();
}
const mskDate = () => new Date(Date.now() + 3 * 3600e3).toISOString().slice(0, 10);
const head = (c) => String(c || "").split("\n")[0].trim().slice(0, 60);

export default async function handler(req) {
  if (req.headers.get("x-kush-secret") !== SECRET || !SECRET) return;
  const base = process.env.URL || "";
  let posts = [];
  try { posts = await (await fetch(base + "/content/posts.json?ts=" + Date.now())).json(); } catch (_) { return; }
  const today = mskDate();
  const due = (Array.isArray(posts) ? posts : []).filter((p) => p && p.video_url && p.caption && p.date && p.date <= today && p.date >= addDays(today, -2) && p.status !== "skip");
  if (!due.length) return;

  let recent = [];
  if (IG_ID && IG_TOKEN) {
    const r = await ig(`/${IG_ID}/media`, { fields: "caption,permalink,timestamp", limit: "15" });
    recent = (r.data || []).map((m) => head(m.caption));
  }
  for (const p of due) {
    if (recent.includes(head(p.caption))) continue;
    if (!IG_ID || !IG_TOKEN) {
      await tg("sendVideo", { chat_id: ADMIN, video: p.video_url, caption: ("Ролик дня для Instagram (автопостинг не настроен, выложи вручную):\n\n" + p.caption).slice(0, 1000) });
      continue;
    }
    const c = await ig(`/${IG_ID}/media`, { media_type: "REELS", video_url: p.video_url, caption: p.caption, share_to_feed: "true", is_ai_generated: "true" }, "POST");
    if (!c.id) { await tg("sendMessage", { chat_id: ADMIN, parse_mode: "HTML", text: "<b>Instagram: не удалось создать ролик</b>\n" + esc(JSON.stringify(c.error || c)).slice(0, 600) }); continue; }
    let status = "";
    for (let i = 0; i < 60; i++) { await sleep(10000); const s = await ig(`/${c.id}`, { fields: "status_code,status" }); status = s.status_code; if (status === "FINISHED" || status === "ERROR" || status === "EXPIRED") break; }
    if (status !== "FINISHED") { await tg("sendMessage", { chat_id: ADMIN, parse_mode: "HTML", text: "<b>Instagram: ролик не обработался</b> (" + esc(status || "нет ответа") + ")\n" + esc(head(p.caption)) }); continue; }
    const pub = await ig(`/${IG_ID}/media_publish`, { creation_id: c.id }, "POST");
    let link = "";
    if (pub.id) { const m = await ig(`/${pub.id}`, { fields: "permalink" }); link = m.permalink || ""; }
    await tg("sendMessage", { chat_id: ADMIN, parse_mode: "HTML", disable_web_page_preview: false,
      text: pub.id ? "✅ <b>Опубликовано в Instagram</b>\n" + esc(head(p.caption)) + (link ? "\n" + link : "") : "<b>Instagram: публикация не прошла</b>\n" + esc(JSON.stringify(pub.error || pub)).slice(0, 600) });
  }
}
function addDays(d, n) { const t = new Date(d + "T12:00:00Z"); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); }
