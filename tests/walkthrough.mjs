// 按角色走查：管理员、销售、公司、司机各自把常见操作和容易出错的情况走一遍。
// 和 e2e_ui.mjs 不同，这里遇到问题不立刻停下，而是记下来继续走，最后写一份报告 screenshots/walkthrough/报告.md。
// 每一屏都截图，并自动检查：页面脚本错误、手机上横向溢出、图片显示不出来、坏掉的文字占位符。
// 前提：e2e_api.sh 已经建好账号（boss@example.com、sales-a、sales-b、office2、wang01、li02）。
import { chromium } from "playwright";
import fs from "node:fs";
import zlib from "node:zlib";

const WEB = process.env.WEB_URL || "http://127.0.0.1:8080/";
const OUT = "screenshots/walkthrough";
fs.mkdirSync(OUT, { recursive: true });
const PHOTO = "/tmp/walk-photo.png";
fs.writeFileSync(PHOTO, makePng(640, 480));

const results = [];   // { role, step, ok, detail }
const shots = [];
let role = "";
let n = 0;
const ok = (step, cond, detail = "") => { results.push({ role, step, ok: !!cond, detail }); console.log(`${cond ? "通过" : "问题"}：[${role}] ${step}${detail ? "（" + detail + "）" : ""}`); return !!cond; };

const browser = await chromium.launch();
const PHONE = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const DESK = { viewport: { width: 1360, height: 900 } };

async function open(opts, login, pw, locale = "zh-CN", keepLang = false) {
  const ctx = await browser.newContext({ ...opts, locale, timezoneId: "America/Toronto" });
  const page = await ctx.newPage();
  page.errors = [];
  page.on("pageerror", (e) => page.errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/favicon|Failed to load resource/.test(m.text())) page.errors.push(m.text()); });
  page.on("dialog", (d) => d.accept(page.nextPrompt ?? undefined));
  await page.goto(WEB);
  await page.fill("#login", login);
  await page.fill("#pw", pw);
  await page.click("button[type=submit]");
  await page.waitForSelector(".top", { timeout: 15000 });
  // 前面的测试可能把这个账号切成了别的语言，走查统一用中文（除非指定）
  if (keepLang !== true) {
    await page.goto(WEB + "#/settings");
    await page.waitForSelector("#langsel");
    if ((await page.locator("#langsel").inputValue()) !== "zh") {
      await page.selectOption("#langsel", "zh");
      await page.waitForSelector("h1:has-text('设置')");
    }
    await page.goto(WEB + "#/");
    await page.waitForSelector(".top");
  }
  return { ctx, page };
}

async function shot(page, name) {
  n += 1;
  await page.waitForTimeout(500);
  const file = `${String(n).padStart(2, "0")}-${role}-${name}.png`;
  await page.screenshot({ path: `${OUT}/${file}`, fullPage: true });
  shots.push(file);
  // 自动检查
  const info = await page.evaluate(() => ({
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    broken: [...document.images].filter((i) => i.complete && i.getAttribute("src") && i.naturalWidth === 0).length,
    placeholders: (document.body.innerText.match(/\{[a-z_]+\}|undefined|NaN|\[object Object\]/g) || []).slice(0, 3),
    wide: window.innerWidth,
  }));
  if (info.overflow > 2) ok(`${name}：页面没有横向溢出`, false, `宽 ${info.wide}，多出 ${info.overflow}px`);
  if (info.broken) ok(`${name}：图片都能显示`, false, `${info.broken} 张显示不出来`);
  if (info.placeholders.length) ok(`${name}：没有坏掉的文字`, false, info.placeholders.join("、"));
  if (page.errors.length) { ok(`${name}：没有脚本错误`, false, page.errors.join("；").slice(0, 300)); page.errors = []; }
}

async function step(name, fn, page) {
  try { await fn(); }
  catch (e) {
    ok(name, false, "出错：" + String(e.message || e).split("\n")[0].slice(0, 200));
    if (page) await shot(page, "出错-" + name.slice(0, 12)).catch(() => {});
  }
}

