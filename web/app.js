// 订单协作 · 网页端
// 读数据直接走 Supabase（受数据库行级权限限制），写操作全部调用数据库函数；
// 只有管理员功能和 Agent 令牌走接口函数。页面内容一律用 textContent 写入，不拼接 HTML。
// 文字都在 i18n.js 里，支持中文、English、Español。
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm";
import { LANGS, detectLang, errText, getLang, locale, savedLang, setLang, t } from "./i18n.js";

const CFG = window.ORDER_HUB_CONFIG || {};
const app = document.getElementById("app");
setLang(detectLang(null));
if (!CFG.supabaseUrl || !CFG.supabaseAnonKey) {
  app.textContent = t("missing_config");
  throw new Error("missing config");
}
const sb = createClient(CFG.supabaseUrl, CFG.supabaseAnonKey);
const API = `${CFG.supabaseUrl}/functions/v1/api`;
const LOGIN_DOMAIN = CFG.loginDomain || "users.order-hub.app";
const DOCS = {
  zh: "https://raw.githubusercontent.com/Looktar/order-hub/main/AGENTS.md",
  en: "https://raw.githubusercontent.com/Looktar/order-hub/main/AGENTS.en.md",
  es: "https://raw.githubusercontent.com/Looktar/order-hub/main/AGENTS.es.md",
};

const STATUS_ORDER = ["pending", "assigned", "delivering", "delivered"];
const CATS = ["oil", "oil_filter", "tire", "rim"];
const ROLES = ["sales", "company", "driver"];
const statusLabel = (s) => t(`st_${s}`);
const catLabel = (c) => t(`cat_${c}`);
const roleLabel = (r) => t(`role_${r}`);
const defaultUnit = (c) => t(`unit_${c}`);

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
  globe: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18z|M3 12h18|M12 3a14 14 0 0 1 0 18|M12 3a14 14 0 0 0 0 18",
};
const fmtQty = (q) => String(Number(q));
const qu = (q, unit) => `${fmtQty(q)}${/^[A-Za-zÀ-ÿ]/.test(unit || "") ? " " : ""}${unit || ""}`;
const fmtTime = (ts) => {
  if (!ts) return "";
  const d = new Date(ts), now = new Date();
  const hm = d.toLocaleTimeString(locale(), { hour: "2-digit", minute: "2-digit" });
  if (d.toDateString() === now.toDateString()) return t("today_at", { t: hm });
  const y = new Date(now); y.setDate(now.getDate() - 1);
  if (d.toDateString() === y.toDateString()) return t("yesterday_at", { t: hm });
  return `${d.toLocaleDateString(locale(), { month: "short", day: "numeric" })} ${hm}`;
};
const fmtFull = (ts) => (ts ? new Date(ts).toLocaleString(locale(), { year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }) : "");
const timeEl = (ts, text) => h("time", { datetime: ts, title: fmtFull(ts) }, text ?? fmtTime(ts));
const viaText = (v) => (!v || v === "本人" ? t("self") : t("via_agent", { a: v }));
const today = () => new Date().toLocaleDateString("sv-SE");
function toast(msg) {
  const el = h("div", { class: "toast", role: "status" }, msg);
  document.body.append(el); setTimeout(() => el.remove(), 3200);
}
async function rpc(fn, args) {
  const { data, error } = await sb.rpc(fn, args);
  if (error) throw error;
  return data;
}
async function api(path, opts = {}) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(API + path, {
    ...opts,
    headers: { "Content-Type": "application/json", "X-Lang": getLang(), Authorization: `Bearer ${session?.access_token}`, ...(opts.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `HTTP ${res.status}`);
  return body;
}
function itemsText(items) {
  return items.filter((i) => !i.removed).map((i) => `${catLabel(i.category)}${i.spec ? " " + i.spec : ""} × ${qu(i.qty, i.unit)}`);
}
function statusChip(o) {
  const cls = { pending: "", assigned: "blue", delivering: "blue", delivered: "ok", cancelled: "bad" }[o.status];
  return h("span", { class: `chip ${cls}` }, o.status === "delivered" ? [icon(I.check, 12), statusLabel("delivered")] : statusLabel(o.status));
}
function flagChips(o) {
  return [
    o.modified_by ? h("span", { class: "chip warn" }, t("modified_by", { role: roleLabel(o.modified_by) })) : null,
    o.has_issue ? h("span", { class: "chip bad" }, t("has_issue")) : null,
  ];
}
function langSelect(onChange) {
  const sel = h("select", { class: "i", id: "langsel", onchange: (e) => onChange(e.target.value) },
    Object.entries(LANGS).map(([k, v]) => h("option", { value: k, selected: getLang() === k }, v)));
  return sel;
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
  if (error) throw error;
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
  const bell = h("a", { href: "#/notifications", class: "iconbtn", "aria-label": t("notifications_label", { n: unread }) }, icon(I.bell),
    unread ? h("span", { class: "badge", "aria-hidden": "true" }, unread > 99 ? "99+" : unread) : null);
  const top = h("header", { class: "top" },
    h("a", { href: "#/", class: "brand", "aria-label": t("home") }, icon(I.logo, 26), h("span", { class: "t" }, t("app_name"))),
    h("span", { class: "who" }, `${me.name} · ${roleLabel(me.role)}`),
    h("span", { class: "grow" }),
    me.role === "sales" ? h("a", { href: "#/new", class: "btn primary", "aria-label": t("new_order") }, icon(I.plus, 16), h("span", { class: "t" }, t("new_order"))) : null,
    bell,
    h("a", { href: "#/settings", class: "iconbtn", "aria-label": t("settings") }, icon(I.gear)),
  );
  app.replaceChildren(top, h("main", {}, ...content));
}
function backLink(href = "#/", text = t("back")) {
  return h("a", { href, class: "btn link", style: "padding-left:0;align-self:flex-start" }, icon(I.back, 16), text);
}

// ------------------------------------------------------------------ 登录
function loginView(msg) {
  const login = h("input", { class: "i", id: "login", autocomplete: "username", required: true });
  const pw = h("input", { class: "i", id: "pw", type: "password", autocomplete: "current-password", required: true });
  const err = h("div", { class: "err", role: "alert", hidden: !msg }, msg || "");
  const btn = h("button", { class: "btn primary big", type: "submit" }, t("sign_in"));
  const form = h("form", { class: "card", novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); err.hidden = true;
    if (!login.value.trim() || !pw.value) { err.textContent = t("login_failed"); err.hidden = false; return; }
    btn.disabled = true;
    const l = login.value.trim().toLowerCase();
    const email = l.includes("@") ? l : `${l}@${LOGIN_DOMAIN}`;
    const { error } = await sb.auth.signInWithPassword({ email, password: pw.value });
    btn.disabled = false;
    if (error) { err.textContent = t("login_failed"); err.hidden = false; return; }
    location.hash = "#/"; boot();
  } },
    h("div", { class: "row", style: "justify-content:space-between" },
      h("h1", { style: "font-size:22px" }, t("app_name")),
      h("label", { class: "row small muted", style: "gap:6px" }, icon(I.globe, 16), h("span", { class: "sr" }, t("language")),
        h("span", { style: "width:130px" }, langSelect((l) => { setLang(l, true); loginView(msg); })))),
    h("p", { class: "muted", style: "margin:0" }, t("login_intro")),
    err,
    h("label", { class: "f", for: "login" }, t("login_name"), login),
    h("label", { class: "f", for: "pw" }, t("password"), pw),
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
    try { await rpc("bootstrap_admin", { p_name: name.value }); boot(); } catch (ex) { err.textContent = errText(ex); err.hidden = false; }
  } },
    h("h1", { style: "font-size:22px" }, t("bootstrap_title")),
    h("p", { class: "muted", style: "margin:0" }, t("bootstrap_intro")),
    err, h("label", { class: "f", for: "bname" }, t("your_name"), name),
    h("button", { class: "btn primary big", type: "submit" }, t("become_admin")))));
}

