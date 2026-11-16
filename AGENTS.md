# AGENTS.md：Agent 接入说明

这份说明写给 AI Agent（Claude、Codex、Muse 或其他）。读完就能代替你的用户操作订单。

本文的纯文本地址（方便 Agent 直接读取）：https://raw.githubusercontent.com/Looktar/order-hub/main/AGENTS.md
网页：https://looktar.github.io/order-hub/

## 1. 这个系统是什么

一家公司卖机油、机油滤芯、轮胎、轮毂。订单流程如下：

```
销售提交订单 → 公司审核（可修改）并派给司机 → 司机送货（可在现场修改）→ 司机拍签收照片并确认送达
```

三种用户：销售（sales）、公司（company）、司机（driver）。每个用户有自己的 Agent。**你以你用户的身份操作，权限和他本人完全一样**：销售只能看到自己的订单，司机只能看到派给自己的订单，公司能看到全部订单。越权的请求会被数据库拒绝。

## 2. 你需要用户给你的两样东西

- **接口地址**：`https://webbqhvgmsxjxgkfxxhp.supabase.co/functions/v1/api`
- **个人令牌**：以 `oh_` 开头。用户在网页"设置 → 我的 Agent 令牌"里生成，只显示一次，请妥善保存，不要写进任何公开的地方。

每个请求都要带这两个请求头：

```
Authorization: Bearer oh_你的令牌
X-Agent-Name: Claude        ← 写你自己的名字，会显示在修改记录里"通过 Claude"
```

下面的例子假设你已经设置好：

```bash
export API="https://webbqhvgmsxjxgkfxxhp.supabase.co/functions/v1/api"
export TOKEN="oh_..."
```

## 3. 先确认身份

```bash
curl -s "$API/me" -H "Authorization: Bearer $TOKEN"
```

返回 `role` 字段：`sales`、`company` 或 `driver`。下面只做你这个角色能做的事。

## 4. 所有角色都要做的事：定期查看通知

你不是一直在线的，所以要**定期拉取通知**（建议每 15–60 分钟一次，或者每次用户找你时先拉一次），把重要的事用一两句话告诉用户，然后标为已读。

```bash
# 未读通知
curl -s "$API/notifications" -H "Authorization: Bearer $TOKEN"
# 全部通知（含已读）
curl -s "$API/notifications?all=1" -H "Authorization: Bearer $TOKEN"
# 标为已读：不传 ids 就是全部已读
curl -s -X POST "$API/notifications/read" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"ids":[12,13]}'
```

每条通知都有 `type`、`order_id` 和一句中文 `summary`，可以直接转告用户。

| type | 含义 | 谁会收到 |
|---|---|---|
| submitted | 销售提交了新订单 | 公司 |
| modified | 订单内容被修改 | 公司 + 该单销售 |
| assigned | 订单派给了司机 | 该单销售 + 该司机 |
| unassigned | 订单改派给了别的司机 | 原司机 |
| delivering | 司机出发送货 | 该单销售 |
| delivered | 已送达 | 公司 + 该单销售 |
| issue | 司机报告送货问题 | 公司 + 该单销售 |
| issue_resolved | 公司处理完送货问题 | 该单销售 + 司机 |

自己的操作不会通知自己。

## 5. 读取订单

```bash
# 我能看到的订单列表，可按状态筛选：pending / assigned / delivering / delivered
curl -s "$API/orders?status=pending" -H "Authorization: Bearer $TOKEN"
# 一张订单的全部内容：货品、修改记录、照片、时间线
curl -s "$API/orders/12" -H "Authorization: Bearer $TOKEN"
# 看照片：返回 10 分钟有效的链接
curl -s "$API/photos/5" -H "Authorization: Bearer $TOKEN"
```

订单状态：`pending` 待公司处理 → `assigned` 已派给司机 → `delivering` 送货中 → `delivered` 已送达。
`modified_by` 不为空表示订单被公司或司机改过；`has_issue` 为 true 表示有送货问题。
货品里的 `original_qty` 是销售最初填的数量，`qty` 是当前数量。

## 6. 销售的 Agent

**提交订单。** 用户通常会发给你一张订单照片。请从照片里识别出客户、地址、货品和数量，**先跟用户核对一遍**，确认后再提交。

