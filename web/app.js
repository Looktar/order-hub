// 订单协作 · 网页端
// 读数据直接走 Supabase（受数据库行级权限限制），写操作全部调用数据库函数；
// 只有管理员功能和 Agent 令牌走接口函数。页面内容一律用 textContent 写入，不拼接 HTML。
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";

const CFG = window.ORDER_HUB_CONFIG || {};
const app = document.getElementById("app");
if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) {
  app.textContent = "缺少 config.js 配置，请检查部署设置。";
  throw new Error("missing config");
}
const sb = createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
const API = `${CFG.supabaseUrl}/functions/v1/api`;
const LOGIN_DOMAIN = CFG.loginDomain || "users.order-hub.app";

const STATUS = { pending: "待公司处理", assigned: "已派给司机", delivering: "送货中", delivered: "已送达" };
const STATUS_ORDER = ["pending", "assigned", "delivering", "delivered"];
const CAT = { oil: "机油", oil_filter: "机油滤芯", tire: "轮胎", rim: "轮毂" };
const UNIT = { oil: "箱", oil_filter: "个", tire: "条", rim: "个" };
const ROLE = { sales: "销售", company: "公司", driver: "司机" };

let me = null;          // 当前用户资料
let unread = 0;
let pollTimer = null;

// ------------------------------------------------------------------ 小工具
function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === false || v == null) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "value") el.value = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}
const icon = (d, size = 18) => {
  const s = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  s.setAttribute("width", size); s.setAttribute("height", size); s.setAttribute("viewBox", "0 0 24 24");
  s.setAttribute("fill", "none"); s.setAttribute("stroke", "currentColor"); s.setAttribute("stroke-width", "2");
  s.setAttribute("stroke-linecap", "round"); s.setAttribute("stroke-linejoin", "round"); s.setAttribute("aria-hidden", "true");
  for (const part of d.split("|")) {
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path"); p.setAttribute("d", part); s.append(p);
  }
  return s;
};
const I = {
  back: "M15 18l-6-6 6-6", plus: "M12 5v14M5 12h14", bell: "M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9|M10 21h4",
  cam: "M4 8h3l2-3h6l2 3h3v11H4z|M12 16.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z", gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6z|M19 12a7 7 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2-1.2L14 3h-4l-.5 2.6a7 7 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6A7 7 0 0 0 5 12c0 .4 0 .8.1 1.2l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2 1.2L10 21h4l.5-2.6a7 7 0 0 0 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2z",
  check: "M5 12.5l4.5 4.5L19 7", logo: "M3 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0|M10 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0|M17 12a2 2 0 1 0 4 0a2 2 0 1 0-4 0|M7 12h3M14 12h3",
};
const fmtQty = (q) => String(Number(q));
const fmtTime = (t) => {
  if (!t) return "";
  const d = new Date(t), now = new Date();
  const hm = d.toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return `今天 ${hm}`;
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return `昨天 ${hm}`;
  return `${d.getMonth() + 1}月${d.getDate()}日 ${hm}`;
};
const today = () => new Date().toLocaleDateString("sv-SE");
function toast(msg) {
  const t = h("div", { class: "toast", role: "status" }, msg);
  document.body.append(t); setTimeout(() => t.remove(), 3200);
}
function errMsg(e) { return (e && (e.message || e.error_description || e.error)) || String(e); }
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
}
async function api(path, opts = {}) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(API + path, {
    ...opts,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}`, ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `请求失败（${res.status}）`);
  return body;
}
function itemsText(items) {
  return items.filter((i) => !i.removed).map((i) => `${CAT[i.category]}${i.spec ? " " + i.spec : ""} × ${fmtQty(i.qty)}${i.unit}`);
}
function statusChip(o) {
  const cls = { pending: "", assigned: "blue", delivering: "blue", delivered: "ok" }[o.status];
  return h("span", { class: `chip ${cls}` }, o.status === "delivered" ? [icon(I.check, 12), "已送达"] : STATUS[o.status]);
}
function flagChips(o) {
  return [
    o.modified_by ? h("span", { class: "chip warn" }, `${ROLE[o.modified_by]}已修改`) : null,
    o.has_issue ? h("span", { class: "chip bad" }, "送货有问题") : null,
  ];
}

// 照片压缩：长边不超过 1600 像素，JPEG 质量 0.72，通常在 200 KB 左右
async function compress(file) {
  const bmp = await createImageBitmap(file).catch(() => null);
  if (!bmp) return file;
  const scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * scale); c.height = Math.round(bmp.height * scale);
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
  return await new Promise((r) => c.toBlob(r, "image/jpeg", 0.72));
}
async function uploadPhoto(orderId, kind, file) {
  const blob = await compress(file);
  const path = `${orderId}/${kind}/${crypto.randomUUID()}.jpg`;
  const { error } = await sb.storage.from("photos").upload(path, blob, { contentType: "image/jpeg" });
  if (error) throw new Error("照片上传失败：" + error.message);
  await rpc("add_photo", { p_order: orderId, p_kind: kind, p_path: path, p_via: null });
}
async function signedUrls(paths) {
  if (!paths.length) return {};
  const { data } = await sb.storage.from("photos").createSignedUrls(paths, 3600);
  return Object.fromEntries((data || []).map((d) => [d.path, d.signedUrl]));
}
function pickPhotos(onFiles, { capture = false, multiple = true } = {}) {
  const inp = h("input", { type: "file", accept: "image/*", class: "sr", multiple, capture: capture ? "environment" : false });
  inp.addEventListener("change", () => { if (inp.files.length) onFiles([...inp.files]); inp.value = ""; });
  return inp;
}

// ------------------------------------------------------------------ 外框
function shell(...content) {
  const bell = h("a", { href: "#/notifications", class: "iconbtn", "aria-label": `通知，${unread} 条未读` }, icon(I.bell),
    unread ? h("span", { class: "badge", "aria-hidden": "true" }, unread > 99 ? "99+" : unread) : null);
  const top = h("header", { class: "top" },
    h("a", { href: "#/", class: "brand", "aria-label": "订单协作首页" }, icon(I.logo, 26), h("span", { class: "t" }, "订单协作")),
    h("span", { class: "who" }, `${me.name} · ${ROLE[me.role]}`),
    h("span", { class: "grow" }),
    me.role === "sales" ? h("a", { href: "#/new", class: "btn primary", "aria-label": "新建订单" }, icon(I.plus, 16), h("span", { class: "t" }, "新建订单")) : null,
    bell,
    h("a", { href: "#/settings", class: "iconbtn", "aria-label": "设置" }, icon(I.gear)),
  );
  app.replaceChildren(top, h("main", {}, ...content));
}
function backLink(href = "#/", text = "返回") {
  return h("a", { href, class: "btn link", style: "padding-left:0" }, icon(I.back, 16), text);
}

// ------------------------------------------------------------------ 登录
function loginView(msg) {
  const login = h("input", { class: "i", id: "login", autocomplete: "username", required: true });
  const pw = h("input", { class: "i", id: "pw", type: "password", autocomplete: "current-password", required: true });
  const err = h("div", { class: "err", role: "alert", hidden: !msg }, msg || "");
  const btn = h("button", { class: "btn primary big", type: "submit" }, "登录");
  const form = h("form", { class: "card", onsubmit: async (e) => {
    e.preventDefault(); btn.disabled = true; err.hidden = true;
    const l = login.value.trim().toLowerCase();
    const email = l.includes("@") ? l : `${l}@${LOGIN_DOMAIN}`;
    const { error } = await sb.auth.signInWithPassword({ email, password: pw.value });
    btn.disabled = false;
    if (error) { err.textContent = "登录名或密码不对"; err.hidden = false; return; }
    location.hash = "#/"; boot();
  } },
    h("h1", { style: "font-size:22px" }, "订单协作"),
    h("p", { class: "muted", style: "margin:0" }, "销售、公司、司机共用。账号由公司管理员开通。"),
    err,
    h("label", { class: "f", for: "login" }, "登录名或邮箱", login),
    h("label", { class: "f", for: "pw" }, "密码", pw),
    btn,
  );
  app.replaceChildren(h("div", { class: "narrow", style: "padding-top:12vh" }, form));
}

// 系统里还没有管理员时，第一个登录的人设为管理员
function bootstrapView() {
  const name = h("input", { class: "i", id: "bname", required: true });
  const err = h("div", { class: "err", role: "alert", hidden: true });
  app.replaceChildren(h("div", { class: "narrow", style: "padding-top:12vh" }, h("form", { class: "card", onsubmit: async (e) => {
    e.preventDefault();
    try { await rpc("bootstrap_admin", { p_name: name.value }); boot(); } catch (ex) { err.textContent = errMsg(ex); err.hidden = false; }
  } },
    h("h1", { style: "font-size:22px" }, "设置第一个管理员"),
    h("p", { class: "muted", style: "margin:0" }, "系统里还没有管理员。你将成为管理员（公司角色），之后由你在“设置”里给销售、公司同事和司机开通账号。"),
    err, h("label", { class: "f", for: "bname" }, "你的姓名", name),
    h("button", { class: "btn primary big", type: "submit" }, "成为管理员"))));
}

// ------------------------------------------------------------------ 首页：按角色
async function loadOrders() {
  const { data, error } = await sb.from("orders")
    .select("id,status,customer,address,due_date,has_issue,modified_by,created_at,updated_at,sales:profiles!orders_sales_id_fkey(name),driver:profiles!orders_driver_id_fkey(name),order_items(category,spec,qty,unit,removed,position)")
    .order("id", { ascending: false }).limit(300);
  if (error) throw new Error(error.message);
  for (const o of data) o.order_items.sort((a, b) => a.position - b.position);
  return data;
}

function orderCard(o) {
  const items = itemsText(o.order_items);
  return h("a", { href: `#/order/${o.id}`, class: "ocard" },
    h("div", { class: "meta" }, h("span", {}, `#${o.id}`), h("span", {}, fmtTime(o.updated_at))),
    h("div", { class: "cust" }, o.customer),
    h("div", { class: "row", style: "gap:6px" }, me.role !== "company" ? statusChip(o) : null, flagChips(o)),
    h("div", { class: "items" }, items.slice(0, 3).map((t) => h("div", {}, t)), items.length > 3 ? h("div", { class: "muted" }, `等 ${items.length} 项`) : null),
    h("div", { class: "tiny muted" },
      me.role === "company" ? `销售：${o.sales?.name || ""}` : null,
      o.driver ? `${me.role === "company" ? " · " : ""}司机：${o.driver.name}` : null,
      o.due_date ? ` · 要求 ${o.due_date} 送达` : null),
  );
}