// ------------------------------------------------------------------ 首页：按角色
async function loadOrders() {
  const { data, error } = await sb.from("orders")
    .select("id,status,customer,address,due_date,contact,note,has_issue,modified_by,created_at,updated_at,assigned_at,started_at,delivered_at,cancelled_at,cancel_reason,sales:profiles!orders_sales_id_fkey(name),driver:profiles!orders_driver_id_fkey(name),order_items(category,spec,qty,unit,removed,position)")
    .order("id", { ascending: false }).limit(300);
  if (error) throw error;
  for (const o of data) o.order_items.sort((a, b) => a.position - b.position);
  return data;
}

function orderCard(o) {
  const items = itemsText(o.order_items);
  return h("a", { href: `#/order/${o.id}`, class: "ocard" },
    h("div", { class: "meta" }, h("span", {}, `#${o.id}`), h("span", {}, t("ordered_at", { t: "" }), timeEl(o.created_at))),
    h("div", { class: "cust" }, o.customer),
    h("div", { class: "row", style: "gap:6px" }, me.role !== "company" ? statusChip(o) : null, flagChips(o)),
    h("div", { class: "items" }, items.slice(0, 3).map((x) => h("div", {}, x)), items.length > 3 ? h("div", { class: "muted" }, t("more_items", { n: items.length })) : null),
    h("div", { class: "tiny muted" },
      me.role === "company" ? t("sales_is", { name: o.sales?.name || "" }) : null,
      o.driver ? `${me.role === "company" ? " · " : ""}${t("driver_is", { name: o.driver.name })}` : null,
      o.due_date ? ` · ${t("due_on", { d: o.due_date })}` : null),
    stageLine(o),
  );
}
// 卡片底部：最近一个环节的时间
function stageLine(o) {
  const [key, ts] = o.cancelled_at ? ["ts_cancelled", o.cancelled_at] : o.delivered_at ? ["ts_delivered", o.delivered_at] : o.started_at ? ["ts_started", o.started_at]
    : o.assigned_at ? ["ts_assigned", o.assigned_at] : [null, null];
  const parts = [];
  if (key) parts.push(h("span", {}, t(key, { t: "" }), timeEl(ts)));
  if (new Date(o.updated_at) - new Date(ts || o.created_at) > 60000) parts.push(h("span", {}, t("updated_at_k", { t: "" }), timeEl(o.updated_at)));
  return parts.length ? h("div", { class: "tiny muted row", style: "gap:4px 10px" }, parts) : null;
}

async function homeView() {
  const orders = await loadOrders();
  if (me.role === "company") return boardView(orders);
  const closed = (o) => o.status === "delivered" || o.status === "cancelled";
  const rank = { delivering: 0, assigned: 1, pending: 2 };
  const active = orders.filter((o) => !closed(o)).sort((a, b) =>
    (rank[a.status] - rank[b.status]) || (a.due_date || "9999").localeCompare(b.due_date || "9999") || a.id - b.id);
  const done = orders.filter(closed).slice(0, 20);
  const card = me.role === "driver" ? driverCard : orderCard;
  shell(h("div", { class: "narrow stack" },
    h("h1", { style: "font-size:20px" }, me.role === "sales" ? t("my_orders") : t("my_deliveries")),
    me.role === "sales" ? h("p", { class: "small muted", style: "margin:0" }, t("agent_hint")) : null,
    h("h2", { class: "small muted" }, t("in_progress", { n: active.length })),
    h("div", { class: "list" }, active.length ? active.map(card) : h("div", { class: "empty" }, me.role === "sales" ? t("no_active_orders") : t("no_deliveries"))),
    done.length ? [h("h2", { class: "small muted" }, t("recent_done")), h("div", { class: "list" }, done.map(orderCard))] : null,
  ));
}

let boardFilter = "all";
function boardView(orders) {
  const F = {
    all: ["f_all", (o) => o.status !== "cancelled"],
    modified: ["f_modified", (o) => !!o.modified_by && o.status !== "cancelled"],
    today: ["f_today", (o) => o.status !== "delivered" && o.due_date === today()],
    issue: ["f_issue", (o) => o.has_issue && o.status !== "cancelled"],
    cancelled: ["f_cancelled", (o) => o.status === "cancelled"],
  };
  const filters = h("nav", { class: "filters", "aria-label": t("filters") },
    Object.entries(F).map(([k, [label, fn]]) => h("button", {
      type: "button", "aria-pressed": String(boardFilter === k),
      onclick: () => { boardFilter = k; boardView(orders); },
    }, h("span", {}, t(label)), h("span", { class: "muted" }, orders.filter(fn).length))));
  const shown = orders.filter(F[boardFilter][1]);
  const cols = boardFilter === "cancelled" ? ["cancelled"] : STATUS_ORDER;
  const board = h("div", { class: "board" }, cols.map((s) => {
    const list = shown.filter((o) => o.status === s);
    const visible = s === "delivered" ? list.slice(0, 30) : list;
    return h("section", { class: "col", "aria-label": statusLabel(s) },
      h("h2", {}, h("span", {}, statusLabel(s)), h("span", { class: "muted" }, list.length)),
      visible.length ? visible.map(orderCard) : h("div", { class: "empty" }, t("no_orders")));
  }));
  shell(h("div", { class: "page" }, h("div", { class: "layout" }, filters, board)));
}

