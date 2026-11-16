// 界面端到端测试：真实浏览器里，销售（手机）→ 公司（电脑）→ 司机（手机）→ 销售 走一遍，并截图。
// 运行前需要：本地 Supabase 已启动、接口已运行、e2e_api.sh 已建好账号、网页在 WEB_URL 上提供。
import { chromium } from "playwright";
import fs from "node:fs";
import zlib from "node:zlib";

const WEB = process.env.WEB_URL || "http://127.0.0.1:8080/";
const OUT = "screenshots";
fs.mkdirSync(OUT, { recursive: true });
const PHOTO = "/tmp/ui-photo.png";
fs.writeFileSync(PHOTO, makePng(320, 240));

// 生成一张有效的 PNG（浅蓝底，模拟订单照片）
function makePng(w, h) {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const o = y * (w * 3 + 1) + 1 + x * 3; raw[o] = 200; raw[o + 1] = 215 - (y % 40); raw[o + 2] = 245; }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

const browser = await chromium.launch();
const phone = { viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true };
const desk = { viewport: { width: 1360, height: 900 } };
let step = 0;
const errors = [];

async function session(opts, login, pw) {
  const ctx = await browser.newContext({ ...opts, locale: "zh-CN", timezoneId: "America/Toronto" });
  const page = await ctx.newPage();
  page.on("pageerror", (e) => errors.push(`${login}: ${e.message}`));
  page.on("dialog", (d) => d.dismiss());
  await page.goto(WEB);
  await page.fill("#login", login);
  await page.fill("#pw", pw);
  await page.click("button[type=submit]");
  await page.waitForSelector(".top");
  return { ctx, page };
}
async function shot(page, name) {
  step += 1;
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${String(step).padStart(2, "0")}-${name}.png`, fullPage: true });
  console.log(`截图：${name}`);
}
function check(cond, msg) {
  if (!cond) { console.error("测试失败：" + msg); process.exit(1); }
  console.log("通过：" + msg);
}

// 1. 销售甲在手机上新建订单
let { ctx, page } = await session(phone, "sales-a", "pass-sales-a");
await shot(page, "销售-我的订单");
await page.click("a[href='#/new']");
await page.waitForSelector("h1:has-text('新建订单')");
await page.setInputFiles("label.photo-add input[type=file]", PHOTO);
await page.fill("input[placeholder*='5W-30']", "0W-20");
await page.fill("input[type=number]", "6");
await page.getByRole("button", { name: "机油滤芯" }).click();
const specs = page.locator("input[placeholder*='5W-30']");
await specs.nth(1).fill("PH-3614");
await page.locator("input[type=number]").nth(1).fill("12");
await page.getByLabel("客户 *").fill("界面测试汽修");
await page.getByLabel("送货地址").fill("1 Test Rd, Markham");
await page.getByLabel("收货人").fill("李先生 905-111-2222");
await shot(page, "销售-填写新订单");
await page.click("button:has-text('发回公司')");
await page.waitForURL(/#\/order\/\d+$/);
const orderId = Number(page.url().match(/order\/(\d+)/)[1]);
await page.waitForSelector("text=货品清单");
await shot(page, "销售-订单已提交");
await page.waitForFunction(() => [...document.querySelectorAll("img.photo")].some((i) => i.complete && i.naturalWidth > 0), null, { timeout: 10000 }).catch(() => {});
check(await page.evaluate(() => [...document.querySelectorAll("img.photo")].some((i) => i.naturalWidth > 0)), "订单照片已上传并能正常显示");
await ctx.close();

// 2. 公司在电脑上看看板、派单
({ ctx, page } = await session(desk, "office2", "pass-office2"));
await page.waitForSelector(".board");
await shot(page, "公司-调度看板");
await page.click(`a[href='#/order/${orderId}']`);
await page.waitForSelector("text=派给司机");
await page.selectOption("#drv", { label: "司机老王" });
await page.click("button:has-text('派单')");
await page.waitForSelector("text=改派司机");
await shot(page, "公司-订单详情已派单");
await ctx.close();

// 3. 司机在手机上送货、现场改数量、拍签收照片、确认送达
({ ctx, page } = await session(phone, "wang01", "pass-wang01"));
await shot(page, "司机-我的送货单");
await page.click(`a[href='#/order/${orderId}']`);
await page.click("button:has-text('开始送货')");
await page.waitForSelector("text=修改订单内容");
await shot(page, "司机-送货中");
await page.click("a:has-text('修改订单内容')");
await page.waitForSelector("text=修改原因");
await page.locator("input.qtyin").first().fill("4");
await page.fill("#reason", "客户现场只收 4 箱");
await shot(page, "司机-现场修改数量");
await page.click("button:has-text('保存修改')");
await page.waitForSelector("text=司机改过这张单");
await page.setInputFiles("label:has-text('拍签收照片') input[type=file]", PHOTO);
await page.waitForSelector("button:has-text('确认送达')");
await page.click("button:has-text('确认送达')");
await page.waitForSelector("text=送达", { timeout: 10000 });
await shot(page, "司机-已送达");
await ctx.close();

// 4. 销售甲看通知和订单结果
({ ctx, page } = await session(phone, "sales-a", "pass-sales-a"));
check(await page.locator(".badge").count() === 1, "销售甲有未读通知角标");
await page.click("a[href='#/notifications']");
await page.waitForSelector(".notice");
const text = await page.locator(".list").innerText();
check(text.includes("被司机") && text.includes("客户现场只收 4 箱"), "销售甲收到司机改单通知，内容带原因");
check(text.includes("已送达"), "销售甲收到已送达通知");
await shot(page, "销售-通知");
await page.click(`a[href='#/order/${orderId}']`);
await page.waitForSelector("text=修改与通知记录");
await shot(page, "销售-订单详情最终");
const detail = await page.locator("main").innerText();
check(detail.includes("4箱") && detail.includes("6箱"), "订单详情显示原数量和新数量");
await ctx.close();

// 5. 销售乙看不到这张单
({ ctx, page } = await session(phone, "sales-b", "pass-sales-b"));
await page.goto(WEB + `#/order/${orderId}`);
await page.waitForSelector(".err");
check((await page.locator(".err").innerText()).includes("无权查看"), "销售乙打不开销售甲的订单");
await ctx.close();


// 6. 西班牙语：销售甲在设置里切换语言，看通知和订单
({ ctx, page } = await session(phone, "sales-a", "pass-sales-a"));
await page.click("a[href='#/settings']");
await page.selectOption("#langsel", "es");
await page.waitForSelector("h1:has-text('Ajustes')");
await shot(page, "西班牙语-设置");
await page.click("a[href='#/notifications']");
await page.waitForSelector(".notice");
const es = await page.locator(".list").innerText();
check(es.includes("modificado por") && es.includes("entregado"), "西班牙语通知内容是西班牙语");
await shot(page, "西班牙语-通知");
await page.click(`a[href='#/order/${orderId}']`);
await page.waitForSelector("text=Cambios y notificaciones");
check((await page.locator("main").innerText()).includes("Aceite de motor"), "西班牙语订单详情货品名是西班牙语");
await shot(page, "西班牙语-订单详情");
await ctx.close();

// 7. 英语：公司二在登录页选英语，看看板
{
  const c2 = await browser.newContext({ ...desk, locale: "zh-CN" });
  const p2 = await c2.newPage();
  p2.on("pageerror", (e) => errors.push(`en: ${e.message}`));
  await p2.goto(WEB);
  await p2.selectOption("#langsel", "en");
  await p2.waitForSelector("button:has-text('Sign in')");
  await shot(p2, "英语-登录");
  await p2.fill("#login", "office2"); await p2.fill("#pw", "pass-office2");
  await p2.click("button[type=submit]");
  await p2.waitForSelector(".board");
  const txt = await p2.locator(".board").innerText();
  check(txt.includes("Out for delivery") && txt.includes("Delivered"), "英语看板栏目是英文");
  await shot(p2, "英语-公司看板");
  await p2.click(`a[href='#/order/${orderId}']`);
  await p2.waitForSelector("text=Changes and notifications");
  check((await p2.locator("main").innerText()).includes("changed by"), "英语订单详情的修改记录是英文");
  await shot(p2, "英语-订单详情");
  await c2.close();
}

await browser.close();
check(errors.length === 0, "页面没有脚本错误" + (errors.length ? "：" + errors.join("；") : ""));
console.log("E2E_UI_PASSED");