async function homeView() {
  const orders = await loadOrders();
  if (me.role === "company") return boardView(orders);
  const active = orders.filter((o) => o.status !== "delivered");
  const done = orders.filter((o) => o.status === "delivered").slice(0, 20);
  const title = me.role === "sales" ? "我的订单" : "我的送货单";
  shell(h("div", { class: "narrow stack" },
    h("h1", { style: "font-size:20px" }, title),
    me.role === "sales" ? h("p", { class: "small muted", style: "margin:0" }, "也可以直接把订单照片发给你的 Agent，由它代为提交。") : null,
    h("h2", { class: "small muted" }, `进行中 · ${active.length}`),
    h("div", { class: "list" }, active.length ? active.map(orderCard) : h("div", { class: "empty" }, me.role === "sales" ? "还没有进行中的订单" : "暂时没有派给你的订单")),
    done.length ? [h("h2", { class: "small muted" }, "最近已送达"), h("div", { class: "list" }, done.map(orderCard))] : null,
  ));
}

let boardFilter = "all";
function boardView(orders) {
  const F = {
    all: ["全部订单", () => true],
    modified: ["被修改过的", (o) => !!o.modified_by],
    today: ["今天要送的", (o) => o.status !== "delivered" && o.due_date === today()],
    issue: ["送货有问题的", (o) => o.has_issue],
  };
  const filters = h("nav", { class: "filters", "aria-label": "筛选" },
    Object.entries(F).map(([k, [label, fn]]) => h("button", {
      type: "button", "aria-pressed": String(boardFilter === k),
      onclick: () => { boardFilter = k; boardView(orders); },
    }, h("span", {}, label), h("span", { class: "muted" }, orders.filter(fn).length))));
  const shown = orders.filter(F[boardFilter][1]);
  const board = h("div", { class: "board" }, STATUS_ORDER.map((s) => {
    const list = shown.filter((o) => o.status === s);
    const visible = s === "delivered" ? list.slice(0, 30) : list;
    return h("section", { class: "col", "aria-label": STATUS[s] },
      h("h2", {}, h("span", {}, STATUS[s]), h("span", { class: "muted" }, list.length)),
      visible.length ? visible.map(orderCard) : h("div", { class: "empty" }, "没有订单"));
  }));
  shell(h("div", { class: "page" }, h("div", { class: "layout" }, filters, board)));
}

