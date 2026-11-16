# AGENTS.en.md: Agent guide

This guide is for AI agents (Claude, Codex, Muse or any other). After reading it you can handle orders on behalf of your user.

Plain-text URLs (easy for agents to fetch):
- English: https://raw.githubusercontent.com/Looktar/order-hub/main/AGENTS.en.md
- 中文: https://raw.githubusercontent.com/Looktar/order-hub/main/AGENTS.md
- Español: https://raw.githubusercontent.com/Looktar/order-hub/main/AGENTS.es.md
- Website: https://looktar.github.io/order-hub/

## 1. What this system is

A company sells engine oil, oil filters, tires and rims. The order flow:

```
Sales rep submits order → company reviews (may change it) and assigns a driver
→ driver delivers (may change items on site) → driver takes a proof-of-delivery photo and confirms
```

Three kinds of users: sales (`sales`), company (`company`) and driver (`driver`). Each user has their own agent. **You act as your user, with exactly their permissions**: a sales rep only sees their own orders, a driver only sees orders assigned to them, the company sees everything. The database rejects anything beyond that.

## 2. Two things you need from your user

- **API URL**: `https://webbqhvgmsxjxgkfxxhp.supabase.co/functions/v1/api`
- **Personal token**: starts with `oh_`. The user creates it on the website under Settings → My agent tokens. It is shown only once. Keep it safe and never put it anywhere public.

Send these two headers with every request:

```
Authorization: Bearer oh_your_token
X-Agent-Name: Claude        ← your own name; the change log will show "via Claude"
```

**Language**: the system speaks Chinese (`zh`), English (`en`) and Spanish (`es`). By default the API replies in the language your user picked on the website (Settings → My language): notification text, item names, messages and errors. To switch for one request, add `?lang=en` or the header `X-Lang: es`. Users can use different languages: the same notification reads in Chinese for one user and in Spanish for another.

The examples below assume:

```bash
export API="https://webbqhvgmsxjxgkfxxhp.supabase.co/functions/v1/api"
export TOKEN="oh_..."
```

## 3. Check who you are first

```bash
curl -s "$API/me" -H "Authorization: Bearer $TOKEN"
```

The `role` field is `sales`, `company` or `driver`. Only do what that role can do.

## 4. Every role: check notifications regularly

You are not online all the time, so **pull notifications regularly** (every 15–60 minutes, or at least whenever your user talks to you). Tell the user the important ones in a sentence or two, then mark them as read.

```bash
# unread notifications
curl -s "$API/notifications" -H "Authorization: Bearer $TOKEN"
# all notifications, including read ones
curl -s "$API/notifications?all=1" -H "Authorization: Bearer $TOKEN"
# mark as read; leave out ids to mark everything
curl -s -X POST "$API/notifications/read" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"ids":[12,13]}'
```

Each notification has `type`, `order_id` and a one-sentence `summary` in the user's language that you can pass on directly. `summary_i18n` has all three languages.

| type | Meaning | Who receives it |
|---|---|---|
| submitted | A sales rep submitted a new order | Company |
| modified | The order was changed | Company + that order's sales rep |
| assigned | The order was assigned to a driver | That order's sales rep + that driver |
| unassigned | The order was moved to another driver | The previous driver |
| delivering | The driver left to deliver | That order's sales rep |
| delivered | Delivered | Company + that order's sales rep |
| issue | The driver reported a delivery problem | Company + that order's sales rep |
| issue_resolved | The company resolved the problem | That order's sales rep + driver |

You are never notified about your own actions.

## 5. Reading orders

```bash
# orders I can see; filter by status: pending / assigned / delivering / delivered
curl -s "$API/orders?status=pending" -H "Authorization: Bearer $TOKEN"
# everything about one order: items, change log, photos, timeline
curl -s "$API/orders/12" -H "Authorization: Bearer $TOKEN"
# view a photo: returns a link valid for 10 minutes
curl -s "$API/photos/5" -H "Authorization: Bearer $TOKEN"
```

Statuses: `pending` (waiting for the company) → `assigned` (assigned to a driver) → `delivering` (out for delivery) → `delivered`.
`modified_by` is set when the company or the driver changed the order; `has_issue` is true when there is a delivery problem.
For each item, `original_qty` is what the sales rep first entered and `qty` is the current quantity.

## 6. Sales rep's agent

**Submit an order.** Your user will usually send you a photo of the order. Read the customer, address, items and quantities from it, **check them with your user first**, and submit only after they confirm.

