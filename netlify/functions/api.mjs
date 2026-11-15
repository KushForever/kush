// KUSH — бэкенд одним файлом. Зависимостей нет, работает на Netlify без сборки.
// Переменные окружения задаются в Netlify: Site configuration → Environment variables
//   TG_BOT_TOKEN   — токен бота от @BotFather
//   TG_ADMIN_ID    — твой chat id (бот скажет его по команде /myid)
//   TG_SECRET      — любая длинная строка, своя, для защиты вебхука и /setup
//   ANTHROPIC_API_KEY — необязательно: ключ Claude API. С ним ИИ разбирает пожелания и отвечает в поддержке
//   BOT_BOOKING    — необязательно: off выключает «Бот бронирует», гости звонят сами
//   AI_MODEL       — необязательно: модель, по умолчанию claude-haiku-5-5
import crypto from "node:crypto";

const TOKEN = process.env.TG_BOT_TOKEN || "";
const ADMIN = process.env.TG_ADMIN_ID || "";
const SECRET = process.env.TG_SECRET || "";
const AI_KEY = process.env.ANTHROPIC_API_KEY || "";
const AI_MODEL = process.env.AI_MODEL || "claude-haiku-5-5";
const API = (m) => `https://api.telegram.org/bot${TOKEN}/${m}`;

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });

async function tg(method, payload) {
  if (!TOKEN) return { ok: false, description: "TG_BOT_TOKEN не задан" };
  try {
    const r = await fetch(API(method), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    });
    return await r.json();
  } catch (e) {
    return { ok: false, description: String(e) };
  }
}

const esc = (s) =>
  String(s == null ? "" : s).replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" }[c]));
const cut = (s, n) => String(s == null ? "" : s).slice(0, n);

// Проверка подписи Telegram Mini App: данные точно от Telegram и не подделаны
function checkInitData(initData) {
  if (!initData || !TOKEN) return null;
  try {
    const p = new URLSearchParams(initData);
    const hash = p.get("hash");
    if (!hash) return null;
    p.delete("hash");
    const check = [...p.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `${k}=${v}`).join("\n");
    const key = crypto.createHmac("sha256", "WebAppData").update(TOKEN).digest();
    const mine = crypto.createHmac("sha256", key).update(check).digest("hex");
    if (mine.length !== hash.length) return null;
    if (!crypto.timingSafeEqual(Buffer.from(mine), Buffer.from(hash))) return null;
    const age = Date.now() / 1000 - Number(p.get("auth_date") || 0);
    if (!(age >= -300 && age < 86400)) return null;
    return JSON.parse(p.get("user") || "null");
  } catch (_) {
    return null;
  }
}

const who = (u) =>
  ({ date: "свидание", friends: "компания друзей", solo: "один" }[u] || "—");

function guestLine(user, tgUser) {
  const parts = [];
  if (user && user.name) parts.push(esc(cut(user.name, 40)));
  if (user && user.phone) parts.push(esc(cut(user.phone, 20)));
  if (tgUser) {
    const at = tgUser.username ? `@${esc(tgUser.username)}` : `id ${tgUser.id}`;
    parts.push(`Telegram: ${at}`);
  }
  return parts.join(", ") || "гость не представился";
}

// ---------- регистрация ----------
async function onRegister(body) {
  const tgUser = checkInitData(body.initData);
  const u = body.user || {};
  const text =
    `<b>Новая регистрация</b>\n` +
    `${guestLine(u, tgUser)}\n` +
    `Откуда: ${tgUser ? "Telegram" : "сайт"}`;
  const r = await tg("sendMessage", { chat_id: ADMIN, text, parse_mode: "HTML" });
  return json({ ok: !!r.ok });
}