// ------------------------------------------------------------------ 新建订单（销售）
function itemEditor(rows) {
  const box = h("div", { class: "stack" });
  const draw = () => {
    box.replaceChildren(...rows.map((r, idx) => {
      const cat = h("select", { class: "i", "aria-label": t("category"), onchange: (e) => { r.category = e.target.value; r.unit = defaultUnit(r.category); draw(); } },
        CATS.map((k) => h("option", { value: k, selected: r.category === k }, catLabel(k))));
      return h("div", { class: "card", style: "padding:12px;gap:8px" },
        h("div", { class: "grid2" },
          h("label", { class: "f" }, t("category"), cat),
          h("label", { class: "f" }, t("spec"), h("input", { class: "i", value: r.spec, placeholder: t("spec_ph"), oninput: (e) => (r.spec = e.target.value) }))),
        h("div", { class: "row" },
          h("label", { class: "f", style: "flex:1 1 120px" }, t("qty"), h("input", { class: "i", type: "number", inputmode: "decimal", min: "0", step: "any", value: r.qty, oninput: (e) => (r.qty = e.target.value) })),
          h("label", { class: "f", style: "flex:1 1 90px" }, t("unit"), h("input", { class: "i", value: r.unit, oninput: (e) => (r.unit = e.target.value) })),
          rows.length > 1 ? h("button", { type: "button", class: "btn link danger", style: "align-self:flex-end", onclick: () => { rows.splice(idx, 1); draw(); } }, t("delete")) : null));
    }), h("div", { class: "row" }, CATS.map((k) =>
      h("button", { type: "button", class: "btn", onclick: () => { rows.push({ category: k, spec: "", qty: "", unit: defaultUnit(k) }); draw(); } }, icon(I.plus, 14), catLabel(k)))));
  };
  draw();
  return box;
}

function newOrderView() {
  if (me.role !== "sales") { location.hash = "#/"; return; }
  const files = [];
  const rows = [{ category: "oil", spec: "", qty: "", unit: defaultUnit("oil") }];
  const thumbs = h("div", { class: "photos" });
  const drawThumbs = () => thumbs.replaceChildren(
    ...files.map((f, i) => h("div", { class: "photo-wrap" }, h("img", { class: "photo", src: URL.createObjectURL(f), alt: t("order_photo_n", { n: i + 1 }) }),
      h("button", { type: "button", "aria-label": t("remove_photo"), onclick: () => { files.splice(i, 1); drawThumbs(); } }, "×"))),
    h("label", { class: "photo-add" }, icon(I.cam, 24), files.length ? t("add_another") : t("take_photo"), pickPhotos((fs) => { files.push(...fs); drawThumbs(); })));
  drawThumbs();
  const f = {
    customer: h("input", { class: "i", required: true }), address: h("input", { class: "i" }),
    contact: h("input", { class: "i", placeholder: t("contact_ph") }), due: h("input", { class: "i", type: "date", min: today() }),
    note: h("textarea", { class: "i" }),
  };
  const err = h("div", { class: "err", role: "alert", hidden: true });
  const btn = h("button", { class: "btn primary big", type: "submit" }, t("send_to_company"));
  const form = h("form", { class: "narrow stack", novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); err.hidden = true;
    const items = rows.filter((r) => r.qty !== "" && Number(r.qty) > 0).map((r) => ({ ...r, qty: Number(r.qty) }));
    if (!f.customer.value.trim()) { err.textContent = t("need_customer"); err.hidden = false; return; }
    if (!items.length) { err.textContent = t("need_item"); err.hidden = false; return; }
    btn.disabled = true; btn.textContent = t("submitting");
    try {
      const id = await rpc("submit_order", { p: {
        customer: f.customer.value.trim(), address: f.address.value.trim(), contact: f.contact.value.trim(),
        due_date: f.due.value || null, note: f.note.value.trim(), items }, p_via: null });
      for (const file of files) await uploadPhoto(id, "order", file);
      toast(t("order_sent", { id }));
      location.hash = `#/order/${id}`;
    } catch (ex) { err.textContent = errText(ex); err.hidden = false; btn.disabled = false; btn.textContent = t("send_to_company"); }
  } },
    backLink(),
    h("h1", { style: "font-size:20px" }, t("new_order")),
    h("section", { class: "stack" }, h("h2", { class: "small muted" }, t("step_photos")), thumbs),
    h("section", { class: "stack" }, h("h2", { class: "small muted" }, t("step_items")), itemEditor(rows)),
    h("section", { class: "card" }, h("h2", { class: "small muted" }, t("step_delivery")),
      h("label", { class: "f" }, t("customer_req"), f.customer), h("label", { class: "f" }, t("address"), f.address),
      h("div", { class: "grid2" }, h("label", { class: "f" }, t("contact"), f.contact), h("label", { class: "f" }, t("due_date"), f.due)),
      h("label", { class: "f" }, t("note"), f.note)),
    err,
    h("div", { class: "dock" }, btn),
  );
  shell(form);
}