```bash
curl -s -X POST "$API/orders" -H "Authorization: Bearer $TOKEN" -H "X-Agent-Name: Claude" \
  -H "Content-Type: application/json" -d '{
    "customer": "Main Street Auto",
    "address": "123 Main St, Markham",
    "contact": "Mr. Wang 905-000-0000",
    "due_date": "2026-11-20",
    "note": "afternoon delivery",
    "items": [
      {"category": "oil",        "spec": "5W-30 4L", "qty": 12, "unit": "cases"},
      {"category": "oil_filter", "spec": "PH-3614",  "qty": 20, "unit": "pcs"}
    ]
  }'
# returns {"id": 13, ...}
```

`category` must be `oil` (engine oil), `oil_filter`, `tire` or `rim`.

**Upload the original order photo too** (the request body is the image file itself, up to 5 MB):

```bash
curl -s -X POST "$API/orders/13/photos?kind=order" -H "Authorization: Bearer $TOKEN" \
  -H "X-Agent-Name: Claude" -H "Content-Type: image/jpeg" --data-binary @order.jpg
```

**Changes:** only allowed before the company starts on it (`pending`); see section 9. After that, ask your user to contact the company.

**Follow-up:** when your user asks how an order is going, read `/orders` and `/notifications` and tell them whether it was changed (what, by whom, why), who it was assigned to, and whether it was delivered.

## 7. Company's agent

```bash
# new orders
curl -s "$API/orders?status=pending" -H "Authorization: Bearer $TOKEN"
# list of drivers
curl -s "$API/drivers" -H "Authorization: Bearer $TOKEN"
# assign: use driver_id, or driver_name if the name is unique
curl -s -X POST "$API/orders/13/assign" -H "Authorization: Bearer $TOKEN" -H "X-Agent-Name: Codex" \
  -H "Content-Type: application/json" -d '{"driver_name": "Juan"}'
# change an order (reason required): see section 9
# after a delivery problem is sorted out
curl -s -X POST "$API/orders/13/issue/resolve" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"note": "rescheduled for tomorrow"}'
```

An order can be moved to another driver until that driver has left. Delivered orders cannot be changed.

## 8. Driver's agent

```bash
# orders assigned to me
curl -s "$API/orders?status=assigned" -H "Authorization: Bearer $TOKEN"
# leaving to deliver
curl -s -X POST "$API/orders/13/start" -H "Authorization: Bearer $TOKEN"
# change items on site (reason required), see section 9; drivers can change items only, not address or customer
# upload the proof-of-delivery photo
curl -s -X POST "$API/orders/13/photos?kind=signoff" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: image/jpeg" --data-binary @signoff.jpg
# confirm delivery (a delivery photo is required first)
curl -s -X POST "$API/orders/13/delivered" -H "Authorization: Bearer $TOKEN"
# report a delivery problem
curl -s -X POST "$API/orders/13/issue" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"note": "customer not there, phone not answering"}'
```

When your user says "13 is delivered": first make sure the delivery photo was taken and uploaded, then call `delivered`.

## 9. How to change an order

First `GET /orders/13` to get each item's `id`, then:

```bash
curl -s -X POST "$API/orders/13/changes" -H "Authorization: Bearer $TOKEN" -H "X-Agent-Name: Codex" \
  -H "Content-Type: application/json" -d '{
    "reason": "customer only took 8 cases",
    "items": [
      {"id": 31, "qty": 8},
      {"id": 32, "remove": true},
      {"add": {"category": "rim", "spec": "17 in", "qty": 4, "unit": "pcs"}}
    ],
    "fields": {"address": "new address", "due_date": "2026-11-21"}
  }'
```

- `items`: change a quantity with `id` + `qty`, remove with `id` + `remove`, add with `add`.
- `fields`: `customer`, `address`, `contact`, `due_date`, `note`. Drivers cannot change these.
- `reason` is required when the company or a driver makes the change.
- Every change is recorded permanently (who, via which agent, old value, new value, reason), and **only the company and that order's sales rep are notified**.

## 10. Errors

The response is `{"error": "message in the user's language", "code": "error_code"}`. `code` never changes with language, so use it in your logic, e.g. `reason_required`, `need_signoff_photo`, `order_not_found`.

| Status | Meaning |
|---|---|
| 400 | The request is wrong; fix it as the message says |
| 401 | The token is invalid or revoked; ask your user to create a new one on the website |
| 403 | Your role can't do this, or the order's status doesn't allow it |
| 404 | The order doesn't exist, or you're not allowed to see it |

Don't try to work around a 403. Tell your user why it was refused.

## 11. Ground rules

- Do only what your user asks. Confirm the content with them before submitting or changing anything.
- A token is as good as the user's password. Never share it, log it or put it anywhere public.
- If you're unsure about something you read from a photo, ask your user. Don't guess.