// ---------- заявка на бронь ----------
async function onBooking(body) {
  if ((process.env.BOT_BOOKING || "").toLowerCase() === "off") return json({ ok: false, off: true });
  const tgUser = checkInitData(body.initData);
  const u = body.user || {};
  const f = body.form || {};
  const items = Array.isArray(body.items) ? body.items.slice(0, 10) : [];
  if (!items.length) return json({ ok: false, error: "нечего бронировать" }, 400);

  const n = Math.max(1, Math.min(50, Number(f.n) || 1));
  const head =
    `<b>Гость просит забронировать места</b>\n` +
    `Гость: ${guestLine(u, tgUser)}\n` +
    `Повод: ${who(f.who)}, ${n} чел.\n` +
    `${esc(cut(f.dateText || "Сегодня", 30))}, выход в ${esc(cut(f.startText, 10))}\n` +
    `Мест забронировать: ${items.length}\n\n` +
    `Гость нажал «Бот бронирует». Робот-звонарь ещё не подключён, поэтому звонишь ты: набери каждое место ниже и нажми результат. ` +
    (tgUser ? `Гостю сразу придёт ответ в Telegram.` : `Гость с сайта: результат сообщи ему по телефону.`) +
    `\n\nЕсли не хочешь получать такие заявки, поставь в Netlify переменную BOT_BOOKING = off.`;
  const first = await tg("sendMessage", { chat_id: ADMIN, text: head, parse_mode: "HTML" });
  if (!first.ok) return json({ ok: false, error: first.description || "Telegram не ответил" }, 502);

  const gid = tgUser ? String(tgUser.id) : "0";
  for (const it of items) {
    const phone = cut(it.phone, 24);
    const body2 =
      `<b><i>${esc(cut(it.name, 60))}</i></b>\n` +
      `${esc(cut(it.area, 80))}\n` +
      `<b>Бронь на ${esc(cut(it.time, 10))}</b>, ${n} чел., на имя ${esc(cut(u.name || "гость", 40))}\n` +
      // телефон отдельной строкой без скобок: Telegram сам сделает его кнопкой вызова
      (phone ? esc(phone.replace(/[^\d+]/g, "")) : `Телефона в базе нет`);
    await tg("sendMessage", {
      chat_id: ADMIN,
      text: body2,
      parse_mode: "HTML",
      link_preview_options: { is_disabled: true },
      reply_markup: {
        inline_keyboard: [[
          { text: "Забронировал", callback_data: `bk:ok:${gid}` },
          { text: "Мест нет", callback_data: `bk:no:${gid}` },
        ]],
      },
    });
  }
  return json({ ok: true, notified: items.length, canReply: gid !== "0" });
}

// ---------- поддержка и партнёрство ----------
async function onSupport(body) {
  const tgUser = checkInitData(body.initData);
  const text = cut(body.text, 1200).trim();
  if (!text) return json({ ok: false, error: "пустое сообщение" }, 400);
  const partner = body.kind === "partner";
  const hist = Array.isArray(body.history) ? body.history.slice(-6) : [];
  const talk = hist
    .filter((m) => m && typeof m.text === "string" && m.text !== text)
    .map((m) => (m.who === "me" ? "Гость: " : "Бот: ") + esc(cut(m.text, 200)))
    .join("\n");
  const msg =
    `<b>${partner ? "Партнёрство: заведение хочет в KUSH" : "Поддержка: нужен человек"}</b>\n` +
    `От: ${guestLine(body.user || {}, tgUser)}\n\n` +
    `${esc(text)}` +
    (talk && !partner ? `\n\n<i>До этого в чате:</i>\n${talk}` : "") +
    (tgUser ? `\n\n#id${tgUser.id}` : `\n\nГость с сайта, без Telegram: свяжись по телефону.`);
  const r = await tg("sendMessage", {
    chat_id: ADMIN, text: msg, parse_mode: "HTML",
    reply_markup: tgUser ? { inline_keyboard: [[{ text: "Ответить", callback_data: `rp:${tgUser.id}` }]] } : undefined,
  });
  return json({ ok: !!r.ok, canReply: !!tgUser });
}