// ------------------------------------------------------------------ 订单详情
async function orderView(id) {
  const d = await rpc("order_detail", { p_order: id, p_lang: getLang() });
  if (!d) { shell(h("div", { class: "narrow stack" }, backLink(), h("div", { class: "err" }, t("not_found_order", { id })))); return; }
  const urls = await signedUrls(d.photos.map((p) => p.path));
  if (me.role === "driver") return driverView(d, urls);

  const open = !["delivered", "cancelled"].includes(d.status);
  const canEdit = (me.role === "company" && open) || (me.role === "sales" && d.status === "pending" && d.sales?.id === me.id);
  const head = h("div", { class: "row" },
    h("span", { class: "muted small" }, `#${d.id}`), h("h1", { style: "font-size:20px" }, d.customer),
    statusChip(d), flagChips(d), h("span", { class: "spacer" }),
    canEdit ? h("a", { href: `#/order/${d.id}/edit`, class: "btn" }, t("edit_order")) : null,
    me.role === "company" && open ? h("a", { href: `#/order/${d.id}/cancel`, class: "btn danger", "data-action": "cancel" }, t("cancel_order")) : null);

  const actions = [];
  if (d.status === "cancelled") actions.push(h("div", { class: "err", "data-state": "cancelled" }, t("cancelled_info", { t: fmtFull(d.cancelled_at), r: d.cancel_reason })));
  if (me.role === "company" && ["pending", "assigned"].includes(d.status)) actions.push(await assignBox(d));
  if (me.role === "company" && d.has_issue) actions.push(h("div", { class: "card" }, h("h2", {}, t("issue_title")),
    h("div", { class: "note" }, d.issue_note || t("issue_default")),
    h("button", { class: "btn", type: "button", onclick: async () => {
      try { await rpc("resolve_issue", { p_order: d.id, p_note: null, p_via: null }); toast(t("resolved")); route(); } catch (e) { toast(errText(e)); }
    } }, t("mark_resolved"))));

  shell(h("div", { class: "page" }, backLink(), h("div", { class: "split" },
    h("div", { class: "main" }, head, ...actions, itemsCard(d), infoCard(d), logCard(d)),
    h("aside", { class: "side" }, stepsCard(d), photosCard(d, urls)))));
}

function itemsCard(d) {
  const modified = d.items.some((i) => Number(i.qty) !== Number(i.original_qty) || i.removed);
  return h("section", { class: "card" },
    h("div", { class: "row" }, h("h2", {}, t("items_title")), modified ? h("span", { class: "chip warn" }, t("qty_changed")) : null),
    h("div", { class: "tablewrap" }, h("table", { class: "t" },
      h("thead", {}, h("tr", {}, h("th", {}, t("item")), h("th", { style: "text-align:right" }, t("qty")))),
      h("tbody", {}, d.items.map((i) => {
        const changed = Number(i.qty) !== Number(i.original_qty);
        return h("tr", { class: i.removed ? "removed" : "" },
          h("td", {}, catLabel(i.category), i.spec ? h("div", { class: "small muted" }, i.spec) : null),
          h("td", { style: "text-align:right;white-space:nowrap" }, i.removed ? t("removed_was", { q: qu(i.original_qty, i.unit) })
            : [changed ? h("span", { class: "was" }, Number(i.original_qty) === 0 ? t("added") : qu(i.original_qty, i.unit)) : null,
               h("strong", {}, qu(i.qty, i.unit))]));
      })))));
}
function infoCard(d) {
  return h("section", { class: "card" }, h("h2", {}, t("delivery_info")), h("dl", { class: "kv" },
    h("dt", {}, t("address")), h("dd", {}, d.address || "—"), h("dt", {}, t("contact")), h("dd", {}, d.contact || "—"),
    h("dt", {}, t("due_date")), h("dd", {}, d.due_date || "—"), h("dt", {}, t("note")), h("dd", {}, d.note || "—"),
    h("dt", {}, t("sales")), h("dd", {}, d.sales?.name || "—"), h("dt", {}, t("driver")), h("dd", {}, d.driver?.name || t("not_assigned")),
    h("dt", {}, t("ts_created")), h("dd", {}, timeEl(d.created_at, fmtFull(d.created_at))),
    h("dt", {}, t("ts_updated")), h("dd", {}, timeEl(d.updated_at, fmtFull(d.updated_at)))));
}
function logCard(d) {
  return h("section", { class: "card" }, h("h2", {}, t("log_title")),
    h("ol", { class: "log" }, d.timeline.map((e) => h("li", { class: e.type === "modified" ? "hl" : "" },
      h("span", { class: "tiny muted" }, `${e.by || t("system")} · ${viaText(e.via)} · `, timeEl(e.at, fmtFull(e.at))),
      h("span", {}, e.summary)))));
}
function stepsCard(d) {
  const idx = STATUS_ORDER.indexOf(d.status);
  return h("section", { class: "card" }, h("h2", {}, t("status_title")), h("ol", { class: "steps" },
    STATUS_ORDER.map((s, i) => h("li", { style: i > idx ? "color:var(--muted)" : "" },
      h("span", { class: `dot ${i < idx || (i === idx && s === "delivered") ? "done" : i === idx ? "now" : ""}` }),
      h("span", { style: "display:flex;flex-direction:column" },
        h("span", { style: i === idx ? "font-weight:700" : "" }, statusLabel(s), i === idx && s !== "delivered" ? t("current") : ""),
        stepTime(d, s) ? h("span", { class: "tiny muted" }, timeEl(stepTime(d, s), fmtFull(stepTime(d, s)))) : null)))));
}
function stepTime(d, s) {
  return { pending: d.created_at, assigned: d.assigned_at, delivering: d.started_at, delivered: d.delivered_at }[s];
}
function photosCard(d, urls) {
  const group = (kind, title) => {
    const list = d.photos.filter((p) => p.kind === kind);
    return h("div", { class: "stack", style: "gap:6px" }, h("span", { class: "small muted" }, title),
      list.length ? h("div", { class: "photos" }, list.map((p) => h("a", { href: urls[p.path] || "#", target: "_blank", rel: "noopener" },
        h("img", { class: "photo", src: urls[p.path] || "", alt: title, loading: "lazy" })))) : h("span", { class: "tiny muted" }, t("none_yet")));
  };
  const canAdd = (me.role === "company" && !["delivered", "cancelled"].includes(d.status)) || (me.role === "sales" && d.status === "pending");
  return h("section", { class: "card" }, h("h2", {}, t("photos")), group("order", t("order_photos")), group("signoff", t("signoff_photos")),
    canAdd ? h("label", { class: "btn" }, icon(I.cam, 16), t("add_order_photo"), pickPhotos(async (fs) => {
      try { for (const f of fs) await uploadPhoto(d.id, "order", f); toast(t("photo_uploaded")); route(); } catch (e) { toast(errText(e)); }
    })) : null);
}
async function assignBox(d) {
  const { data: drivers } = await sb.from("profiles").select("id,name").eq("role", "driver").eq("active", true).order("name");
  const sel = h("select", { class: "i", id: "drv" }, h("option", { value: "" }, t("choose_driver")),
    (drivers || []).map((x) => h("option", { value: x.id, selected: d.driver?.id === x.id }, x.name)));
  return h("section", { class: "card" }, h("h2", {}, d.driver ? t("reassign_title") : t("assign_title")),
    h("div", { class: "row" }, h("label", { class: "sr", for: "drv" }, t("driver")), h("div", { style: "flex:1 1 200px" }, sel),
      h("button", { class: "btn primary", type: "button", "data-action": "assign", onclick: async (e) => {
        if (!sel.value) return toast(t("choose_driver_first"));
        const btn = e.currentTarget; btn.disabled = true;
        try { await rpc("assign_driver", { p_order: d.id, p_driver: sel.value, p_via: null }); toast(t("assigned_toast")); route(); }
        catch (ex) { toast(errText(ex)); btn.disabled = false; }
      } }, t("assign"))),
    (drivers || []).length ? null : h("p", { class: "small muted", style: "margin:0" }, t("no_drivers")));
}

