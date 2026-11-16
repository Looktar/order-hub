// 订单协作系统 · Agent 与管理接口
// 地址：https://<项目>.supabase.co/functions/v1/api/...
//
// 身份：
//   - Agent：Authorization: Bearer oh_xxxxxxxx（个人令牌，在网页"设置"里生成）
//   - 网页：Authorization: Bearer <Supabase 登录凭证>
// 每个请求都以调用者本人的身份、在数据库行级权限之内执行：先切换到 authenticated 角色并设定用户 id，
// 再调用数据库里的函数。接口本身不做任何越权操作；只有建账号、存取照片文件、管理令牌这几步用到管理员密钥。
//
// 语言：?lang=zh|en|es，或请求头 X-Lang，否则用该用户在网页上设置的语言，默认中文。

import postgres from "npm:postgres@3.4.5";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";
import { type Lang, pickLang, t } from "./messages.ts";

const DB_URL = Deno.env.get("SUPABASE_DB_URL")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOGIN_DOMAIN = Deno.env.get("LOGIN_DOMAIN") ?? "users.order-hub.app";
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;
const DOCS = {
  zh: "https://raw.githubusercontent.com/Looktar/order-hub/main/AGENTS.md",
  en: "https://raw.githubusercontent.com/Looktar/order-hub/main/AGENTS.en.md",
  es: "https://raw.githubusercontent.com/Looktar/order-hub/main/AGENTS.es.md",
};

const sql = postgres(DB_URL, {
  prepare: false, max: 3, idle_timeout: 20,
  // 订单号等 bigint 按数字返回
  types: { bigint: { to: 20, from: [20], parse: (x: string) => Number(x), serialize: (x: number) => String(x) } },
});
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Caller = { userId: string; via: string; viaToken: boolean; lang: Lang };
type Profile = { id: string; name: string; role: "sales" | "company" | "driver"; is_admin: boolean; active: boolean; lang: Lang };

class HttpError extends Error {
  constructor(public status: number, public key: string, public params: Record<string, unknown> = {}) { super(key); }
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-agent-name, x-lang, apikey, x-client-info",
  "Access-Control-Allow-Methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body, null, 2), {
    status, headers: { ...cors, "Content-Type": "application/json; charset=utf-8" },
  });
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24));
  return "oh_" + Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function cleanVia(v: string | null | undefined) {
  return (v ?? "").replace(/[\r\n]/g, " ").trim().slice(0, 40);
}

function requestedLang(req: Request) {
  return new URL(req.url).searchParams.get("lang") || req.headers.get("x-lang");
}

async function identify(req: Request): Promise<Caller> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError(401, "missing_auth");
  const header = cleanVia(req.headers.get("x-agent-name"));

  let userId: string, via: string, viaToken: boolean;
  if (token.startsWith("oh_")) {
    const hash = await sha256(token);
    const rows = await sql`
      update public.agent_tokens t set last_used_at = now()
        from public.profiles p
       where t.token_hash = ${hash} and t.revoked_at is null and p.id = t.user_id and p.active
      returning t.user_id, t.label`;
    if (!rows.length) throw new HttpError(401, "bad_token");
    userId = rows[0].user_id; via = header || rows[0].label || "Agent"; viaToken = true;
  } else {
    const { data, error } = await admin.auth.getUser(token);
    if (error || !data.user) throw new HttpError(401, "session_expired");
    userId = data.user.id; via = header || "本人"; viaToken = false;
  }
  const p = await sql`select lang from public.profiles where id = ${userId}`;
  return { userId, via, viaToken, lang: pickLang(requestedLang(req), p[0]?.lang) };
}

// 以调用者身份执行：同一个事务里切换角色并设定用户 id，行级权限照常生效
function asUser<T>(c: Caller, fn: (tx: postgres.TransactionSql) => Promise<T>): Promise<T> {
  return sql.begin(async (tx) => {
    const claims = JSON.stringify({ sub: c.userId, role: "authenticated" });
    await tx`select set_config('request.jwt.claims', ${claims}, true),
                    set_config('request.jwt.claim.sub', ${c.userId}, true)`;
    await tx`set local role authenticated`;
    return await fn(tx);
  }) as Promise<T>;
}

async function profileOf(c: Caller): Promise<Profile> {
  const rows = await sql`select id, name, role, is_admin, active, lang from public.profiles where id = ${c.userId}`;
  if (!rows.length || !rows[0].active) throw new HttpError(403, "account_disabled");
  return rows[0] as unknown as Profile;
}