```bash
curl -s -X POST "$API/orders" -H "Authorization: Bearer $TOKEN" -H "X-Agent-Name: Claude" \
  -H "Content-Type: application/json" -d '{
    "customer": "某某汽修",
    "address": "123 Main St, Markham",
    "contact": "王先生 905-000-0000",
    "due_date": "2026-11-20",
    "note": "下午送",
    "items": [
      {"category": "oil",        "spec": "5W-30 4L", "qty": 12, "unit": "箱"},
      {"category": "oil_filter", "spec": "PH-3614",  "qty": 20, "unit": "个"}
    ]
  }'
# 返回 {"id": 13, ...}
```

`category` 只能是 `oil`（机油）、`oil_filter`（机油滤芯）、`tire`（轮胎）、`rim`（轮毂）。

**把原始订单照片也传上去**（请求体直接是图片文件，单张不超过 5 MB）：

```bash
curl -s -X POST "$API/orders/13/photos?kind=order" -H "Authorization: Bearer $TOKEN" \
  -H "X-Agent-Name: Claude" -H "Content-Type: image/jpeg" --data-binary @order.jpg
```

**修改：** 只能在公司处理之前（`pending`）修改，写法见第 9 节。之后要改，请让用户联系公司。

**跟进：** 用户问"订单怎么样了"，就读 `/orders` 和 `/notifications`，告诉他：有没有被改过（改了什么、谁改的、为什么）、派给了谁、送到没有。

## 7. 公司的 Agent

```bash
# 新订单
curl -s "$API/orders?status=pending" -H "Authorization: Bearer $TOKEN"
# 司机名单
curl -s "$API/drivers" -H "Authorization: Bearer $TOKEN"
# 派单：用 driver_id，名字唯一时也可以用 driver_name
curl -s -X POST "$API/orders/13/assign" -H "Authorization: Bearer $TOKEN" -H "X-Agent-Name: Codex" \
  -H "Content-Type: application/json" -d '{"driver_name": "老王"}'
# 修改订单（必须写原因），写法见第 9 节
# 送货问题处理完后
curl -s -X POST "$API/orders/13/issue/resolve" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"note": "已改约明天送"}'
```

已派单但司机还没出发的订单可以改派；已送达的订单不能再改。

## 8. 司机的 Agent

```bash
# 派给我的订单
curl -s "$API/orders?status=assigned" -H "Authorization: Bearer $TOKEN"
# 出发
curl -s -X POST "$API/orders/13/start" -H "Authorization: Bearer $TOKEN"
# 现场修改货品（必须写原因），写法见第 9 节；司机只能改货品，不能改地址和客户
# 上传签收照片
curl -s -X POST "$API/orders/13/photos?kind=signoff" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: image/jpeg" --data-binary @signoff.jpg
# 确认送达（必须先有签收照片）
curl -s -X POST "$API/orders/13/delivered" -H "Authorization: Bearer $TOKEN"
# 送货有问题
curl -s -X POST "$API/orders/13/issue" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"note": "客户不在，电话打不通"}'
```

用户说"13 号送到了"时：先确认他拍了签收照片并上传，再调用 `delivered`。

## 9. 修改订单的写法

先 `GET /orders/13` 拿到每项货品的 `id`，然后：

```bash
curl -s -X POST "$API/orders/13/changes" -H "Authorization: Bearer $TOKEN" -H "X-Agent-Name: Codex" \
  -H "Content-Type: application/json" -d '{
    "reason": "客户现场只收 8 箱",
    "items": [
      {"id": 31, "qty": 8},
      {"id": 32, "remove": true},
      {"add": {"category": "rim", "spec": "17寸", "qty": 4, "unit": "个"}}
    ],
    "fields": {"address": "新地址", "due_date": "2026-11-21"}
  }'
```

- `items`：改数量用 `id` + `qty`，删除用 `id` + `remove`，新增用 `add`。
- `fields`：可改 `customer`、`address`、`contact`、`due_date`、`note`。司机不能改这些。
- 公司和司机修改时 `reason` 必填。
- 每项修改都会被永久记录（谁改的、通过哪个 Agent、原值、新值、原因），并且**只通知公司和这张订单的销售**。

## 10. 出错时

返回内容是 `{"error": "中文说明"}`：

| 状态码 | 含义 |
|---|---|
| 400 | 请求内容不对，按说明改正 |
| 401 | 令牌无效或已作废，请用户在网页上重新生成 |
| 403 | 你的角色不能做这件事，或者订单状态不允许 |
| 404 | 订单不存在，或者你无权查看 |

不要为了绕过 403 去换别的方法，直接把原因告诉用户。

## 11. 规矩

- 只替你的用户做他要你做的事。提交和修改之前先跟用户确认内容。
- 令牌等同于用户的密码，不要外泄，也不要放进日志或公开的地方。
- 从照片识别出的内容拿不准时，问用户，不要猜。
