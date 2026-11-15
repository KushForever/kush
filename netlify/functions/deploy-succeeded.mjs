// После каждой успешной публикации сайта запускаем фоновую выкладку роликов в Instagram.
// Ролики добавляются в content/posts.json (это делает ИИ-агент), Netlify пересобирает сайт, и этот хук срабатывает.
export default async function handler() {
  const base = process.env.URL || "";
  const secret = process.env.TG_SECRET || "";
  if (!base || !secret) return new Response("skip");
  try {
    await fetch(base + "/.netlify/functions/ig-publish-background", { method: "POST", headers: { "x-kush-secret": secret } });
  } catch (_) {}
  return new Response("ok");
}