const text = async (page, sel = "main") => (await page.locator(sel).first().innerText().catch(() => ""));
// 等新弹出的提示（不会读到上一条还没消失的）
const toastText = async (page, before) => {
  const start = before ?? 0;
  await page.waitForFunction((k) => document.querySelectorAll(".toast").length > k, start, { timeout: 5000 }).catch(() => {});
  return (await page.locator(".toast").last().innerText().catch(() => "")).trim();
};
const clickForToast = async (page, locator) => {
  const before = await page.locator(".toast").count();
  await locator.click();
  return toastText(page, before);
};
const orderIdFromUrl = (page) => Number((page.url().match(/order\/(\d+)/) || [])[1]);

// =====================================================================================
// 1. 管理员（电脑）
role = "管理员";
let { ctx, page } = await open(DESK, "boss@example.com", "boss-pass-1234");
await step("看板能打开", async () => { await page.waitForSelector(".board"); await shot(page, "看板"); ok("看板能打开", true); }, page);
await step("账号管理", async () => {
  await page.click("a[href='#/settings']");
  await page.waitForSelector("text=账号管理");
  await shot(page, "设置与账号管理");
  // 密码太短
  const add = page.locator("section:has-text('添加账号')").last();
  await add.locator("label:has-text('姓名') input").fill("测试销售三");
  await add.locator("label:has-text('登录名') input").fill("ventas03");
  await add.locator("label:has-text('初始密码') input").fill("123");
  const t1 = await clickForToast(page, add.locator("button:has-text('添加')"));
  ok("密码太短时给出提示", /8/.test(t1), t1);
  // 正常添加一个西班牙语销售
  await add.locator("label:has-text('初始密码') input").fill("pass-ventas03");
  await add.locator("label:has-text('语言') select").selectOption("es");
  const t2 = await clickForToast(page, add.locator("button:has-text('添加')"));
  ok("能添加新销售账号", /ventas03/.test(t2), t2);
  await page.waitForTimeout(800);
  ok("新账号出现在列表里，语言是 Español", /测试销售三[\s\S]*ventas03[\s\S]*Español/.test(await text(page)));
  // 同一个登录名再加一次
  await add.locator("label:has-text('姓名') input").fill("重复");
  await add.locator("label:has-text('登录名') input").fill("ventas03");
  await add.locator("label:has-text('初始密码') input").fill("pass-ventas03");
  const t3 = await clickForToast(page, add.locator("button:has-text('添加')"));
  ok("重复的登录名会被拒绝并提示", t3.length > 0 && !/已为/.test(t3), t3);
  await shot(page, "添加账号后");
}, page);
await step("令牌生成与作废", async () => {
  await page.fill("#tlabel", "测试Agent");
  await page.click("button:has-text('生成令牌')");
  await page.waitForSelector(".code");
  const code = await page.locator(".code").innerText();
  ok("生成令牌后显示接口地址和令牌", /oh_[0-9a-f]{20,}/.test(code) && /functions\/v1\/api/.test(code));
  await shot(page, "生成令牌");
  await page.reload(); await page.waitForSelector("text=我的 Agent 令牌");
  const before = await page.locator("button:has-text('作废')").count();
  await page.locator("button:has-text('作废')").first().click();
  await page.waitForTimeout(1500);
  ok("令牌能作废", (await page.locator("button:has-text('作废')").count()) === before - 1);
}, page);
await ctx.close();