// 常用原因：点一下填进输入框
function reasonChips(target, keys) {
  return h("div", { class: "row", style: "gap:8px" }, h("span", { class: "tiny muted" }, t("quick_reasons")),
    keys.map((k) => h("button", { type: "button", class: "chip-btn", onclick: () => { target.value = t(k); target.focus(); } }, t(k))));
}

// 拍签收照片后直接确认送达
async function deliverWithPhoto(orderId, file, btn) {
  try {
    if (btn) { btn.classList.add("busy"); btn.setAttribute("aria-busy", "true"); }
    toast(t("uploading"));
    await uploadPhoto(orderId, "signoff", file);
    await rpc("confirm_delivered", { p_order: orderId, p_via: null });
    toast(t("delivered_toast"));
  } catch (e) { toast(errText(e)); }
  route();
}
function photoDeliverButton(d, primary = true) {
  const lbl = h("label", { class: `btn big ${primary ? "primary" : ""}`, "data-action": "photo-deliver" }, icon(I.cam, 22), t("photo_deliver"));
  lbl.append(pickPhotos((fs) => deliverWithPhoto(d.id, fs[0], lbl), { capture: true, multiple: false }));
  return lbl;
}

// 司机首页的卡片：不用点进去就能导航、出发、拍照送达
function driverCard(o) {
  const items = itemsText(o.order_items);
  const tel = ((o.contact || "").match(/[+\d][\d\s()-]{6,}/) || [])[0];
  const act = [];
  if (o.address) act.push(h("a", { class: "btn", target: "_blank", rel: "noopener", href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(o.address)}` }, t("navigate")));
  if (tel) act.push(h("a", { class: "btn", href: `tel:${tel.replace(/[^\d+]/g, "")}` }, t("call")));
  if (o.status === "assigned") act.push(h("button", { class: "btn primary", type: "button", "data-action": "start", onclick: async (e) => {
    e.currentTarget.disabled = true;
    try { await rpc("start_delivery", { p_order: o.id, p_via: null }); toast(t("started_toast")); } catch (ex) { toast(errText(ex)); }
    route();
  } }, t("go")));
  if (o.status === "delivering") act.push(photoDeliverButton(o));
  return h("div", { class: "ocard" },
    h("div", { class: "meta" }, h("span", {}, `#${o.id}`), statusChip(o)),
    h("a", { href: `#/order/${o.id}`, class: "cust", style: "color:var(--text);text-decoration:none;font-size:17px" }, o.customer, " ›"),
    o.address ? h("div", {}, o.address) : null,
    h("div", { class: "items" }, items.map((x) => h("div", {}, x))),
    h("div", { class: "row", style: "gap:6px" }, flagChips(o), o.due_date ? h("span", { class: "tiny muted" }, t("due_on", { d: o.due_date })) : null),
    o.note ? h("div", { class: "info small" }, t("note_is", { n: o.note })) : null,
    act.length ? h("div", { class: "card-actions" }, act) : null);
}

// ------------------------------------------------------------------ 司机送货单
function driverView(d, urls) {
  const active = ["assigned", "delivering"].includes(d.status);
  const signoffs = d.photos.filter((p) => p.kind === "signoff");
  const dock = h("div", { class: "dock" });
  const act = (fn, msg) => async () => { try { await fn(); toast(msg); route(); } catch (e) { toast(errText(e)); } };
  if (d.status === "assigned") dock.append(h("button", { class: "btn primary big", type: "button", "data-action": "start",
    onclick: act(() => rpc("start_delivery", { p_order: d.id, p_via: null }), t("started_toast")) }, t("start_delivery")));
  if (active) {
    // 已经有签收照片（比如 Agent 传的）就直接确认；否则拍照即送达
    if (signoffs.length) dock.append(h("button", { class: "btn primary big", type: "button", "data-action": "delivered",
      onclick: act(() => rpc("confirm_delivered", { p_order: d.id, p_via: null }), t("delivered_toast")) }, icon(I.check, 22), t("confirm_delivered")));
    else dock.append(photoDeliverButton(d, d.status === "delivering"));
    dock.append(h("div", { class: "grid2" },
      h("a", { href: `#/order/${d.id}/edit`, class: "btn", "data-action": "edit" }, t("edit_items")),
      h("button", { class: "btn", type: "button", "data-action": "issue", onclick: () => issueDialog(d) }, t("report_issue"))));
  }
  const tel = (d.contact.match(/[+\d][\d\s()-]{6,}/) || [])[0];
  shell(h("div", { class: "narrow stack" },
    backLink("#/", t("my_deliveries")),
    h("div", { class: "row" }, h("h1", { style: "font-size:20px" }, t("delivery_no", { id: d.id })), statusChip(d), flagChips(d)),
    h("div", { class: "tiny muted row", style: "gap:4px 12px" },
      d.assigned_at ? h("span", {}, t("ts_assigned", { t: "" }), timeEl(d.assigned_at, fmtFull(d.assigned_at))) : null,
      d.started_at ? h("span", {}, t("ts_started", { t: "" }), timeEl(d.started_at, fmtFull(d.started_at))) : null),
    h("section", { class: "card" }, h("h2", { class: "small muted" }, t("where_to")),
      h("div", { style: "font-size:18px;font-weight:700" }, d.customer),
      h("div", {}, d.address || t("no_address")), h("div", { class: "muted" }, t("recipient_is", { c: d.contact || t("not_given") })),
      d.due_date ? h("div", { class: "muted" }, t("due_is", { d: d.due_date })) : null,
      d.note ? h("div", { class: "info" }, t("note_is", { n: d.note })) : null,
      h("div", { class: "grid2" },
        d.address ? h("a", { class: "btn", target: "_blank", rel: "noopener", href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.address)}` }, t("navigate")) : null,
        tel ? h("a", { class: "btn", href: `tel:${tel.replace(/[^\d+]/g, "")}` }, t("call")) : null)),
    h("section", { class: "card" }, h("h2", { class: "small muted" }, t("to_deliver")),
      d.items.filter((i) => !i.removed).map((i) => h("div", { class: "row", style: "justify-content:space-between;min-height:40px;border-bottom:1px solid var(--line2)" },
        h("span", {}, `${catLabel(i.category)}${i.spec ? " · " + i.spec : ""}`),
        h("strong", {}, Number(i.qty) !== Number(i.original_qty) ? h("span", { class: "was" }, Number(i.original_qty) === 0 ? t("added") : fmtQty(i.original_qty)) : null, qu(i.qty, i.unit)))),
      d.modified_by ? h("div", { class: "note" }, t("driver_changed_note", { role: roleLabel(d.modified_by) })) : null),
    d.has_issue ? h("div", { class: "err" }, t("issue_reported_is", { n: d.issue_note })) : null,
    signoffs.length ? h("section", { class: "card" }, h("h2", { class: "small muted" }, t("signoff_photos")),
      h("div", { class: "photos" }, signoffs.map((p) => h("img", { class: "photo", src: urls[p.path] || "", alt: t("signoff_photos") })))) : null,
    d.status === "delivered" ? h("div", { class: "info", "data-state": "delivered" }, t("delivered_at", { t: fmtTime(d.delivered_at) })) : null,
    d.status === "cancelled" ? h("div", { class: "err", "data-state": "cancelled" }, t("cancelled_info", { t: fmtFull(d.cancelled_at), r: d.cancel_reason })) : null,
    dock));
}
function issueDialog(d) {
  const ta = h("textarea", { class: "i", id: "issue", placeholder: t("issue_ph") });
  shell(h("div", { class: "narrow stack" }, backLink(`#/order/${d.id}`, t("back_to_delivery")),
    h("h1", { style: "font-size:20px" }, t("issue_page_title", { id: d.id })),
    h("label", { class: "f", for: "issue" }, t("issue_question"), ta),
    reasonChips(ta, ["r_not_home", "r_wrong_address", "r_refused", "r_damaged"]),
    h("button", { class: "btn primary big", type: "button", onclick: async () => {
      try { await rpc("report_issue", { p_order: d.id, p_note: ta.value, p_via: null }); toast(t("issue_sent")); location.hash = `#/order/${d.id}`; route(); }
      catch (e) { toast(errText(e)); }
    } }, t("send"))));
}

// 数量加减：手机上不用弹键盘
function stepper(i) {
  const inp = h("input", { class: "i qtyin", id: `q${i.id}`, type: "number", inputmode: "decimal", min: "0", step: "any", value: i.newQty, disabled: i.remove, oninput: (e) => (i.newQty = e.target.value) });
  const bump = (dlt) => () => { const v = Math.max(0, (Number(inp.value) || 0) + dlt); inp.value = String(v); i.newQty = String(v); };
  return h("span", { class: "stepper" },
    h("button", { type: "button", class: "iconbtn", "aria-label": t("decrease"), disabled: i.remove, onclick: bump(-1) }, "−"),
    inp,
    h("button", { type: "button", class: "iconbtn", "aria-label": t("increase"), disabled: i.remove, onclick: bump(1) }, "+"));
}

// ------------------------------------------------------------------ 修改订单
async function editView(id) {
  const d = await rpc("order_detail", { p_order: id, p_lang: getLang() });
  if (!d) { location.hash = "#/"; return; }
  const isDriver = me.role === "driver";
  const items = d.items.filter((i) => !i.removed).map((i) => ({ ...i, newQty: fmtQty(i.qty), remove: false }));
  const adds = [];
  const fields = { customer: d.customer, address: d.address, contact: d.contact, due_date: d.due_date || "", note: d.note };
  const fieldInputs = {};
  const reason = h("textarea", { class: "i", id: "reason", placeholder: isDriver ? t("reason_ph_driver") : t("reason_ph_company") });
  const err = h("div", { class: "err", role: "alert", hidden: true });

  const itemRows = h("div", { class: "stack" });
  const drawItems = () => itemRows.replaceChildren(
    ...items.map((i) => h("div", { class: "row", style: `justify-content:space-between;${i.remove ? "opacity:.5" : ""}` },
      h("span", { style: "flex:1 1 160px" }, `${catLabel(i.category)}${i.spec ? " · " + i.spec : ""}`),
      h("label", { class: "sr", for: `q${i.id}` }, t("qty")),
      stepper(i),
      h("span", { class: "muted", style: "min-width:24px" }, i.unit),
      h("button", { type: "button", class: "btn link danger", onclick: () => { i.remove = !i.remove; drawItems(); } }, i.remove ? t("restore") : t("delete")))),
    adds.length ? h("div", { class: "small muted" }, t("new_items")) : null,
    adds.length ? itemEditor(adds) : null,
    h("button", { type: "button", class: "btn", onclick: () => { adds.push({ category: "oil", spec: "", qty: "", unit: defaultUnit("oil") }); drawItems(); } }, icon(I.plus, 14), t("add_item")));
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
    if (!ch.items.length && !Object.keys(ch.fields).length) { err.textContent = t("nothing_changed"); err.hidden = false; return; }
    if (me.role !== "sales" && !reason.value.trim()) { err.textContent = t("need_reason"); err.hidden = false; return; }
    save.disabled = true;
    try {
      const n = await rpc("modify_order", { p_order: d.id, p_changes: ch, p_reason: reason.value.trim() || null, p_via: null });
      toast(t("saved_toast", { n }));
      location.hash = `#/order/${d.id}`;
    } catch (e) { err.textContent = errText(e); err.hidden = false; save.disabled = false; }
  } }, t("save_changes"));

  for (const [k, label] of [["customer", "customer"], ["address", "address"], ["contact", "contact"], ["due_date", "due_date"], ["note", "note"]]) {
    fieldInputs[k] = k === "note" ? h("textarea", { class: "i", value: fields[k] }) : h("input", { class: "i", type: k === "due_date" ? "date" : "text", value: fields[k] });
    fieldInputs[k].dataset.label = t(label);
  }
  shell(h("div", { class: "narrow stack" }, backLink(`#/order/${d.id}`, t("cancel")),
    h("h1", { style: "font-size:20px" }, t("edit_title", { id: d.id })),
    h("div", { class: "info" }, t("edit_notice")),
    h("section", { class: "card" }, h("h2", {}, t("items")), itemRows),
    isDriver ? null : h("section", { class: "card" }, h("h2", {}, t("delivery_info")),
      Object.values(fieldInputs).map((el) => h("label", { class: "f" }, el.dataset.label, el))),
    h("section", { class: "card" }, h("label", { class: "f", for: "reason" }, me.role === "sales" ? t("reason_optional") : t("reason_required"), reason),
      me.role === "driver" ? reasonChips(reason, ["r_customer_less", "r_customer_more", "r_out_of_stock", "r_damaged"])
        : me.role === "company" ? reasonChips(reason, ["r_out_of_stock", "r_customer_request", "r_entry_error"]) : null),
    err, h("div", { class: "dock" }, save)));
}