// ---------- ИИ ----------
const aiHits = new Map();
function aiAllowed(ip) {
  const now = Date.now(), rec = aiHits.get(ip) || { n: 0, t: now };
  if (now - rec.t > 3600000) { rec.n = 0; rec.t = now; }
  rec.n++; aiHits.set(ip, rec);
  if (aiHits.size > 5000) aiHits.clear();
  return rec.n <= 40;
}
async function onAI(req, body, url) {
  if (!AI_KEY) return json({ ok: false, error: "no_ai" }, 503);
  const origin = req.headers.get("origin") || req.headers.get("referer") || "";
  if (!origin.includes(url.host)) return json({ ok: false, error: "чужой сайт" }, 403);
  const ip = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "?";
  if (!aiAllowed(ip)) return json({ ok: false, error: "слишком часто" }, 429);
  const prompt = cut(body.prompt, 14000);
  if (!prompt.trim()) return json({ ok: false, error: "пустой запрос" }, 400);
  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": AI_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({
        model: AI_MODEL,
        max_tokens: 700,
        system: "Отвечай только одним JSON-объектом, без текста до и после.",
        messages: [{ role: "user", content: prompt }],
      }),
    });
    const j = await r.json();
    const text = j && Array.isArray(j.content) ? j.content.map((c) => c.text || "").join("") : "";
    const a = text.indexOf("{"), b = text.lastIndexOf("}");
    if (a < 0 || b <= a) return json({ ok: false, error: (j && j.error && j.error.message) || "ИИ не ответил" }, 502);
    return json({ ok: true, json: JSON.parse(text.slice(a, b + 1)) });
  } catch (e) {
    return json({ ok: false, error: "ИИ недоступен" }, 502);
  }
}

// ---------- вебхук бота ----------
const PARTNER_MAIL = process.env.PARTNER_EMAIL || "kushcollabspb@gmail.com";
const ASK_SUPPORT = "Вопрос в поддержку KUSH";
const ASK_PARTNER = "Заявка заведения в KUSH";
const ASK_REPLY = "Ответ гостю";

function siteBase(req) {
  const u = new URL(req.url);
  return `https://${u.host}`;
}
function userName(u) {
  u = u || {};
  return cut([u.first_name, u.last_name].filter(Boolean).join(" ") || "гость", 60);
}
function startKeyboard(base) {
  return {
    inline_keyboard: [
      [{ text: "Собрать маршрут", web_app: { url: base } }],
      [{ text: "Задать вопрос", callback_data: "ask:sup" }, { text: "Как это работает", callback_data: "ask:how" }],
      [{ text: "Я представляю заведение", callback_data: "ask:partner" }],
    ],
  };
}
const HOW =
  "<b>Как устроен KUSH</b>\n\n" +
  "1. Отвечаешь на 4 вопроса: с кем идёшь, когда, бюджет и чего хочется. Можно голосом.\n" +
  "2. Получаешь маршрут на вечер: места, время, переходы и карта.\n" +
  "3. Бронируешь сам по открытым номерам или жмёшь «Запустить бота», и брони берём на себя.\n\n" +
  "Подтверждения приходят сюда, в этот чат.";

async function forwardToAdmin(msg, kind) {
  const u = msg.from || {};
  const chat = msg.chat.id;
  const who = esc(userName(u)) + (u.username ? ` @${esc(u.username)}` : "");
  const title = kind === "partner" ? "Заявка заведения" : kind === "support" ? "Вопрос в поддержку" : "Сообщение боту";
  const head = await tg("sendMessage", {
    chat_id: ADMIN,
    parse_mode: "HTML",
    text: `<b>${title}</b>\nОт: ${who}\n#id${chat}` + (msg.text ? `\n\n${esc(cut(msg.text, 3000))}` : ""),
    reply_markup: { inline_keyboard: [[{ text: "Ответить", callback_data: `rp:${chat}` }]] },
  });
  // фото, голосовые, файлы — пересылаем копией
  if (!msg.text) await tg("copyMessage", { chat_id: ADMIN, from_chat_id: chat, message_id: msg.message_id, reply_parameters: head.ok ? { message_id: head.result.message_id } : undefined });
  return head.ok;
}

async function replyToGuest(msg, gid) {
  const chat = msg.chat.id;
  let r;
  if (msg.text) r = await tg("sendMessage", { chat_id: gid, parse_mode: "HTML", text: `<b>Поддержка KUSH</b>\n${esc(cut(msg.text, 3500))}` });
  else r = await tg("copyMessage", { chat_id: gid, from_chat_id: chat, message_id: msg.message_id });
  await tg("sendMessage", {
    chat_id: chat,
    text: r.ok ? "Доставлено гостю." : "Не доставлено: " + (r.description === "Forbidden: bot was blocked by the user" ? "гость заблокировал бота" : r.description || "нет ответа"),
  });
}