// =====================================================================================
// 2. 销售（手机）
role = "销售";
({ ctx, page } = await open(PHONE, "sales-a", "pass-sales-a"));
let newOrder = 0;
await step("首页", async () => { await shot(page, "我的订单"); ok("首页显示我的订单", /我的订单/.test(await text(page))); }, page);
await step("新建订单的检查", async () => {
  await page.click("a[href='#/new']");
  await page.waitForSelector("h1:has-text('新建订单')");
  await page.click("button:has-text('发回公司')");
  ok("不填客户时提示", /客户/.test(await page.locator(".err").innerText()));
  await page.getByLabel("客户 *").fill("走查汽修");
  await page.locator("input[type=number]").first().fill("");
  await page.click("button:has-text('发回公司')");
  ok("不填数量时提示", /货品|数量/.test(await page.locator(".err").innerText()));
  await shot(page, "新建订单-提示");
}, page);
await step("提交完整订单", async () => {
  await page.setInputFiles("label.photo-add input[type=file]", [PHOTO, PHOTO]);
  await page.locator("input[placeholder*='5W-30']").first().fill("5W-30 4L");
  await page.locator("input[type=number]").first().fill("10");
  await page.getByRole("button", { name: "轮胎" }).click();
  await page.locator("input[placeholder*='5W-30']").nth(1).fill("225/65R17");
  await page.locator("input[type=number]").nth(1).fill("4");
  await page.getByLabel("送货地址").fill("88 Walk Rd, Markham");
  await page.getByLabel("收货人").fill("陈先生 905-222-3333");
  await page.getByLabel("要求送达日期").fill(new Date(Date.now() + 86400000).toLocaleDateString("sv-SE"));
  await page.getByLabel("备注").fill("后门卸货");
  await shot(page, "新建订单-填好");
  await page.click("button:has-text('发回公司')");
  await page.waitForURL(/#\/order\/\d+$/, { timeout: 20000 });
  newOrder = orderIdFromUrl(page);
  await page.waitForSelector("text=货品清单");
  const body = await text(page);
  ok("提交后进入订单详情", newOrder > 0);
  ok("详情里有下单时间", /下单时间/.test(body) && /\d{4}/.test(body));
  ok("两张订单照片都上传了", (await page.locator("img.photo").count()) >= 2);
  ok("执行状态里显示下单的具体时间", (await page.locator("ol.steps time").count()) >= 1);
  await shot(page, "订单详情");
}, page);
await step("公司处理前销售自己改单", async () => {
  await page.click("a:has-text('修改订单')");
  await page.waitForSelector("text=修改原因");
  await page.locator("input.qtyin").first().fill("12");
  await shot(page, "修改订单");
  await page.click("button:has-text('保存修改')");
  await page.waitForURL(/#\/order\/\d+$/);
  await page.waitForSelector("text=货品清单");
  ok("销售不写原因也能改自己的待处理订单", /12/.test(await text(page)));
  await shot(page, "修改后详情");
}, page);
await step("看不到别人的订单", async () => {
  await page.goto(WEB + "#/order/2");
  await page.waitForSelector(".err");
  ok("打开别的销售的订单会提示无权查看", /无权/.test(await page.locator(".err").innerText()));
}, page);
await ctx.close();

// =====================================================================================
// 3. 公司（电脑）
role = "公司";
({ ctx, page } = await open(DESK, "office2", "pass-office2"));
await step("看板和筛选", async () => {
  await page.waitForSelector(".board");
  ok("新订单出现在待公司处理", /走查汽修/.test(await page.locator("section[aria-label='待公司处理']").innerText()));
  ok("看板卡片上有下单时间", (await page.locator(".ocard time").count()) > 0);
  await shot(page, "看板");
  await page.click(".filters button:has-text('今天要送的')");
  await shot(page, "筛选-今天要送");
  await page.click(".filters button:has-text('全部订单')");
}, page);
await step("派单与改派", async () => {
  await page.click(`a[href='#/order/${newOrder}']`);
  await page.waitForSelector("text=派给司机");
  ok("没选司机就派单会提示", /司机/.test(await clickForToast(page, page.locator("button[data-action=assign]"))));
  await page.selectOption("#drv", { label: "司机老李" });
  await page.click("button[data-action=assign]");
  await page.waitForSelector("text=改派司机");
  await page.waitForTimeout(3500);
  await page.selectOption("#drv", { label: "司机老王" });
  await page.click("button[data-action=assign]");
  await page.waitForTimeout(1500);
  const body = await text(page);
  ok("改派后司机显示为老王", /司机老王/.test(body));
  ok("执行状态里有派单时间", (await page.locator("ol.steps time").count()) >= 2);
  await shot(page, "派单后详情");
}, page);
await step("公司改单", async () => {
  await page.click("a:has-text('修改订单')");
  await page.waitForSelector("text=修改原因");
  const addr = page.locator("label:has-text('送货地址') input");
  await addr.fill("99 New Rd, Markham");
  await page.click("button:has-text('保存修改')");
  ok("公司改单不写原因会提示", /原因/.test(await page.locator(".err").innerText()));
  await page.fill("#reason", "客户换了收货地址");
  await page.click("button:has-text('保存修改')");
  await page.waitForURL(/#\/order\/\d+$/);
  await page.waitForSelector("text=修改与通知记录");
  const body = await text(page);
  ok("地址已更新", /99 New Rd/.test(body));
  ok("修改记录里有原因", /客户换了收货地址/.test(body));
  ok("显示“公司已修改”标记", /公司已修改/.test(body));
  await shot(page, "改单后详情");
}, page);
await step("手机宽度下的看板", async () => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(WEB + "#/");
  await page.waitForSelector(".board");
  await shot(page, "看板-手机宽度");
  await page.setViewportSize({ width: 1360, height: 900 });
}, page);
await ctx.close();

// =====================================================================================
// 4. 司机（手机）
role = "司机";
({ ctx, page } = await open(PHONE, "li02", "pass-li02"));
await step("被改派的司机", async () => {
  await page.click("a[href='#/notifications']");
  await page.waitForSelector(".notice");
  ok("老李收到“已改派”通知", /改派/.test(await text(page)));
  await page.goto(WEB + `#/order/${newOrder}`);
  await page.waitForSelector(".err");
  ok("老李打不开已改派走的订单", /无权/.test(await page.locator(".err").innerText()));
  await shot(page, "改派后");
}, page);
await ctx.close();

({ ctx, page } = await open(PHONE, "wang01", "pass-wang01"));
await step("送货单", async () => {
  await shot(page, "我的送货单");
  await page.click(`a[href='#/order/${newOrder}']`);
  await page.waitForSelector("button[data-action=start]");
  const body = await text(page);
  ok("送货单上有派单时间", /派单/.test(body));
  ok("有导航和打电话按钮", (await page.locator("a:has-text('导航')").count()) === 1 && (await page.locator("a:has-text('打电话')").count()) === 1);
  ok("显示公司改过这张单", /改过这张单/.test(body));
  ok("显示备注", /后门卸货/.test(body));
  await shot(page, "送货单-出发前");
  await page.click("button[data-action=start]");
  await page.waitForSelector("a[data-action=edit]");
  ok("出发后显示出发时间", /出发/.test(await text(page)));
  await shot(page, "送货单-出发后");
}, page);
await step("现场改单", async () => {
  await page.click("a[data-action=edit]");
  await page.waitForSelector("text=修改原因");
  ok("司机改单页面没有送货信息可改", (await page.locator("label:has-text('送货地址')").count()) === 0);
  await page.locator("input.qtyin").first().fill("9");
  await page.click("button:has-text('保存修改')");
  ok("司机不写原因会提示", /原因/.test(await page.locator(".err").innerText()));
  await page.click("button:has-text('加一项货品')");
  await page.locator(".card select").last().selectOption("rim");
  await page.locator(".card input[type=number]").last().fill("4");
  await page.fill("#reason", "客户只要 9 箱，另加 4 个轮毂");
  await shot(page, "现场改单");
  await page.click("button:has-text('保存修改')");
  await page.waitForURL(/#\/order\/\d+$/);
  await page.waitForSelector("text=要送的货");
  const body = await text(page);
  ok("改后数量是 9", /9\s*箱/.test(body));
  ok("新增的轮毂出现在要送的货里", /轮毂/.test(body));
  await shot(page, "改单后送货单");
}, page);
await step("报告问题", async () => {
  await page.click("button[data-action=issue]");
  await page.waitForSelector("#issue");
  ok("问题不写内容会提示", (await clickForToast(page, page.locator("button:has-text('发送')"))).length > 0);
  await page.fill("#issue", "客户中午不在，下午再送");
  await page.click("button:has-text('发送')");
  await page.waitForSelector("text=已报告问题");
  await shot(page, "报告问题后");
}, page);
await step("签收与送达", async () => {
  ok("没拍签收照片时没有“确认送达”按钮", (await page.locator("button[data-action=delivered]").count()) === 0);
  await page.setInputFiles("label[data-action=signoff] input[type=file]", PHOTO);
  await page.waitForSelector("button[data-action=delivered]", { timeout: 15000 });
  await shot(page, "签收照片后");
  await page.click("button[data-action=delivered]");
  await page.waitForSelector("[data-state=delivered]");
  ok("送达后显示送达时间", /送达/.test(await text(page)));
  ok("送达后不再显示操作按钮", (await page.locator("[data-action]").count()) === 0);
  await shot(page, "已送达");
}, page);
await step("司机切换西班牙语", async () => {
  await page.click("a[href='#/settings']");
  await page.selectOption("#langsel", "es");
  await page.waitForSelector("h1:has-text('Ajustes')");
  await page.goto(WEB + `#/order/${newOrder}`);
  await page.waitForSelector("text=Entrega #" + newOrder);
  ok("西班牙语送货单正常", /Entregado/.test(await text(page)));
  await shot(page, "西班牙语送货单");
}, page);
await ctx.close();

// =====================================================================================
// 5. 公司处理问题；销售看结果
role = "公司";
({ ctx, page } = await open(DESK, "office2", "pass-office2"));
await step("处理送货问题", async () => {
  await page.click(".filters button:has-text('送货有问题的')");
  await shot(page, "筛选-送货有问题");
  await page.goto(WEB + `#/order/${newOrder}`);
  await page.waitForSelector("text=修改与通知记录");
  const btn = page.locator("button:has-text('标记为已处理')");
  if (await btn.count()) { await btn.click(); await page.waitForTimeout(1500); }
  ok("问题处理后不再显示问题标记", !/送货有问题/.test(await page.locator("main .row").first().innerText()));
  await shot(page, "订单最终-公司");
}, page);
await ctx.close();

role = "销售";
({ ctx, page } = await open(PHONE, "sales-a", "pass-sales-a"));
await step("看通知和最终结果", async () => {
  await page.click("a[href='#/notifications']");
  await page.waitForSelector(".notice");
  const body = await text(page);
  ok("收到公司改单通知", /被公司/.test(body));
  ok("收到司机改单通知", /被司机/.test(body));
  ok("收到送货问题通知", /送货有问题/.test(body));
  ok("收到已送达通知", /已送达/.test(body));
  ok("没有收到“已改派”这种司机才需要的通知", !/改派给其他司机/.test(body));
  await shot(page, "通知");
  await page.goto(WEB + `#/order/${newOrder}`);
  await page.waitForSelector("text=执行状态");
  ok("执行状态四个环节都有时间", (await page.locator("ol.steps time").count()) === 4);
  await shot(page, "订单最终-销售");
}, page);
await ctx.close();

role = "新销售";
({ ctx, page } = await open(PHONE, "ventas03", "pass-ventas03", "zh-CN", true));
await step("新开的西班牙语账号", async () => {
  ok("新账号第一次登录就是西班牙语", /Mis pedidos/.test(await text(page)));
  await shot(page, "首页");
}, page);
await ctx.close();

await browser.close();

// =====================================================================================
const bad = results.filter((r) => !r.ok);
const lines = [
  `# 按角色走查报告`, ``,
  `共检查 ${results.length} 项，发现问题 ${bad.length} 项。`, ``,
  bad.length ? `## 问题` : `## 没有发现问题`,
  ...bad.map((r) => `- [${r.role}] ${r.step}${r.detail ? "：" + r.detail : ""}`), ``,
  `## 全部检查`,
  ...results.map((r) => `- ${r.ok ? "✓" : "✗"} [${r.role}] ${r.step}${r.detail && !r.ok ? "：" + r.detail : ""}`), ``,
  `## 截图`, ...shots.map((s) => `- ${s}`),
];
fs.writeFileSync(`${OUT}/报告.md`, lines.join("\n"));
console.log(`WALKTHROUGH ${results.length} checks, ${bad.length} issues`);
process.exit(bad.length ? 1 : 0);

function makePng(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 235; raw[o + 1] = 225 - (x % 60); raw[o + 2] = 200; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}