// ------------------------------------------------------------------ 取消订单（公司）
async function cancelView(id) {
  const d = await rpc("order_detail", { p_order: id, p_lang: getLang() });
  if (!d || me.role !== "company") { location.hash = "#/"; return; }
  const ta = h("textarea", { class: "i", id: "creason" });
  const err = h("div", { class: "err", role: "alert", hidden: true });
  shell(h("div", { class: "narrow stack" }, backLink(`#/order/${id}`, t("keep_order")),
    h("h1", { style: "font-size:20px" }, t("cancel_title", { id })),
    h("div", { class: "card" }, h("strong", {}, d.customer), h("div", { class: "small muted" }, itemsText(d.items).join("、"))),
    h("div", { class: "note" }, t("cancel_notice")),
    h("label", { class: "f", for: "creason" }, t("cancel_reason"), ta),
    reasonChips(ta, ["r_not_wanted", "r_duplicate", "r_out_of_stock", "r_reschedule"]),
    err,
    h("button", { class: "btn primary big", type: "button", "data-action": "confirm-cancel", style: "background:var(--bad);border-color:var(--bad)", onclick: async (e) => {
      const btn = e.currentTarget;
      err.hidden = true;
      if (!ta.value.trim()) { err.textContent = errText({ hint: "cancel_reason_required" }); err.hidden = false; return; }
      btn.disabled = true;
      try { await rpc("cancel_order", { p_order: id, p_reason: ta.value.trim(), p_via: null }); toast(t("cancelled_toast")); location.hash = `#/order/${id}`; }
      catch (ex) { err.textContent = errText(ex); err.hidden = false; btn.disabled = false; }
    } }, t("confirm_cancel"))));
}