async function onWebhook(req, body) {
  if (SECRET && req.headers.get("x-telegram-bot-api-secret-token") !== SECRET) return json({ ok: false }, 401);
  const base = siteBase(req);
  const msg = body.message;
  const cq = body.callback_query;

  if (cq) {
    const [kind, act, gid] = String(cq.data || "").split(":");
    const chat = cq.message ? cq.message.chat.id : cq.from.id;
    const isAdmin = String(cq.from && cq.from.id) === String(ADMIN);

    if (kind === "bk" && isAdmin) {
      const done = act === "ok";
      const lines = cq.message && cq.message.text ? cq.message.text.split("\n") : [];
      const title = lines[0] || "место";
      const tm = (/Бронь на (\d{1,2}:\d{2})/.exec(lines.join("\n")) || [])[1] || "";
      const place = `<b><i>${esc(title)}</i></b>` + (tm ? ` — <b>${esc(tm)}</b>` : "");
      await tg("answerCallbackQuery", { callback_query_id: cq.id, text: done ? "Отметил: забронировано" : "Отметил: не вышло" });
      if (cq.message) await tg("editMessageText", { chat_id: chat, message_id: cq.message.message_id, text: cq.message.text + "\n\n" + (done ? "✅ Забронировано" : "❌ Не получилось"), entities: cq.message.entities || undefined });
      if (gid && gid !== "0") {
        await tg("sendMessage", {
          chat_id: gid,
          parse_mode: "HTML",
          text: done
            ? `✅ <b>Бронь подтверждена</b>\n\n${place}\n\nЖдут тебя. Хорошего вечера!`
            : `😔 <b>Не получилось</b>\n\n${place}\nМест нет. Открой KUSH и выбери замену, это полминуты.`,
          reply_markup: done ? undefined : { inline_keyboard: [[{ text: "Открыть KUSH", web_app: { url: base } }]] },
        });
      }
      return json({ ok: true });
    }
    if (kind === "rp" && isAdmin) {
      await tg("answerCallbackQuery", { callback_query_id: cq.id });
      await tg("sendMessage", {
        chat_id: chat,
        text: `${ASK_REPLY} #id${act}\nНапиши ответ сюда. Можно текст, фото или голосовое.`,
        reply_markup: { force_reply: true, input_field_placeholder: "Ответ гостю" },
      });
      return json({ ok: true });
    }
    if (kind === "ask") {
      await tg("answerCallbackQuery", { callback_query_id: cq.id });
      if (act === "how") await tg("sendMessage", { chat_id: chat, parse_mode: "HTML", text: HOW, reply_markup: { inline_keyboard: [[{ text: "Собрать маршрут", web_app: { url: base } }]] } });
      if (act === "sup") await tg("sendMessage", { chat_id: chat, text: `${ASK_SUPPORT}\nНапиши одним сообщением, что случилось. Ответим здесь.`, reply_markup: { force_reply: true, input_field_placeholder: "Твой вопрос" } });
      if (act === "partner") await tg("sendMessage", { chat_id: chat, text: `${ASK_PARTNER}\nНапишите название, адрес и как с вами связаться. Или на почту: ${PARTNER_MAIL}`, reply_markup: { force_reply: true, input_field_placeholder: "Название, адрес, контакт" } });
      return json({ ok: true });
    }
    await tg("answerCallbackQuery", { callback_query_id: cq.id });
    return json({ ok: true });
  }

  if (!msg || !msg.chat || msg.chat.type !== "private") return json({ ok: true });
  const chat = msg.chat.id;
  const isAdmin = String(chat) === String(ADMIN);
  const t = (msg.text || "").trim();
  const cmd = t.startsWith("/") ? t.split(/[\s@]/)[0].toLowerCase() : "";
  const replyText = (msg.reply_to_message && (msg.reply_to_message.text || msg.reply_to_message.caption)) || "";

  // команды
  if (cmd === "/start" || cmd === "/menu") {
    const text = isAdmin
      ? `👋 Привет, ${esc(userName(msg.from))}!\n\nЭто пульт KUSH. Сюда приходят регистрации, заявки на бронь и вопросы гостей. Чтобы ответить гостю, жми «Ответить» под его сообщением.`
      : `👋 <b>Привет, ${esc(userName(msg.from))}!</b>\n\n` +
        `Я KUSH, твой гид по вечернему Питеру. Скажи, с кем идёшь, во сколько и на какой бюджет, и я соберу вечер за минуту:\n\n` +
        `🍽 рестораны, бары, бани и спа, шоу и прогулки рядом друг с другом\n` +
        `💸 средний чек каждого места и что там взять\n` +
        `📞 брони возьмём на себя, подтверждение придёт сюда\n\n` +
        `Жми <b>«Собрать маршрут»</b>, четыре вопроса, и вечер готов ✨`;
    await tg("sendMessage", {
      chat_id: chat,
      parse_mode: "HTML",
      text,
      reply_markup: startKeyboard(base),
    });
    return json({ ok: true });
  }
  if (cmd === "/route") {
    await tg("sendMessage", { chat_id: chat, text: "Открывай, 4 вопроса и маршрут готов.", reply_markup: { inline_keyboard: [[{ text: "Собрать маршрут", web_app: { url: base } }]] } });
    return json({ ok: true });
  }
  if (cmd === "/help") {
    await tg("sendMessage", { chat_id: chat, parse_mode: "HTML", text: HOW, reply_markup: startKeyboard(base) });
    return json({ ok: true });
  }
  if (cmd === "/support") {
    await tg("sendMessage", { chat_id: chat, text: `${ASK_SUPPORT}\nНапиши одним сообщением, что случилось. Ответим здесь.`, reply_markup: { force_reply: true, input_field_placeholder: "Твой вопрос" } });
    return json({ ok: true });
  }
  if (cmd === "/partner") {
    await tg("sendMessage", { chat_id: chat, text: `${ASK_PARTNER}\nНапишите название, адрес и как с вами связаться. Или на почту: ${PARTNER_MAIL}`, reply_markup: { force_reply: true, input_field_placeholder: "Название, адрес, контакт" } });
    return json({ ok: true });
  }
  if (cmd === "/myid") {
    await tg("sendMessage", { chat_id: chat, text: `Твой chat id: ${chat}` });
    return json({ ok: true });
  }

  // админ отвечает гостю: ответом на любое сообщение, где есть #id
  if (isAdmin) {
    const m = /#id(\d+)/.exec(replyText);
    if (m && !cmd) { await replyToGuest(msg, m[1]); return json({ ok: true }); }
    if (!cmd) {
      await tg("sendMessage", { chat_id: chat, text: "Не понял, кому это. Чтобы ответить гостю, нажми «Ответить» под его сообщением или ответь на него свайпом." });
    }
    return json({ ok: true });
  }

  // гость пишет боту
  if (cmd) {
    await tg("sendMessage", { chat_id: chat, text: "Такой команды нет. Вот что умею:", reply_markup: startKeyboard(base) });
    return json({ ok: true });
  }
  if (!ADMIN) return json({ ok: true });
  const kind = replyText.startsWith(ASK_PARTNER) ? "partner" : replyText.startsWith(ASK_SUPPORT) ? "support" : "msg";
  const ok = await forwardToAdmin(msg, kind);
  await tg("sendMessage", {
    chat_id: chat,
    text: ok ? (kind === "partner" ? "Спасибо, передал. Свяжемся с вами." : "Передал команде KUSH. Ответ придёт сюда.") : "Не получилось передать. Попробуй ещё раз чуть позже.",
  });
  return json({ ok: true });
}