// ------------------------------------------------------------------ 新建订单（销售）
function itemEditor(rows) {
  const box = h("div", { class: "stack" });
  const draw = () => {
    box.replaceChildren(...rows.map((r, idx) => {
      const cat = h("select", { class: "i", "aria-label": "品类", onchange: (e) => { r.category = e.target.value; r.unit = UNIT[r.category]; draw(); } },
        Object.entries(CAT).map(([k, v]) => h("option", { value: k, selected: r.category === k }, v)));
      return h("div", { class: "card", style: "padding:12px;gap:8px" },
        h("div", { class: "grid2" },
          h("label", { class: "f" }, "品类", cat),
          h("label", { class: "f" }, "规格 / 型号", h("input", { class: "i", value: r.spec, placeholder: "如 5W-30、225/65R17", oninput: (e) => (r.spec = e.target.value) }))),
        h("div", { class: "row" },
          h("label", { class: "f", style: "flex:1 1 120px" }, "数量", h("input", { class: "i", type: "number", inputmode: "decimal", min: "0", step: "any", value: r.qty, oninput: (e) => (r.qty = e.target.value) })),
          h("label", { class: "f", style: "flex:1 1 90px" }, "单位", h("input", { class: "i", value: r.unit, oninput: (e) => (r.unit = e.target.value) })),
          rows.length > 1 ? h("button", { type: "button", class: "btn link danger", style: "align-self:flex-end", onclick: () => { rows.splice(idx, 1); draw(); } }, "删除") : null));
    }), h("div", { class: "row" }, Object.entries(CAT).map(([k, v]) =>
      h("button", { type: "button", class: "btn", onclick: () => { rows.push({ category: k, spec: "", qty: "", unit: UNIT[k] }); draw(); } }, icon(I.plus, 14), v))));
  };
  draw();
  return box;
}