// ------------------------------------------------------------------ 通知
async function notificationsView() {
  const list = await rpc("my_notifications", { p_unread_only: false, p_limit: 100, p_lang: getLang() });
  shell(h("div", { class: "narrow stack" },
    h("div", { class: "row" }, h("h1", { style: "font-size:20px" }, t("notifications")), h("span", { class: "spacer" }),
      unread ? h("button", { class: "btn", type: "button", onclick: async () => { await rpc("mark_read", { p_event_ids: null }); unread = 0; route(); } }, t("mark_all_read")) : null),
    h("div", { class: "list" }, list.length ? list.map((n) => h("a", {
      href: `#/order/${n.order_id}`, class: `notice ${n.read_at ? "" : "unread"}`,
      onclick: () => { if (!n.read_at) rpc("mark_read", { p_event_ids: [n.event_id] }).then(refreshUnread); },
    }, h("span", {}, n.summary), h("span", { class: "tiny muted" }, `${n.actor_name || ""} · ${viaText(n.via)} · `, timeEl(n.created_at))))
      : h("div", { class: "empty" }, t("no_notifications")))));
}
async function refreshUnread() {
  try {
    const list = await rpc("my_notifications", { p_unread_only: true, p_limit: 200, p_lang: getLang() });
    const n = list.length;
    if (n !== unread) {
      unread = n;
      const b = document.querySelector(".top a[href='#/notifications']");
      if (b) { b.querySelector(".badge")?.remove(); b.setAttribute("aria-label", t("notifications_label", { n })); if (n) b.append(h("span", { class: "badge", "aria-hidden": "true" }, n > 99 ? "99+" : n)); }
    }
  } catch { /* 网络不好时下次再试 */ }
}

// ------------------------------------------------------------------ 设置：语言、Agent 令牌、账号管理
async function settingsView() {
  const tokens = await api("/tokens");
  const tokenBox = h("div", { class: "stack" });
  const label = h("input", { class: "i", id: "tlabel", placeholder: t("agent_name_ph") });
  const sec = [
    h("section", { class: "card" }, h("h2", {}, h("label", { for: "langsel" }, t("my_language"))),
      langSelect(async (l) => {
        setLang(l, true);
        try { await rpc("set_my_lang", { p_lang: l }); me.lang = l; } catch (e) { toast(errText(e)); }
        route();
      }),
      h("p", { class: "small muted", style: "margin:0" }, t("language_hint"))),
    h("section", { class: "card" }, h("h2", {}, t("my_tokens")),
      h("p", { class: "small muted", style: "margin:0" }, t("tokens_intro")),
      tokens.length ? h("div", { class: "list" }, tokens.map((tk) => h("div", { class: "row", style: "justify-content:space-between" },
        h("span", {}, tk.label, h("span", { class: "tiny muted" }, ` · ${t("created_at", { t: fmtTime(tk.created_at) })} · ${tk.last_used_at ? t("last_used", { t: fmtTime(tk.last_used_at) }) : t("never_used")}`)),
        h("button", { class: "btn link danger", type: "button", onclick: async () => { await api(`/tokens/${tk.id}`, { method: "DELETE" }); toast(t("revoked")); route(); } }, t("revoke")))))
        : h("span", { class: "small muted" }, t("no_tokens")),
      h("div", { class: "row" }, h("label", { class: "sr", for: "tlabel" }, t("agent_name")), h("div", { style: "flex:1 1 200px" }, label),
        h("button", { class: "btn primary", type: "button", onclick: async () => {
          try {
            const r = await api("/tokens", { method: "POST", body: JSON.stringify({ label: label.value || "Agent" }) });
            const docs = DOCS[getLang()];
            tokenBox.replaceChildren(h("div", { class: "note" }, r.message),
              h("div", { class: "code" }, t("token_block", { api: API, token: r.token, docs })),
              h("button", { class: "btn", type: "button", onclick: () => navigator.clipboard.writeText(t("copy_text", { api: API, token: r.token, docs })).then(() => toast(t("copied"))) }, t("copy_for_agent")));
          } catch (e) { toast(errText(e)); }
        } }, t("create_token"))),
      tokenBox),
  ];
  if (me.is_admin) sec.push(await adminSection());
  sec.push(h("button", { class: "btn", type: "button", onclick: async () => { await sb.auth.signOut(); me = null; loginView(); } }, t("sign_out")));
  shell(h("div", { class: "narrow stack" }, h("h1", { style: "font-size:20px" }, t("settings")), ...sec));
}