// ---------- первичная настройка ----------
async function onSetup(url) {
  if (!SECRET || url.searchParams.get("secret") !== SECRET) return json({ ok: false, error: "нужен ?secret=" }, 401);
  const base = `https://${url.host}`;
  const me = await tg("getMe", {});
  const hook = await tg("setWebhook", {
    url: `${base}/api/tg`,
    secret_token: SECRET,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  const menu = await tg("setChatMenuButton", { menu_button: { type: "web_app", text: "Маршрут", web_app: { url: base } } });
  const pub = [
    { command: "start", description: "Главное меню" },
    { command: "route", description: "Собрать маршрут на любой день" },
    { command: "support", description: "Задать вопрос поддержке" },
    { command: "partner", description: "Для заведений: попасть в KUSH" },
    { command: "help", description: "Как это работает" },
  ];
  const cmds = await tg("setMyCommands", { commands: pub });
  if (ADMIN) await tg("setMyCommands", { commands: [...pub, { command: "myid", description: "Мой chat id" }], scope: { type: "chat", chat_id: Number(ADMIN) } });
  const desc = await tg("setMyDescription", {
    description: "👋 Привет! Я KUSH — гид по вечернему Питеру.\n\n🍽 Соберу маршрут на сегодня или любой другой день: рестораны, бары, бани и спа, шоу и прогулки рядом друг с другом.\n💸 Покажу средний чек и что взять.\n📞 Брони возьмём на себя.\n\nЖми «Старт» и поехали ✨",
  });
  await tg("setMyShortDescription", { short_description: "Маршрут по Питеру на любой день и брони без звонков. Сотрудничество: " + PARTNER_MAIL });
  return json({
    bot: me.ok ? me.result.username : me.description,
    webhook: hook.ok ? `${base}/api/tg` : hook.description,
    menuButton: menu.ok ? "готово" : menu.description,
    commands: cmds.ok ? "готово" : cmds.description,
    description: desc.ok ? "готово" : desc.description,
    adminSet: !!ADMIN,
  });
}

export default async function handler(req) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/(api|\.netlify\/functions\/api)/, "") || "/";

  if (path === "/health" || path === "/") {
    return json({
      ok: true,
      botToken: TOKEN ? "задан" : "НЕ ЗАДАН",
      ai: AI_KEY ? "включён" : "выключен (нет ANTHROPIC_API_KEY)",
      adminId: ADMIN ? "задан" : "НЕ ЗАДАН",
      secret: SECRET ? "задан" : "НЕ ЗАДАН",
      instagram: process.env.IG_USER_ID && process.env.IG_TOKEN ? "подключён" : "не подключён (ролики приходят в Telegram)",
    });
  }
  if (path === "/setup") return onSetup(url);

  // Проверка доставки: открой /api/test?secret=ТВОЙ_СЕКРЕТ
  if (path === "/test") {
    if (!SECRET || url.searchParams.get("secret") !== SECRET) return json({ ok: false, error: "нужен ?secret=" }, 401);
    if (!TOKEN) return json({ ok: false, error: "TG_BOT_TOKEN не задан" }, 503);
    if (!ADMIN) return json({ ok: false, error: "TG_ADMIN_ID не задан" }, 503);
    const r = await tg("sendMessage", { chat_id: ADMIN, text: "Проверка связи. Если ты видишь это сообщение, уведомления работают." });
    return json({
      sentTo: ADMIN,
      telegramOk: !!r.ok,
      telegramSays: r.ok ? "доставлено" : r.description || "нет ответа",
      hint: r.ok ? "всё хорошо" : "проверь TG_ADMIN_ID и что ты писал боту /start",
    });
  }

  if (req.method !== "POST") return json({ ok: false, error: "нужен POST" }, 405);
  let body = {};
  try {
    const raw = await req.text();
    if (raw.length > 20000) return json({ ok: false, error: "слишком большой запрос" }, 413);
    body = raw ? JSON.parse(raw) : {};
  } catch (_) {
    return json({ ok: false, error: "плохой JSON" }, 400);
  }

  if (path === "/tg") return onWebhook(req, body);
  if (path === "/ai") return onAI(req, body, url);
  if (!TOKEN || !ADMIN) return json({ ok: false, error: "бот не настроен" }, 503);
  if (path === "/register") return onRegister(body);
  if (path === "/booking") return onBooking(body);
  if (path === "/support") return onSupport(body);
  return json({ ok: false, error: "не знаю такой адрес" }, 404);
}