async function requireAdmin(c: Caller) {
  const p = await profileOf(c);
  if (!p.is_admin) throw new HttpError(403, "admin_only");
  return p;
}

async function body(req: Request): Promise<Record<string, unknown>> {
  if (!req.body) return {};
  try { return await req.json(); } catch { throw new HttpError(400, "bad_json"); }
}

function num(s: string) {
  if (!/^\d+$/.test(s)) throw new HttpError(400, "bad_number");
  return Number(s);
}

function loginToEmail(login: string) {
  const l = login.trim().toLowerCase();
  if (!/^[a-z0-9._@+-]{3,80}$/.test(l)) throw new HttpError(400, "login_chars");
  return l.includes("@") ? l : `${l}@${LOGIN_DOMAIN}`;
}

// ------------------------------------------------------------------ 路由
async function route(req: Request, setLang: (l: Lang) => void): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/api(?=\/|$)/, "").replace(/\/+$/, "") || "/";
  const m = req.method;
  const seg = path.split("/").filter(Boolean);

  if (path === "/" && m === "GET") {
    const l = pickLang(requestedLang(req), req.headers.get("accept-language"));
    return json({
      name: t(l, "api_name"),
      docs: DOCS[l],
      docs_all: DOCS,
      docs_page: "https://github.com/Looktar/order-hub/blob/main/AGENTS.md",
      languages: ["zh", "en", "es"],
      hint: t(l, "api_hint"),
    });
  }

  const c = await identify(req);
  setLang(c.lang);
  const L = c.lang;

  if (path === "/me" && m === "GET") {
    const p = await profileOf(c);
    return json({ ...p, via: c.via, reply_lang: L });
  }

  // 订单列表
  if (path === "/orders" && m === "GET") {
    const status = url.searchParams.get("status");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
    const rows = await asUser(c, (tx) => tx`
      select o.id, o.status, o.customer, o.address, o.due_date::text as due_date, o.has_issue, o.modified_by,
             o.created_at, o.updated_at, s.name as sales_name, d.name as driver_name,
             coalesce((select json_agg(json_build_object('id', i.id, 'category', i.category,
                       'category_label', app.category_i18n(i.category) ->> ${L}::text, 'spec', i.spec,
                       'qty', i.qty, 'unit', i.unit, 'original_qty', i.original_qty) order by i.position)
                       from public.order_items i where i.order_id = o.id and not i.removed), '[]') as items
        from public.orders o
        left join public.profiles s on s.id = o.sales_id
        left join public.profiles d on d.id = o.driver_id
       where (${status}::text is null or o.status::text = ${status})
       order by o.id desc limit ${limit}`);
    return json(rows);
  }

  if (path === "/orders" && m === "POST") {
    const b = await body(req);
    const [{ id }] = await asUser(c, (tx) => tx`select public.submit_order(${tx.json(b as never)}, ${c.via}) as id`);
    return json({ id, message: t(L, "submitted", { id }) }, 201);
  }

  if (seg[0] === "orders" && seg[1]) {
    const id = num(seg[1]);
    const action = seg.slice(2).join("/");

    if (!action && m === "GET") {
      const [{ d }] = await asUser(c, (tx) => tx`select public.order_detail(${id}, ${L}) as d`);
      if (!d) throw new HttpError(404, "order_not_found", { id });
      return json(d);
    }
    if (action === "changes" && m === "POST") {
      const b = await body(req);
      const changes = { fields: b.fields ?? {}, items: b.items ?? [] };
      const [{ n }] = await asUser(c, (tx) =>
        tx`select public.modify_order(${id}, ${tx.json(changes as never)}, ${(b.reason as string) ?? null}, ${c.via}) as n`);
      return json({ changed: n, message: t(L, "changed", { id, n }) });
    }
    if (action === "assign" && m === "POST") {
      const b = await body(req);
      let driverId = b.driver_id as string | undefined;
      if (!driverId && b.driver_name) {
        const found = await asUser(c, (tx) =>
          tx`select id from public.profiles where role = 'driver' and active and name = ${b.driver_name as string}`);
        if (found.length !== 1) throw new HttpError(400, "driver_ambiguous", { name: b.driver_name });
        driverId = found[0].id;
      }
      if (!driverId) throw new HttpError(400, "driver_required");
      await asUser(c, (tx) => tx`select public.assign_driver(${id}, ${driverId}, ${c.via})`);
      return json({ message: t(L, "assigned", { id }) });
    }
    if (action === "start" && m === "POST") {
      await asUser(c, (tx) => tx`select public.start_delivery(${id}, ${c.via})`);
      return json({ message: t(L, "started", { id }) });
    }
    if (action === "delivered" && m === "POST") {
      await asUser(c, (tx) => tx`select public.confirm_delivered(${id}, ${c.via})`);
      return json({ message: t(L, "delivered", { id }) });
    }
    if (action === "issue" && m === "POST") {
      const b = await body(req);
      await asUser(c, (tx) => tx`select public.report_issue(${id}, ${(b.note as string) ?? ""}, ${c.via})`);
      return json({ message: t(L, "issue_reported", { id }) });
    }
    if (action === "issue/resolve" && m === "POST") {
      const b = await body(req);
      await asUser(c, (tx) => tx`select public.resolve_issue(${id}, ${(b.note as string) ?? null}, ${c.via})`);
      return json({ message: t(L, "issue_resolved", { id }) });
    }
    // 上传照片：请求体直接是图片文件，?kind=order 或 signoff
    if (action === "photos" && m === "POST") {
      const kind = url.searchParams.get("kind") ?? "order";
      if (!["order", "signoff"].includes(kind)) throw new HttpError(400, "kind_invalid");
      const type = req.headers.get("content-type") ?? "";
      if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(type)) throw new HttpError(400, "photo_format");
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) throw new HttpError(400, "photo_size");
      const ext = type.split("/")[1].replace("jpeg", "jpg");
      const path = `${id}/${kind}/${crypto.randomUUID()}.${ext}`;
      const [{ pid }] = await asUser(c, async (tx) => {
        const r = await tx`select public.add_photo(${id}, ${kind}::public.photo_kind, ${path}, ${c.via}) as pid`;
        const up = await admin.storage.from("photos").upload(path, bytes, { contentType: type });
        if (up.error) throw new HttpError(500, "photo_save_failed");
        return r;
      });
      return json({ id: pid, path, message: t(L, "photo_uploaded") }, 201);
    }
  }

  // 照片下载：返回 10 分钟有效的链接
  if (seg[0] === "photos" && seg[1] && m === "GET") {
    const rows = await asUser(c, (tx) => tx`select path from public.order_photos where id = ${num(seg[1])}`);
    if (!rows.length) throw new HttpError(404, "photo_not_found");
    const { data, error } = await admin.storage.from("photos").createSignedUrl(rows[0].path, 600);
    if (error) throw new HttpError(500, "photo_save_failed");
    return json({ url: data.signedUrl, expires_in: 600 });
  }

  if (path === "/drivers" && m === "GET") {
    const rows = await asUser(c, (tx) =>
      tx`select id, name from public.profiles where role = 'driver' and active order by name`);
    return json(rows);
  }

  // 通知
  if (path === "/notifications" && m === "GET") {
    const all = url.searchParams.get("all") === "1";
    const rows = await asUser(c, (tx) => tx`select * from public.my_notifications(${!all}, 100, ${L})`);
    return json(rows);
  }
  if (path === "/notifications/read" && m === "POST") {
    const b = await body(req);
    const ids = Array.isArray(b.ids) ? (b.ids as number[]).map(Number) : null;
    const [{ n }] = await asUser(c, (tx) => tx`select public.mark_read(${ids}::bigint[]) as n`);
    return json({ marked: n });
  }

  // 我的 Agent 令牌
  if (path === "/tokens" && m === "GET") {
    const rows = await sql`select id, label, created_at, last_used_at from public.agent_tokens
                            where user_id = ${c.userId} and revoked_at is null order by id`;
    return json(rows);
  }
  if (path === "/tokens" && m === "POST") {
    if (c.viaToken) throw new HttpError(403, "token_by_web_only");
    await profileOf(c);
    const b = await body(req);
    const label = cleanVia((b.label as string) || "Agent") || "Agent";
    const token = newToken();
    await sql`insert into public.agent_tokens (user_id, token_hash, label) values (${c.userId}, ${await sha256(token)}, ${label})`;
    return json({ token, label, message: t(L, "token_created") }, 201);
  }
  if (seg[0] === "tokens" && seg[1] && m === "DELETE") {
    const r = await sql`update public.agent_tokens set revoked_at = now()
                         where id = ${num(seg[1])} and user_id = ${c.userId} and revoked_at is null returning id`;
    if (!r.length) throw new HttpError(404, "token_not_found");
    return json({ message: t(L, "token_revoked") });
  }

  // ---------------------------------------------------------------- 管理员
  if (seg[0] === "admin") {
    await requireAdmin(c);
    if (c.viaToken) throw new HttpError(403, "admin_web_only");

    if (path === "/admin/users" && m === "GET") {
      const rows = await sql`select p.id, p.name, p.role, p.is_admin, p.active, p.login, p.lang, p.created_at,
                                    (select count(*) from public.agent_tokens t where t.user_id = p.id and t.revoked_at is null)::int as tokens
                               from public.profiles p order by p.role, p.name`;
      return json(rows);
    }
    if (path === "/admin/users" && m === "POST") {
      const b = await body(req);
      const name = String(b.name ?? "").trim();
      const role = String(b.role ?? "");
      const login = String(b.login ?? "").trim();
      const password = String(b.password ?? "");
      const lang = pickLang(b.lang as string, L);
      if (!name) throw new HttpError(400, "name_required");
      if (!["sales", "company", "driver"].includes(role)) throw new HttpError(400, "role_invalid");
      if (password.length < 8) throw new HttpError(400, "password_short");
      const email = loginToEmail(login);
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new HttpError(400, "create_user_failed", { reason: error?.message ?? "" });
      await sql`insert into public.profiles (id, name, role, is_admin, login, lang)
                values (${data.user.id}, ${name}, ${role}, ${b.is_admin === true}, ${login.toLowerCase()}, ${lang})`;
      return json({ id: data.user.id, message: t(L, "user_created", { name, login }) }, 201);
    }
    if (seg[1] === "users" && seg[2]) {
      const uid = seg[2];
      if (seg.length === 3 && m === "PATCH") {
        const b = await body(req);
        if (uid === c.userId && (b.active === false || b.is_admin === false)) throw new HttpError(400, "self_disable");
        if (b.lang != null && !["zh", "en", "es"].includes(String(b.lang))) throw new HttpError(400, "bad_lang");
        const r = await sql`update public.profiles set
              name = coalesce(${(b.name as string) ?? null}, name),
              role = coalesce(${(b.role as string) ?? null}::public.user_role, role),
              active = coalesce(${(b.active as boolean) ?? null}, active),
              is_admin = coalesce(${(b.is_admin as boolean) ?? null}, is_admin),
              lang = coalesce(${(b.lang as string) ?? null}, lang)
            where id = ${uid} returning id`;
        if (!r.length) throw new HttpError(404, "user_not_found");
        if (b.active === false) await sql`update public.agent_tokens set revoked_at = now() where user_id = ${uid} and revoked_at is null`;
        return json({ message: t(L, "updated") });
      }
      if (seg[3] === "password" && m === "POST") {
        const b = await body(req);
        if (String(b.password ?? "").length < 8) throw new HttpError(400, "password_short");
        const { error } = await admin.auth.admin.updateUserById(uid, { password: String(b.password) });
        if (error) throw new HttpError(400, "create_user_failed", { reason: error.message });
        return json({ message: t(L, "password_reset") });
      }
      if (seg[3] === "tokens" && seg[4] === "reset" && m === "POST") {
        const r = await sql`update public.agent_tokens set revoked_at = now() where user_id = ${uid} and revoked_at is null returning id`;
        return json({ revoked: r.length, message: t(L, "tokens_reset") });
      }
    }
  }

  throw new HttpError(404, "not_found", { path: `${m} ${path}` });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  let lang: Lang = pickLang(requestedLang(req));
  try {
    return await route(req, (l) => (lang = l));
  } catch (e) {
    if (e instanceof HttpError) return json({ error: t(lang, e.key, e.params), code: e.key }, e.status);
    // 数据库报错：hint 是错误代码，detail 是参数
    const err = e as { code?: string; message?: string; hint?: string; detail?: string };
    let params: Record<string, unknown> = {};
    try { params = err.detail ? JSON.parse(err.detail) : {}; } catch { /* 不是 JSON 就忽略 */ }
    const msg = err.hint ? t(lang, err.hint, params, err.message) : err.message;
    if (err.code === "42501") return json({ error: msg, code: err.hint ?? "forbidden" }, 403);
    if (err.code === "P0001" || err.code?.startsWith("22") || err.code?.startsWith("23")) {
      return json({ error: msg, code: err.hint ?? "bad_request" }, 400);
    }
    console.error(e);
    return json({ error: t(lang, "server_error"), code: "server_error" }, 500);
  }
});