function newOrderView() {
  if (me.role !== "sales") { location.hash = "#/"; return; }
  const files = [];
  const rows = [{ category: "oil", spec: "", qty: "", unit: "箱" }];
  const thumbs = h("div", { class: "photos" });
  const drawThumbs = () => thumbs.replaceChildren(
    ...files.map((f, i) => h("div", { class: "photo-wrap" }, h("img", { class: "photo", src: URL.createObjectURL(f), alt: `订单照片 ${i + 1}` }),
      h("button", { type: "button", "aria-label": "移除这张照片", onclick: () => { files.splice(i, 1); drawThumbs(); } }, "×"))),
    h("label", { class: "photo-add" }, icon(I.cam, 24), files.length ? "再加一张" : "拍照或选图", pickPhotos((fs) => { files.push(...fs); drawThumbs(); })));
  drawThumbs();
  const f = {
    customer: h("input", { class: "i", required: true }), address: h("input", { class: "i" }),
    contact: h("input", { class: "i", placeholder: "姓名和电话" }), due: h("input", { class: "i", type: "date", min: today() }),
    note: h("textarea", { class: "i" }),
  };
  const err = h("div", { class: "err", role: "alert", hidden: true });
  const btn = h("button", { class: "btn primary big", type: "submit" }, "发回公司");
  const form = h("form", { class: "narrow stack", onsubmit: async (e) => {
    e.preventDefault(); err.hidden = true;
    const items = rows.filter((r) => r.qty !== "" && Number(r.qty) > 0).map((r) => ({ ...r, qty: Number(r.qty) }));
    if (!f.customer.value.trim()) { err.textContent = "请填写客户名称"; err.hidden = false; return; }
    if (!items.length) { err.textContent = "至少填一项货品和数量"; err.hidden = false; return; }
    btn.disabled = true; btn.textContent = "正在提交…";
    try {
      const id = await rpc("submit_order", { p: {
        customer: f.customer.value.trim(), address: f.address.value.trim(), contact: f.contact.value.trim(),
        due_date: f.due.value || null, note: f.note.value.trim(), items }, p_via: null });
      for (const file of files) await uploadPhoto(id, "order", file);
      toast(`订单 #${id} 已发回公司`);
      location.hash = `#/order/${id}`;
    } catch (ex) { err.textContent = errMsg(ex); err.hidden = false; btn.disabled = false; btn.textContent = "发回公司"; }
  } },
    backLink(),
    h("h1", { style: "font-size:20px" }, "新建订单"),
    h("section", { class: "stack" }, h("h2", { class: "small muted" }, "1 · 订单照片"), thumbs),
    h("section", { class: "stack" }, h("h2", { class: "small muted" }, "2 · 货品"), itemEditor(rows)),
    h("section", { class: "card" }, h("h2", { class: "small muted" }, "3 · 送货信息"),
      h("label", { class: "f" }, "客户 *", f.customer), h("label", { class: "f" }, "送货地址", f.address),
      h("div", { class: "grid2" }, h("label", { class: "f" }, "收货人", f.contact), h("label", { class: "f" }, "要求送达日期", f.due)),
      h("label", { class: "f" }, "备注", f.note)),
    err,
    h("div", { class: "dock" }, btn),
  );
  shell(form);
}

// ------------------------------------------------------------------ 订单详情
async function orderView(id) {
  const d = await rpc("order_detail", { p_order: id });
  if (!d) { shell(h("div", { class: "narrow stack" }, backLink(), h("div", { class: "err" }, `订单 #${id} 不存在或你无权查看`))); return; }
  const urls = await signedUrls(d.photos.map((p) => p.path));
  if (me.role === "driver") return driverView(d, urls);

  const canEdit = (me.role === "company" && d.status !== "delivered") || (me.role === "sales" && d.status === "pending" && d.sales?.id === me.id);
  const head = h("div", { class: "row" },
    h("span", { class: "muted small" }, `#${d.id}`), h("h1", { style: "font-size:20px" }, d.customer),
    statusChip(d), flagChips(d), h("span", { class: "spacer" }),
    canEdit ? h("a", { href: `#/order/${d.id}/edit`, class: "btn" }, "修改订单") : null);

  const actions = [];
  if (me.role === "company" && ["pending", "assigned"].includes(d.status)) actions.push(await assignBox(d));
  if (me.role === "company" && d.has_issue) actions.push(h("div", { class: "card" }, h("h2", {}, "送货问题"),
    h("div", { class: "note" }, d.issue_note || "司机报告了问题"),
    h("button", { class: "btn", type: "button", onclick: async () => { await rpc("resolve_issue", { p_order: d.id, p_note: null, p_via: null }); toast("已标记为处理完"); route(); } }, "标记为已处理")));

  shell(h("div", { class: "page" }, backLink(), h("div", { class: "split" },
    h("div", { class: "main" }, head, ...actions, itemsCard(d), infoCard(d), logCard(d)),
    h("aside", { class: "side" }, stepsCard(d), photosCard(d, urls)))));
}

