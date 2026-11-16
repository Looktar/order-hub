// 订单协作系统 · Agent 与管理接口
// 地址：https://<项目>.supabase.co/functions/v1/api/...
//
// 身份：
//   - Agent：Authorization: Bearer oh_xxxxxxxx（个人令牌，在网页"我的 Agent 令牌"里生成）
//   - 网页：Authorization: Bearer <Supabase 登录凭证>
// 每个请求都以调用者本人的身份、在数据库行级权限之内执行：先切换到 authenticated 角色并设定用户 id，
// 再调用数据库里的函数。接口本身不做任何越权操作；只有建账号、存取照片文件、管理令牌这几步用到管理员密钥。

import postgres from "npm:postgres@3.4.5";
import { createClient } from "npm:@supabase/supabase-js@2.45.4";

const DB_URL = Deno.env.get("SUPABASE_DB_URL")!;
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const LOGIN_DOMAIN = Deno.env.get("LOGIN_DOMAIN") ?? "users.order-hub.app";
const MAX_PHOTO_BYTES = 5 * 1024 * 1024;

const sql = postgres(DB_URL, {
  prepare: false, max: 3, idle_timeout: 20,
  // 订单号等 bigint 按数字返回
  types: { bigint: { to: 20, from: [20], parse: (x: string) => Number(x), serialize: (x: number) => String(x) } },
});
const admin = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

type Caller = { userId: string; via: string; viaToken: boolean };
type Profile = { id: string; name: string; role: "sales" | "company" | "driver"; is_admin: boolean; active: boolean };

class HttpError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, x-agent-name, apikey, x-client-info",
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

async function identify(req: Request): Promise<Caller> {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new HttpError(401, "缺少 Authorization: Bearer <令牌>");
  const header = cleanVia(req.headers.get("x-agent-name"));

  if (token.startsWith("oh_")) {
    const hash = await sha256(token);
    const rows = await sql`
      update public.agent_tokens t set last_used_at = now()
        from public.profiles p
       where t.token_hash = ${hash} and t.revoked_at is null and p.id = t.user_id and p.active
      returning t.user_id, t.label`;
    if (!rows.length) throw new HttpError(401, "令牌无效、已作废，或账号已停用");
    return { userId: rows[0].user_id, via: header || rows[0].label || "Agent", viaToken: true };
  }

  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) throw new HttpError(401, "登录已过期，请重新登录");
  return { userId: data.user.id, via: header || "本人", viaToken: false };
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
  const rows = await sql`select id, name, role, is_admin, active from public.profiles where id = ${c.userId}`;
  if (!rows.length || !rows[0].active) throw new HttpError(403, "账号不存在或已停用");
  return rows[0] as unknown as Profile;
}

async function requireAdmin(c: Caller) {
  const p = await profileOf(c);
  if (!p.is_admin) throw new HttpError(403, "只有管理员可以做这个操作");
  return p;
}

async function body(req: Request): Promise<Record<string, unknown>> {
  if (!req.body) return {};
  try { return await req.json(); } catch { throw new HttpError(400, "请求内容必须是 JSON"); }
}

function orderId(s: string) {
  if (!/^\d+$/.test(s)) throw new HttpError(400, "订单号必须是数字");
  return Number(s);
}

function loginToEmail(login: string) {
  const l = login.trim().toLowerCase();
  if (!/^[a-z0-9._@+-]{3,80}$/.test(l)) throw new HttpError(400, "登录名只能用字母、数字和 . _ - @");
  return l.includes("@") ? l : `${l}@${LOGIN_DOMAIN}`;
}