async function adminSection() {
  const users = await api("/admin/users");
  const f = { name: h("input", { class: "i" }), login: h("input", { class: "i", placeholder: t("login_ph") }),
    pw: h("input", { class: "i", type: "text", placeholder: t("password_ph") }),
    role: h("select", { class: "i" }, ROLES.map((k) => h("option", { value: k }, roleLabel(k)))),
    lang: h("select", { class: "i" }, Object.entries(LANGS).map(([k, v]) => h("option", { value: k, selected: getLang() === k }, v))) };
  const groups = ROLES.map((r) => {
    const list = users.filter((u) => u.role === r);
    return h("div", { class: "stack", style: "gap:6px" }, h("span", { class: "small muted" }, `${roleLabel(r)} · ${list.length}`),
      list.map((u) => h("div", { class: "row", style: `justify-content:space-between;${u.active ? "" : "opacity:.55"}` },
        h("span", {}, u.name, h("span", { class: "tiny muted" }, ` · ${u.login || ""} · ${LANGS[u.lang] || ""}${u.is_admin ? " · " + t("admin_badge") : ""}${u.active ? "" : " · " + t("disabled_badge")}`)),
        h("span", { class: "row", style: "gap:4px" },
          h("button", { class: "btn link", type: "button", onclick: async () => {
            const pw = prompt(t("new_password_prompt", { name: u.name })); if (!pw) return;
            try { await api(`/admin/users/${u.id}/password`, { method: "POST", body: JSON.stringify({ password: pw }) }); toast(t("password_reset")); } catch (e) { toast(errText(e)); }
          } }, t("reset_password")),
          u.tokens ? h("button", { class: "btn link", type: "button", onclick: async () => {
            await api(`/admin/users/${u.id}/tokens/reset`, { method: "POST" }); toast(t("tokens_revoked")); route(); } }, t("revoke_tokens")) : null,
          u.id === me.id ? null : h("button", { class: "btn link danger", type: "button", onclick: async () => {
            await api(`/admin/users/${u.id}`, { method: "PATCH", body: JSON.stringify({ active: !u.active }) }); route(); } }, u.active ? t("disable") : t("enable"))))));
  });
  return h("section", { class: "card" }, h("h2", {}, t("admin_title")), ...groups,
    h("h2", { style: "margin-top:8px" }, t("add_account")),
    h("div", { class: "grid2" }, h("label", { class: "f" }, t("name"), f.name), h("label", { class: "f" }, t("role"), f.role),
      h("label", { class: "f" }, t("login"), f.login), h("label", { class: "f" }, t("initial_password"), f.pw),
      h("label", { class: "f" }, t("user_lang"), f.lang)),
    h("p", { class: "tiny muted", style: "margin:0" }, t("no_email_hint")),
    h("button", { class: "btn primary", type: "button", onclick: async () => {
      try {
        const r = await api("/admin/users", { method: "POST", body: JSON.stringify({ name: f.name.value, role: f.role.value, login: f.login.value, password: f.pw.value, lang: f.lang.value }) });
        toast(r.message); route();
      } catch (e) { toast(errText(e)); }
    } }, t("add")));
}

// ------------------------------------------------------------------ 路由与启动
async function route() {
  if (!me) return;
  const hash = location.hash || "#/";
  try {
    let m;
    if (hash === "#/new") newOrderView();
    else if ((m = hash.match(/^#\/order\/(\d+)\/edit$/))) await editView(Number(m[1]));
    else if ((m = hash.match(/^#\/order\/(\d+)\/cancel$/))) await cancelView(Number(m[1]));
    else if ((m = hash.match(/^#\/order\/(\d+)$/))) await orderView(Number(m[1]));
    else if (hash === "#/notifications") await notificationsView();
    else if (hash === "#/settings") await settingsView();
    else await homeView();
    window.scrollTo(0, 0);
  } catch (e) {
    shell(h("div", { class: "narrow stack" }, backLink(), h("div", { class: "err" }, t("error_prefix") + errText(e))));
  }
}

async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return loginView();
  const { data, error } = await sb.from("profiles").select("id,name,role,is_admin,active,lang").eq("id", session.user.id).maybeSingle();
  if (!error && !data && (await rpc("needs_bootstrap", {}).catch(() => false))) return bootstrapView();
  if (error || !data || !data.active) { await sb.auth.signOut(); return loginView(t("account_not_ready")); }
  me = data;
  setLang(detectLang(me.lang));
  // 在登录页选过语言的，同步到账号上，这样 Agent 收到的回复也是这个语言
  const saved = savedLang();
  if (saved && saved !== me.lang && ["zh", "en", "es"].includes(saved)) rpc("set_my_lang", { p_lang: saved }).then(() => (me.lang = saved)).catch(() => {});
  await refreshUnread();
  clearInterval(pollTimer);
  pollTimer = setInterval(refreshUnread, 60000);
  route();
}

window.addEventListener("hashchange", route);
sb.auth.onAuthStateChange((ev) => { if (ev === "SIGNED_OUT") { me = null; loginView(); } });
boot();