function itemsCard(d) {
  const modified = d.items.some((i) => Number(i.qty) !== Number(i.original_qty) || i.removed);
  return h("section", { class: "card" },
    h("div", { class: "row" }, h("h2", {}, "货品清单"), modified ? h("span", { class: "chip warn" }, "数量有改动") : null),
    h("div", { class: "tablewrap" }, h("table", { class: "t" },
      h("thead", {}, h("tr", {}, h("th", {}, "货品"), h("th", { style: "text-align:right" }, "数量"))),
      h("tbody", {}, d.items.map((i) => {
        const changed = Number(i.qty) !== Number(i.original_qty);
        return h("tr", { class: i.removed ? "removed" : "" },
          h("td", {}, i.category_label, i.spec ? h("div", { class: "small muted" }, i.spec) : null),
          h("td", { style: "text-align:right;white-space:nowrap" }, i.removed ? `已删除（原 ${fmtQty(i.original_qty)}${i.unit}）`
            : [changed ? h("span", { class: "was" }, Number(i.original_qty) === 0 ? "新增" : `${fmtQty(i.original_qty)}${i.unit}`) : null,
               h("strong", {}, `${fmtQty(i.qty)}${i.unit}`)]));
      })))));
}
function infoCard(d) {
  return h("section", { class: "card" }, h("h2", {}, "送货信息"), h("dl", { class: "kv" },
    h("dt", {}, "送货地址"), h("dd", {}, d.address || "—"), h("dt", {}, "收货人"), h("dd", {}, d.contact || "—"),
    h("dt", {}, "要求送达"), h("dd", {}, d.due_date || "—"), h("dt", {}, "备注"), h("dd", {}, d.note || "—"),
    h("dt", {}, "销售"), h("dd", {}, d.sales?.name || "—"), h("dt", {}, "司机"), h("dd", {}, d.driver?.name || "未派单")));
}
function logCard(d) {
  return h("section", { class: "card" }, h("h2", {}, "修改与通知记录"),
    h("ol", { class: "log" }, d.timeline.map((e) => h("li", { class: e.type === "modified" ? "hl" : "" },
      h("span", { class: "tiny muted" }, `${e.by || "系统"} · ${e.via === "本人" ? "本人" : "通过 " + e.via} · ${fmtTime(e.at)}`),
      h("span", {}, e.summary)))));
}
function stepsCard(d) {
  const idx = STATUS_ORDER.indexOf(d.status);
  return h("section", { class: "card" }, h("h2", {}, "执行状态"), h("ol", { class: "steps" },
    STATUS_ORDER.map((s, i) => h("li", { style: i > idx ? "color:var(--muted)" : "" },
      h("span", { class: `dot ${i < idx || (i === idx && s === "delivered") ? "done" : i === idx ? "now" : ""}` }),
      h("span", { style: i === idx ? "font-weight:700" : "" }, STATUS[s], i === idx && s !== "delivered" ? "（当前）" : "")))));
}
function photosCard(d, urls) {
  const group = (kind, title) => {
    const list = d.photos.filter((p) => p.kind === kind);
    return h("div", { class: "stack", style: "gap:6px" }, h("span", { class: "small muted" }, title),
      list.length ? h("div", { class: "photos" }, list.map((p) => h("a", { href: urls[p.path] || "#", target: "_blank", rel: "noopener" },
        h("img", { class: "photo", src: urls[p.path] || "", alt: title, loading: "lazy" })))) : h("span", { class: "tiny muted" }, "暂无"));
  };
  const canAdd = (me.role === "company" && d.status !== "delivered") || (me.role === "sales" && d.status === "pending");
  return h("section", { class: "card" }, h("h2", {}, "照片"), group("order", "订单照片"), group("signoff", "签收照片"),
    canAdd ? h("label", { class: "btn" }, icon(I.cam, 16), "添加订单照片", pickPhotos(async (fs) => {
      try { for (const f of fs) await uploadPhoto(d.id, "order", f); toast("照片已上传"); route(); } catch (e) { toast(errMsg(e)); }
    })) : null);
}
async function assignBox(d) {
  const { data: drivers } = await sb.from("profiles").select("id,name").eq("role", "driver").eq("active", true).order("name");
  const sel = h("select", { class: "i", id: "drv" }, h("option", { value: "" }, "选择司机"),
    (drivers || []).map((x) => h("option", { value: x.id, selected: d.driver?.id === x.id }, x.name)));
  return h("section", { class: "card" }, h("h2", {}, d.driver ? "改派司机" : "派给司机"),
    h("div", { class: "row" }, h("label", { class: "sr", for: "drv" }, "司机"), h("div", { style: "flex:1 1 200px" }, sel),
      h("button", { class: "btn primary", type: "button", onclick: async (e) => {
        if (!sel.value) return toast("请先选择司机");
        e.target.disabled = true;
        try { await rpc("assign_driver", { p_order: d.id, p_driver: sel.value, p_via: null }); toast("已派单，司机和销售都会收到通知"); route(); }
        catch (ex) { toast(errMsg(ex)); e.target.disabled = false; }
      } }, "派单")),
    (drivers || []).length ? null : h("p", { class: "small muted", style: "margin:0" }, "还没有司机账号，请在设置里添加。"));
}