// ------------------------------------------------------------------ 路由
async function route(req: Request): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^.*?\/api(?=\/|$)/, "").replace(/\/+$/, "") || "/";
  const m = req.method;
  const seg = path.split("/").filter(Boolean);

  if (path === "/" && m === "GET") {
    return json({
      name: "订单协作系统 API",
      docs: "https://raw.githubusercontent.com/Looktar/order-hub/main/AGENTS.md",
      docs_page: "https://github.com/Looktar/order-hub/blob/main/AGENTS.md",
      hint: "Agent 请先读 docs 里的接入说明，再用 Authorization: Bearer <令牌> 调用",
    });
  }

  const c = await identify(req);

  // 我是谁
  if (path === "/me" && m === "GET") {
    const p = await profileOf(c);
    return json({ ...p, via: c.via });
  }

  // 订单列表
  if (path === "/orders" && m === "GET") {
    const status = url.searchParams.get("status");
    const limit = Math.min(Number(url.searchParams.get("limit") ?? 50) || 50, 200);
    const rows = await asUser(c, (tx) => tx`
      select o.id, o.status, o.customer, o.address, o.due_date::text as due_date, o.has_issue, o.modified_by,
             o.created_at, o.updated_at, s.name as sales_name, d.name as driver_name,
             coalesce((select json_agg(json_build_object('category', i.category, 'spec', i.spec,
                       'qty', i.qty, 'unit', i.unit, 'original_qty', i.original_qty) order by i.position)
                       from public.order_items i where i.order_id = o.id and not i.removed), '[]') as items
        from public.orders o
        left join public.profiles s on s.id = o.sales_id
        left join public.profiles d on d.id = o.driver_id
       where (${status}::text is null or o.status::text = ${status})
       order by o.id desc limit ${limit}`);
    return json(rows);
  }

  // 提交订单
  if (path === "/orders" && m === "POST") {
    const b = await body(req);
    const [{ id }] = await asUser(c, (tx) => tx`select public.submit_order(${tx.json(b as never)}, ${c.via}) as id`);
    return json({ id, message: `已提交订单 #${id}` }, 201);
  }

  if (seg[0] === "orders" && seg[1]) {
    const id = orderId(seg[1]);
    const action = seg.slice(2).join("/");

    if (!action && m === "GET") {
      const [{ d }] = await asUser(c, (tx) => tx`select public.order_detail(${id}) as d`);
      if (!d) throw new HttpError(404, `订单 #${id} 不存在或无权查看`);
      return json(d);
    }
    if (action === "changes" && m === "POST") {
      const b = await body(req);
      const changes = { fields: b.fields ?? {}, items: b.items ?? [] };
      const [{ n }] = await asUser(c, (tx) =>
        tx`select public.modify_order(${id}, ${tx.json(changes as never)}, ${(b.reason as string) ?? null}, ${c.via}) as n`);
      return json({ changed: n, message: `订单 #${id} 已修改 ${n} 项` });
    }
    if (action === "assign" && m === "POST") {
      const b = await body(req);
      let driverId = b.driver_id as string | undefined;
      if (!driverId && b.driver_name) {
        const found = await asUser(c, (tx) =>
          tx`select id from public.profiles where role = 'driver' and active and name = ${b.driver_name as string}`);
        if (found.length !== 1) throw new HttpError(400, `找不到唯一一位叫"${b.driver_name}"的司机，请用 driver_id`);
        driverId = found[0].id;
      }
      if (!driverId) throw new HttpError(400, "需要 driver_id 或 driver_name");
      await asUser(c, (tx) => tx`select public.assign_driver(${id}, ${driverId}, ${c.via})`);
      return json({ message: `订单 #${id} 已派单` });
    }
    if (action === "start" && m === "POST") {
      await asUser(c, (tx) => tx`select public.start_delivery(${id}, ${c.via})`);
      return json({ message: `订单 #${id} 开始送货` });
    }
    if (action === "delivered" && m === "POST") {
      await asUser(c, (tx) => tx`select public.confirm_delivered(${id}, ${c.via})`);
      return json({ message: `订单 #${id} 已确认送达` });
    }
    if (action === "issue" && m === "POST") {
      const b = await body(req);
      await asUser(c, (tx) => tx`select public.report_issue(${id}, ${(b.note as string) ?? ""}, ${c.via})`);
      return json({ message: `已报告订单 #${id} 的送货问题` });
    }
    if (action === "issue/resolve" && m === "POST") {
      const b = await body(req);
      await asUser(c, (tx) => tx`select public.resolve_issue(${id}, ${(b.note as string) ?? null}, ${c.via})`);
      return json({ message: `订单 #${id} 的送货问题已处理` });
    }
    // 上传照片：请求体直接是图片文件，?kind=order 或 signoff
    if (action === "photos" && m === "POST") {
      const kind = url.searchParams.get("kind") ?? "order";
      if (!["order", "signoff"].includes(kind)) throw new HttpError(400, "kind 只能是 order 或 signoff");
      const type = req.headers.get("content-type") ?? "";
      if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(type)) throw new HttpError(400, "照片格式需为 jpeg、png、webp 或 heic");
      const bytes = new Uint8Array(await req.arrayBuffer());
      if (!bytes.length || bytes.length > MAX_PHOTO_BYTES) throw new HttpError(400, "照片不能为空，也不能超过 5 MB");
      const ext = type.split("/")[1].replace("jpeg", "jpg");
      const path = `${id}/${kind}/${crypto.randomUUID()}.${ext}`;
      const [{ pid }] = await asUser(c, async (tx) => {
        const r = await tx`select public.add_photo(${id}, ${kind}::public.photo_kind, ${path}, ${c.via}) as pid`;
        const up = await admin.storage.from("photos").upload(path, bytes, { contentType: type });
        if (up.error) throw new HttpError(500, "照片保存失败：" + up.error.message);
        return r;
      });
      return json({ id: pid, path, message: "照片已上传" }, 201);
    }
  }

  // 照片下载：返回 10 分钟有效的链接
  if (seg[0] === "photos" && seg[1] && m === "GET") {
    const rows = await asUser(c, (tx) => tx`select path from public.order_photos where id = ${orderId(seg[1])}`);
    if (!rows.length) throw new HttpError(404, "照片不存在或无权查看");
    const { data, error } = await admin.storage.from("photos").createSignedUrl(rows[0].path, 600);
    if (error) throw new HttpError(500, error.message);
    return json({ url: data.signedUrl, expires_in: 600 });
  }

  // 司机名单（派单用）
  if (path === "/drivers" && m === "GET") {
    const rows = await asUser(c, (tx) =>
      tx`select id, name from public.profiles where role = 'driver' and active order by name`);
    return json(rows);
  }

  // 通知
  if (path === "/notifications" && m === "GET") {
    const all = url.searchParams.get("all") === "1";
    const rows = await asUser(c, (tx) => tx`select * from public.my_notifications(${!all}, 100)`);
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
    if (c.viaToken) throw new HttpError(403, "请在网页上登录后生成令牌，Agent 不能自己生成令牌");
    await profileOf(c);
    const b = await body(req);
    const label = cleanVia((b.label as string) || "Agent") || "Agent";
    const token = newToken();
    await sql`insert into public.agent_tokens (user_id, token_hash, label) values (${c.userId}, ${await sha256(token)}, ${label})`;
    return json({ token, label, message: "令牌只显示这一次，请马上交给你的 Agent 保存" }, 201);
  }
  if (seg[0] === "tokens" && seg[1] && m === "DELETE") {
    const r = await sql`update public.agent_tokens set revoked_at = now()
                         where id = ${orderId(seg[1])} and user_id = ${c.userId} and revoked_at is null returning id`;
    if (!r.length) throw new HttpError(404, "没有这个令牌");
    return json({ message: "令牌已作废" });
  }

  // ---------------------------------------------------------------- 管理员
  if (seg[0] === "admin") {
    await requireAdmin(c);
    if (c.viaToken) throw new HttpError(403, "管理操作请在网页上登录后进行");

    if (path === "/admin/users" && m === "GET") {
      const rows = await sql`select p.id, p.name, p.role, p.is_admin, p.active, p.login, p.created_at,
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
      if (!name) throw new HttpError(400, "请填写姓名");
      if (!["sales", "company", "driver"].includes(role)) throw new HttpError(400, "角色只能是 sales、company 或 driver");
      if (password.length < 8) throw new HttpError(400, "密码至少 8 位");
      const email = loginToEmail(login);
      const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
      if (error || !data.user) throw new HttpError(400, "建账号失败：" + (error?.message ?? ""));
      await sql`insert into public.profiles (id, name, role, is_admin, login)
                values (${data.user.id}, ${name}, ${role}, ${b.is_admin === true}, ${login.toLowerCase()})`;
      return json({ id: data.user.id, message: `已为 ${name} 建好账号，登录名 ${login}` }, 201);
    }
    if (seg[1] === "users" && seg[2]) {
      const uid = seg[2];
      if (seg.length === 3 && m === "PATCH") {
        const b = await body(req);
        if (uid === c.userId && (b.active === false || b.is_admin === false)) {
          throw new HttpError(400, "不能停用自己或取消自己的管理员");
        }
        const r = await sql`update public.profiles set
              name = coalesce(${(b.name as string) ?? null}, name),
              role = coalesce(${(b.role as string) ?? null}::public.user_role, role),
              active = coalesce(${(b.active as boolean) ?? null}, active),
              is_admin = coalesce(${(b.is_admin as boolean) ?? null}, is_admin)
            where id = ${uid} returning id`;
        if (!r.length) throw new HttpError(404, "没有这个用户");
        if (b.active === false) await sql`update public.agent_tokens set revoked_at = now() where user_id = ${uid} and revoked_at is null`;
        return json({ message: "已更新" });
      }
      if (seg[3] === "password" && m === "POST") {
        const b = await body(req);
        if (String(b.password ?? "").length < 8) throw new HttpError(400, "密码至少 8 位");
        const { error } = await admin.auth.admin.updateUserById(uid, { password: String(b.password) });
        if (error) throw new HttpError(400, error.message);
        return json({ message: "密码已重置" });
      }
      if (seg[3] === "tokens" && seg[4] === "reset" && m === "POST") {
        const r = await sql`update public.agent_tokens set revoked_at = now() where user_id = ${uid} and revoked_at is null returning id`;
        return json({ revoked: r.length, message: "这位用户的所有 Agent 令牌已作废，请让他在网页上重新生成" });
      }
    }
  }

  throw new HttpError(404, `没有这个接口：${m} ${path}`);
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    return await route(req);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    const err = e as { code?: string; message?: string };
    if (err.code === "42501") return json({ error: err.message }, 403);
    if (err.code === "P0001" || err.code?.startsWith("22") || err.code?.startsWith("23")) {
      return json({ error: err.message }, 400);
    }
    console.error(e);
    return json({ error: "服务器出错，请稍后再试" }, 500);
  }
});