// ------------------------------------------------------------------ 司机送货单
function driverView(d, urls) {
  const active = ["assigned", "delivering"].includes(d.status);
  const signoffs = d.photos.filter((p) => p.kind === "signoff");
  const dock = h("div", { class: "dock" });
  if (d.status === "assigned") dock.append(h("button", { class: "btn primary big", type: "button", onclick: async () => {
    await rpc("start_delivery", { p_order: d.id, p_via: null }); toast("已出发，销售会收到通知"); route(); } }, "开始送货"));
  if (active) {
    dock.append(h("label", { class: `btn big ${d.status === "delivering" ? "primary" : ""}` }, icon(I.cam, 22),
      signoffs.length ? "再拍一张签收照片" : "拍签收照片",
      pickPhotos(async (fs) => { try { for (const f of fs) await uploadPhoto(d.id, "signoff", f); toast("签收照片已上传"); route(); } catch (e) { toast(errMsg(e)); } }, { capture: true, multiple: false })));
    if (signoffs.length) dock.append(h("button", { class: "btn primary big", type: "button", onclick: async () => {
      await rpc("confirm_delivered", { p_order: d.id, p_via: null }); toast("已确认送达"); route(); } }, icon(I.check, 22), "确认送达"));
    dock.append(h("div", { class: "grid2" },
      h("a", { href: `#/order/${d.id}/edit`, class: "btn" }, "修改订单内容"),
      h("button", { class: "btn", type: "button", onclick: () => issueDialog(d) }, "送货有问题")));
  }
  const tel = (d.contact.match(/[+\d][\d\s()-]{6,}/) || [])[0];
  shell(h("div", { class: "narrow stack" },
    backLink("#/", "我的送货单"),
    h("div", { class: "row" }, h("h1", { style: "font-size:20px" }, `送货单 #${d.id}`), statusChip(d), flagChips(d)),
    h("section", { class: "card" }, h("h2", { class: "small muted" }, "送到哪里"),
      h("div", { style: "font-size:18px;font-weight:700" }, d.customer),
      h("div", {}, d.address || "未填写地址"), h("div", { class: "muted" }, `收货人：${d.contact || "未填写"}`),
      d.due_date ? h("div", { class: "muted" }, `要求送达：${d.due_date}`) : null,
      d.note ? h("div", { class: "info" }, `备注：${d.note}`) : null,
      h("div", { class: "grid2" },
        d.address ? h("a", { class: "btn", target: "_blank", rel: "noopener", href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.address)}` }, "导航") : null,
        tel ? h("a", { class: "btn", href: `tel:${tel.replace(/[^\d+]/g, "")}` }, "打电话") : null)),
    h("section", { class: "card" }, h("h2", { class: "small muted" }, "要送的货"),
      d.items.filter((i) => !i.removed).map((i) => h("div", { class: "row", style: "justify-content:space-between;min-height:40px;border-bottom:1px solid var(--line2)" },
        h("span", {}, `${i.category_label}${i.spec ? " · " + i.spec : ""}`),
        h("strong", {}, Number(i.qty) !== Number(i.original_qty) ? h("span", { class: "was" }, Number(i.original_qty) === 0 ? "新增" : fmtQty(i.original_qty)) : null, `${fmtQty(i.qty)} ${i.unit}`))),
      d.modified_by ? h("div", { class: "note" }, `${ROLE[d.modified_by]}改过这张单，以上是最新内容`) : null),
    d.has_issue ? h("div", { class: "err" }, `已报告问题：${d.issue_note}`) : null,
    signoffs.length ? h("section", { class: "card" }, h("h2", { class: "small muted" }, "签收照片"),
      h("div", { class: "photos" }, signoffs.map((p) => h("img", { class: "photo", src: urls[p.path] || "", alt: "签收照片" })))) : null,
    d.status === "delivered" ? h("div", { class: "info" }, `已于 ${fmtTime(d.delivered_at)} 送达`) : null,
    dock));
}
function issueDialog(d) {
  const ta = h("textarea", { class: "i", id: "issue", placeholder: "如：客户不在、地址不对、货物损坏" });
  const box = h("div", { class: "narrow stack" }, backLink(`#/order/${d.id}`, "返回送货单"),
    h("h1", { style: "font-size:20px" }, `订单 #${d.id} 送货有问题`),
    h("label", { class: "f", for: "issue" }, "是什么问题（公司和销售会收到）", ta),
    h("button", { class: "btn primary big", type: "button", onclick: async () => {
      try { await rpc("report_issue", { p_order: d.id, p_note: ta.value, p_via: null }); toast("已告诉公司和销售"); location.hash = `#/order/${d.id}`; route(); }
      catch (e) { toast(errMsg(e)); }
    } }, "发送"));
  shell(box);
}

// ------------------------------------------------------------------ 修改订单
async function editView(id) {
  const d = await rpc("order_detail", { p_order: id });
  if (!d) { location.hash = "#/"; return; }
  const isDriver = me.role === "driver";
  const items = d.items.filter((i) => !i.removed).map((i) => ({ ...i, newQty: fmtQty(i.qty), remove: false }));
  const adds = [];
  const fields = { customer: d.customer, address: d.address, contact: d.contact, due_date: d.due_date || "", note: d.note };
  const fieldInputs = {};
  const reason = h("textarea", { class: "i", id: "reason", placeholder: isDriver ? "如：客户现场只收 8 箱" : "如：库存不足" });
  const err = h("div", { class: "err", role: "alert", hidden: true });

  const itemRows = h("div", { class: "stack" });
  const drawItems = () => itemRows.replaceChildren(
    ...items.map((i) => h("div", { class: "row", style: `justify-content:space-between;${i.remove ? "opacity:.5" : ""}` },
      h("span", { style: "flex:1 1 160px" }, `${i.category_label}${i.spec ? " · " + i.spec : ""}`),
      h("label", { class: "sr", for: `q${i.id}` }, "数量"),
      h("input", { class: "i qtyin", id: `q${i.id}`, type: "number", inputmode: "decimal", min: "0", step: "any", value: i.newQty, disabled: i.remove, oninput: (e) => (i.newQty = e.target.value) }),
      h("span", { class: "muted", style: "min-width:24px" }, i.unit),
      h("button", { type: "button", class: "btn link danger", onclick: () => { i.remove = !i.remove; drawItems(); } }, i.remove ? "恢复" : "删除"))),
    adds.length ? h("div", { class: "small muted" }, "新增货品") : null,
    adds.length ? itemEditor(adds) : null,
    h("button", { type: "button", class: "btn", onclick: () => { adds.push({ category: "oil", spec: "", qty: "", unit: "箱" }); drawItems(); } }, icon(I.plus, 14), "加一项货品"));
  drawItems();

  const save = h("button", { class: "btn primary big", type: "button", onclick: async () => {
    err.hidden = true;
    const ch = { items: [], fields: {} };
    for (const i of items) {
      if (i.remove) ch.items.push({ id: i.id, remove: true });
      else if (Number(i.newQty) !== Number(i.qty)) ch.items.push({ id: i.id, qty: Number(i.newQty) });
    }
    for (const a of adds) if (Number(a.qty) > 0) ch.items.push({ add: { ...a, qty: Number(a.qty) } });
    if (!isDriver) for (const [k, el] of Object.entries(fieldInputs)) if (el.value.trim() !== (fields[k] || "")) ch.fields[k] = el.value.trim();
    if (!ch.items.length && !Object.keys(ch.fields).length) { err.textContent = "没有改动任何内容"; err.hidden = false; return; }
    if (me.role !== "sales" && !reason.value.trim()) { err.textContent = "请填写修改原因"; err.hidden = false; return; }
    save.disabled = true;
    try {
      const n = await rpc("modify_order", { p_order: d.id, p_changes: ch, p_reason: reason.value.trim() || null, p_via: null });
      toast(`已修改 ${n} 项，公司和销售会收到通知`);
      location.hash = `#/order/${d.id}`;
    } catch (e) { err.textContent = errMsg(e); err.hidden = false; save.disabled = false; }
  } }, "保存修改");

  for (const [k, label] of [["customer", "客户"], ["address", "送货地址"], ["contact", "收货人"], ["due_date", "要求送达日期"], ["note", "备注"]]) {
    fieldInputs[k] = k === "note" ? h("textarea", { class: "i", value: fields[k] }) : h("input", { class: "i", type: k === "due_date" ? "date" : "text", value: fields[k] });
    fieldInputs[k].dataset.label = label;
  }
  shell(h("div", { class: "narrow stack" }, backLink(`#/order/${d.id}`, "取消"),
    h("h1", { style: "font-size:20px" }, `修改订单 #${d.id}`),
    h("div", { class: "info" }, "保存后只通知公司和这张订单的销售。"),
    h("section", { class: "card" }, h("h2", {}, "货品"), itemRows),
    isDriver ? null : h("section", { class: "card" }, h("h2", {}, "送货信息"),
      Object.values(fieldInputs).map((el) => h("label", { class: "f" }, el.dataset.label, el))),
    h("section", { class: "card" }, h("label", { class: "f", for: "reason" }, me.role === "sales" ? "修改原因（可不填）" : "修改原因 *", reason)),
    err, h("div", { class: "dock" }, save)));
}

// ------------------------------------------------------------------ 通知
async function notificationsView() {
  const list = await rpc("my_notifications", { p_unread_only: false, p_limit: 100 });
  shell(h("div", { class: "narrow stack" },
    h("div", { class: "row" }, h("h1", { style: "font-size:20px" }, "通知"), h("span", { class: "spacer" }),
      unread ? h("button", { class: "btn", type: "button", onclick: async () => { await rpc("mark_read", { p_event_ids: null }); unread = 0; route(); } }, "全部标为已读") : null),
    h("div", { class: "list" }, list.length ? list.map((n) => h("a", {
      href: `#/order/${n.order_id}`, class: `notice ${n.read_at ? "" : "unread"}`,
      onclick: () => { if (!n.read_at) rpc("mark_read", { p_event_ids: [n.event_id] }).then(refreshUnread); },
    }, h("span", {}, n.summary), h("span", { class: "tiny muted" }, `${n.actor_name || ""} · ${n.via === "本人" ? "本人" : "通过 " + n.via} · ${fmtTime(n.created_at)}`)))
      : h("div", { class: "empty" }, "还没有通知"))));
}
async function refreshUnread() {
  try {
    const list = await rpc("my_notifications", { p_unread_only: true, p_limit: 200 });
    const n = list.length;
    if (n !== unread) {
      unread = n;
      const b = document.querySelector(".top a[href='#/notifications']");
      if (b) { b.querySelector(".badge")?.remove(); b.setAttribute("aria-label", `通知，${n} 条未读`); if (n) b.append(h("span", { class: "badge", "aria-hidden": "true" }, n > 99 ? "99+" : n)); }
    }
  } catch { /* 网络不好时下次再试 */ }
}

// ------------------------------------------------------------------ 设置：Agent 令牌、账号管理
async function settingsView() {
  const tokens = await api("/tokens");
  const tokenBox = h("div", { class: "stack" });
  const label = h("input", { class: "i", id: "tlabel", placeholder: "如 Claude、Codex" });
  const sec = [
    h("section", { class: "card" }, h("h2", {}, "我的 Agent 令牌"),
      h("p", { class: "small muted", style: "margin:0" }, "把令牌交给你的 Agent（Claude、Codex 等），它就能以你的身份读写订单，权限和你本人完全一样。令牌只显示一次；丢了就作废重新生成。"),
      tokens.length ? h("div", { class: "list" }, tokens.map((t) => h("div", { class: "row", style: "justify-content:space-between" },
        h("span", {}, t.label, h("span", { class: "tiny muted" }, ` · 生成于 ${fmtTime(t.created_at)}${t.last_used_at ? " · 最近使用 " + fmtTime(t.last_used_at) : " · 还没用过"}`)),
        h("button", { class: "btn link danger", type: "button", onclick: async () => { await api(`/tokens/${t.id}`, { method: "DELETE" }); toast("已作废"); route(); } }, "作废"))))
        : h("span", { class: "small muted" }, "还没有令牌"),
      h("div", { class: "row" }, h("label", { class: "sr", for: "tlabel" }, "Agent 名称"), h("div", { style: "flex:1 1 200px" }, label),
        h("button", { class: "btn primary", type: "button", onclick: async () => {
          const r = await api("/tokens", { method: "POST", body: JSON.stringify({ label: label.value || "Agent" }) });
          tokenBox.replaceChildren(h("div", { class: "note" }, r.message),
            h("div", { class: "code" }, `接口地址：${API}\n令牌：${r.token}\n\n说明文档：仓库里的 AGENTS.md`),
            h("button", { class: "btn", type: "button", onclick: () => navigator.clipboard.writeText(`订单协作系统接口地址：${API}\n我的令牌：${r.token}\n用法见 AGENTS.md`).then(() => toast("已复制")) }, "复制给 Agent"));
        } }, "生成令牌")),
      tokenBox),
  ];
  if (me.is_admin) sec.push(await adminSection());
  sec.push(h("button", { class: "btn", type: "button", onclick: async () => { await sb.auth.signOut(); me = null; loginView(); } }, "退出登录"));
  shell(h("div", { class: "narrow stack" }, h("h1", { style: "font-size:20px" }, "设置"), ...sec));
}

async function adminSection() {
  const users = await api("/admin/users");
  const f = { name: h("input", { class: "i" }), login: h("input", { class: "i", placeholder: "邮箱或自定的登录名" }),
    pw: h("input", { class: "i", type: "text", placeholder: "至少 8 位" }),
    role: h("select", { class: "i" }, Object.entries(ROLE).map(([k, v]) => h("option", { value: k }, v))) };
  const groups = Object.entries(ROLE).map(([r, rl]) => {
    const list = users.filter((u) => u.role === r);
    return h("div", { class: "stack", style: "gap:6px" }, h("span", { class: "small muted" }, `${rl} · ${list.length}`),
      list.map((u) => h("div", { class: "row", style: `justify-content:space-between;${u.active ? "" : "opacity:.55"}` },
        h("span", {}, u.name, h("span", { class: "tiny muted" }, ` · ${u.login || ""}${u.is_admin ? " · 管理员" : ""}${u.active ? "" : " · 已停用"}`)),
        h("span", { class: "row", style: "gap:4px" },
          h("button", { class: "btn link", type: "button", onclick: async () => {
            const pw = prompt(`给 ${u.name} 设一个新密码（至少 8 位）`); if (!pw) return;
            try { await api(`/admin/users/${u.id}/password`, { method: "POST", body: JSON.stringify({ password: pw }) }); toast("密码已重置"); } catch (e) { toast(errMsg(e)); }
          } }, "重置密码"),
          u.tokens ? h("button", { class: "btn link", type: "button", onclick: async () => {
            await api(`/admin/users/${u.id}/tokens/reset`, { method: "POST" }); toast("令牌已全部作废"); route(); } }, "作废令牌") : null,
          u.id === me.id ? null : h("button", { class: "btn link danger", type: "button", onclick: async () => {
            await api(`/admin/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ active: !u.active }) }); route(); } }, u.active ? "停用" : "启用")))));
  });
  return h("section", { class: "card" }, h("h2", {}, "账号管理（管理员）"), ...groups,
    h("h2", { style: "margin-top:8px" }, "添加账号"),
    h("div", { class: "grid2" }, h("label", { class: "f" }, "姓名", f.name), h("label", { class: "f" }, "角色", f.role),
      h("label", { class: "f" }, "登录名", f.login), h("label", { class: "f" }, "初始密码", f.pw)),
    h("p", { class: "tiny muted", style: "margin:0" }, "没有邮箱的人（如司机）可以用自定的登录名，比如 wang01。"),
    h("button", { class: "btn primary", type: "button", onclick: async () => {
      try {
        const r = await api("/admin/users", { method: "POST", body: JSON.stringify({ name: f.name.value, role: f.role.value, login: f.login.value, password: f.pw.value }) });
        toast(r.message); route();
      } catch (e) { toast(errMsg(e)); }
    } }, "添加"));
}

// ------------------------------------------------------------------ 路由与启动
async function route() {
  if (!me) return;
  const hash = location.hash || "#/";
  try {
    let m;
    if (hash === "#/new") newOrderView();
    else if ((m = hash.match(/^#\/order\/(\d+)\/edit$/))) await editView(Number(m[1]));
    else if ((m = hash.match(/^#\/order\/(\d+)$/))) await orderView(Number(m[1]));
    else if (hash === "#/notifications") await notificationsView();
    else if (hash === "#/settings") await settingsView();
    else await homeView();
    window.scrollTo(0, 0);
  } catch (e) {
    shell(h("div", { class: "narrow stack" }, backLink(), h("div", { class: "err" }, "出错了：" + errMsg(e))));
  }
}

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return loginView();
  const { data, error } = await sb.from("profiles").select("id,name,role,is_admin,active").eq("id", session.user.id).maybeSingle();
  if (!error && !data && (await rpc("needs_bootstrap", {}).catch(() => false))) return bootstrapView();
  if (error || !data || !data.active) { await sb.auth.signOut(); return loginView("这个账号还没开通或已停用，请联系公司管理员。"); }
  me = data;
  await refreshUnread();
  clearInterval(pollTimer);
  pollTimer = setInterval(refreshUnread, 60000);
  route();
}

window.addEventListener("hashchange", route);
sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") { me = null; loginView(); } });
boot();
