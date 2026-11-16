// 网页文字：中文 zh / English en / Español es
// {name} 这类是占位符，会替换成实际内容。
export const LANGS = { zh: "中文", en: "English", es: "Español" };

const D = {
  // 通用
  app_name: ["订单协作", "Order Hub", "Order Hub"],
  home: ["订单协作首页", "Order Hub home", "Inicio de Order Hub"],
  back: ["返回", "Back", "Volver"],
  cancel: ["取消", "Cancel", "Cancelar"],
  loading: ["正在加载…", "Loading…", "Cargando…"],
  error_prefix: ["出错了：", "Something went wrong: ", "Algo salió mal: "],
  missing_config: ["缺少 config.js 配置，请检查部署设置。", "Missing config.js. Check the deployment settings.", "Falta config.js. Revisa la configuración de despliegue."],
  language: ["语言", "Language", "Idioma"],
  today_at: ["今天 {t}", "Today {t}", "Hoy {t}"],
  yesterday_at: ["昨天 {t}", "Yesterday {t}", "Ayer {t}"],
  self: ["本人", "in person", "en persona"],
  via_agent: ["通过 {a}", "via {a}", "vía {a}"],
  system: ["系统", "System", "Sistema"],
  copied: ["已复制", "Copied", "Copiado"],
  ordered_at: ["下单 {t}", "Ordered {t}", "Pedido {t}"],
  updated_at_k: ["更新 {t}", "Updated {t}", "Actualizado {t}"],
  ts_created: ["下单时间", "Ordered", "Fecha del pedido"],
  ts_updated: ["最近更新", "Last updated", "Última actualización"],
  ts_assigned: ["派单 {t}", "Assigned {t}", "Asignado {t}"],
  ts_started: ["出发 {t}", "Left {t}", "Salió {t}"],
  ts_delivered: ["送达 {t}", "Delivered {t}", "Entregado {t}"],

  // 角色、状态、品类
  role_sales: ["销售", "Sales", "Ventas"],
  role_company: ["公司", "Company", "Empresa"],
  role_driver: ["司机", "Driver", "Conductor"],
  st_pending: ["待公司处理", "Pending review", "Pendiente"],
  st_assigned: ["已派给司机", "Assigned", "Asignado"],
  st_delivering: ["送货中", "Out for delivery", "En reparto"],
  st_delivered: ["已送达", "Delivered", "Entregado"],
  cat_oil: ["机油", "Engine oil", "Aceite de motor"],
  cat_oil_filter: ["机油滤芯", "Oil filter", "Filtro de aceite"],
  cat_tire: ["轮胎", "Tire", "Neumático"],
  cat_rim: ["轮毂", "Rim", "Rin"],
  unit_oil: ["箱", "case", "caja"],
  unit_oil_filter: ["个", "pc", "pza"],
  unit_tire: ["条", "pc", "pza"],
  unit_rim: ["个", "pc", "pza"],
  modified_by: ["{role}已修改", "Changed by {role}", "Modificado por {role}"],
  has_issue: ["送货有问题", "Delivery problem", "Problema de entrega"],

  // 登录
  login_intro: ["销售、公司、司机共用。账号由公司管理员开通。", "For sales, company staff and drivers. Accounts are created by the company admin.", "Para vendedores, empresa y conductores. Las cuentas las crea el administrador."],
  login_name: ["登录名或邮箱", "Username or email", "Usuario o correo"],
  password: ["密码", "Password", "Contraseña"],
  sign_in: ["登录", "Sign in", "Iniciar sesión"],
  login_failed: ["登录名或密码不对", "Wrong username or password", "Usuario o contraseña incorrectos"],
  account_not_ready: ["这个账号还没开通或已停用，请联系公司管理员。", "This account isn't set up or has been disabled. Contact the company admin.", "Esta cuenta no está activa o fue desactivada. Contacta al administrador."],
  sign_out: ["退出登录", "Sign out", "Cerrar sesión"],

  // 第一个管理员
  bootstrap_title: ["设置第一个管理员", "Set up the first admin", "Configurar el primer administrador"],
  bootstrap_intro: ["系统里还没有管理员。你将成为管理员（公司角色），之后由你在“设置”里给销售、公司同事和司机开通账号。", "There is no admin yet. You will become the admin (company role) and can then create accounts for sales reps, company staff and drivers in Settings.", "Aún no hay administrador. Serás el administrador (rol de empresa) y luego podrás crear cuentas para vendedores, empresa y conductores en Ajustes."],
  your_name: ["你的姓名", "Your name", "Tu nombre"],
  become_admin: ["成为管理员", "Become admin", "Ser administrador"],

  // 顶栏
  new_order: ["新建订单", "New order", "Nuevo pedido"],
  notifications_label: ["通知，{n} 条未读", "Notifications, {n} unread", "Notificaciones, {n} sin leer"],
  settings: ["设置", "Settings", "Ajustes"],

  // 首页
  my_orders: ["我的订单", "My orders", "Mis pedidos"],
  my_deliveries: ["我的送货单", "My deliveries", "Mis entregas"],
  agent_hint: ["也可以直接把订单照片发给你的 Agent，由它代为提交。", "You can also send the order photo to your agent and let it submit for you.", "También puedes enviar la foto del pedido a tu agente para que lo envíe por ti."],
  in_progress: ["进行中 · {n}", "In progress · {n}", "En curso · {n}"],
  recent_delivered: ["最近已送达", "Recently delivered", "Entregados recientemente"],
  no_active_orders: ["还没有进行中的订单", "No orders in progress", "No hay pedidos en curso"],
  no_deliveries: ["暂时没有派给你的订单", "No orders assigned to you yet", "Aún no tienes pedidos asignados"],
  more_items: ["等 {n} 项", "{n} items in total", "{n} artículos en total"],
  sales_is: ["销售：{name}", "Sales: {name}", "Vendedor: {name}"],
  driver_is: ["司机：{name}", "Driver: {name}", "Conductor: {name}"],
  due_on: ["要求 {d} 送达", "due {d}", "entrega {d}"],
  filters: ["筛选", "Filters", "Filtros"],
  f_all: ["全部订单", "All orders", "Todos"],
  f_modified: ["被修改过的", "Changed", "Modificados"],
  f_today: ["今天要送的", "Due today", "Para hoy"],
  f_issue: ["送货有问题的", "Delivery problems", "Con problemas"],
  no_orders: ["没有订单", "No orders", "Sin pedidos"],

  // 新建订单
  step_photos: ["1 · 订单照片", "1 · Order photos", "1 · Fotos del pedido"],
  step_items: ["2 · 货品", "2 · Items", "2 · Artículos"],
  step_delivery: ["3 · 送货信息", "3 · Delivery details", "3 · Datos de entrega"],
  take_photo: ["拍照或选图", "Take or choose photo", "Tomar o elegir foto"],
  add_another: ["再加一张", "Add another", "Agregar otra"],
  remove_photo: ["移除这张照片", "Remove this photo", "Quitar esta foto"],
  order_photo_n: ["订单照片 {n}", "Order photo {n}", "Foto del pedido {n}"],
  category: ["品类", "Category", "Categoría"],
  spec: ["规格 / 型号", "Spec / model", "Especificación / modelo"],
  spec_ph: ["如 5W-30、225/65R17", "e.g. 5W-30, 225/65R17", "p. ej. 5W-30, 225/65R17"],
  qty: ["数量", "Quantity", "Cantidad"],
  unit: ["单位", "Unit", "Unidad"],
  delete: ["删除", "Remove", "Eliminar"],
  restore: ["恢复", "Restore", "Restaurar"],
  customer_req: ["客户 *", "Customer *", "Cliente *"],
  customer: ["客户", "Customer", "Cliente"],
  address: ["送货地址", "Delivery address", "Dirección de entrega"],
  contact: ["收货人", "Recipient", "Contacto"],
  contact_ph: ["姓名和电话", "Name and phone", "Nombre y teléfono"],
  due_date: ["要求送达日期", "Requested delivery date", "Fecha de entrega"],
  note: ["备注", "Note", "Nota"],
  send_to_company: ["发回公司", "Send to company", "Enviar a la empresa"],
  submitting: ["正在提交…", "Submitting…", "Enviando…"],
  need_customer: ["请填写客户名称", "Enter the customer name", "Escribe el nombre del cliente"],
  need_item: ["至少填一项货品和数量", "Add at least one item with a quantity", "Agrega al menos un artículo con cantidad"],
  order_sent: ["订单 #{id} 已发回公司", "Order #{id} sent to the company", "Pedido #{id} enviado a la empresa"],

  // 订单详情
  edit_order: ["修改订单", "Edit order", "Modificar pedido"],
  issue_title: ["送货问题", "Delivery problem", "Problema de entrega"],
  issue_default: ["司机报告了问题", "The driver reported a problem", "El conductor reportó un problema"],
  mark_resolved: ["标记为已处理", "Mark as resolved", "Marcar como resuelto"],
  resolved: ["已标记为处理完", "Marked as resolved", "Marcado como resuelto"],
  items_title: ["货品清单", "Items", "Artículos"],
  qty_changed: ["数量有改动", "Quantities changed", "Cantidades modificadas"],
  item: ["货品", "Item", "Artículo"],
  added: ["新增", "added", "nuevo"],
  removed_was: ["已删除（原 {q}）", "Removed (was {q})", "Eliminado (antes {q})"],
  delivery_info: ["送货信息", "Delivery details", "Datos de entrega"],
  sales: ["销售", "Sales rep", "Vendedor"],
  driver: ["司机", "Driver", "Conductor"],
  not_assigned: ["未派单", "Not assigned", "Sin asignar"],
  log_title: ["修改与通知记录", "Changes and notifications", "Cambios y notificaciones"],
  status_title: ["执行状态", "Status", "Estado"],
  current: ["（当前）", " (current)", " (actual)"],
  photos: ["照片", "Photos", "Fotos"],
  order_photos: ["订单照片", "Order photos", "Fotos del pedido"],
  signoff_photos: ["签收照片", "Proof of delivery", "Foto de entrega"],
  none_yet: ["暂无", "None yet", "Aún no"],
  add_order_photo: ["添加订单照片", "Add order photo", "Agregar foto del pedido"],
  photo_uploaded: ["照片已上传", "Photo uploaded", "Foto subida"],
  assign_title: ["派给司机", "Assign driver", "Asignar conductor"],
  reassign_title: ["改派司机", "Change driver", "Cambiar conductor"],
  choose_driver: ["选择司机", "Choose a driver", "Elige un conductor"],
  assign: ["派单", "Assign", "Asignar"],
  choose_driver_first: ["请先选择司机", "Choose a driver first", "Primero elige un conductor"],
  assigned_toast: ["已派单，司机和销售都会收到通知", "Assigned. The driver and sales rep will be notified.", "Asignado. Se avisará al conductor y al vendedor."],
  no_drivers: ["还没有司机账号，请在设置里添加。", "No driver accounts yet. Add them in Settings.", "Aún no hay conductores. Agrégalos en Ajustes."],
  not_found_order: ["订单 #{id} 不存在或你无权查看", "Order #{id} doesn't exist or you can't view it", "El pedido #{id} no existe o no tienes acceso"],

  // 司机
  start_delivery: ["开始送货", "Start delivery", "Iniciar entrega"],
  started_toast: ["已出发，销售会收到通知", "On the way. The sales rep will be notified.", "En camino. Se avisará al vendedor."],
  take_signoff: ["拍签收照片", "Take proof-of-delivery photo", "Tomar foto de entrega"],
  take_signoff_again: ["再拍一张签收照片", "Take another delivery photo", "Tomar otra foto de entrega"],
  signoff_uploaded: ["签收照片已上传", "Delivery photo uploaded", "Foto de entrega subida"],
  confirm_delivered: ["确认送达", "Confirm delivered", "Confirmar entrega"],
  delivered_toast: ["已确认送达", "Delivery confirmed", "Entrega confirmada"],
  edit_items: ["修改订单内容", "Change items", "Cambiar artículos"],
  report_issue: ["送货有问题", "Report a problem", "Reportar problema"],
  delivery_no: ["送货单 #{id}", "Delivery #{id}", "Entrega #{id}"],
  where_to: ["送到哪里", "Deliver to", "Entregar a"],
  no_address: ["未填写地址", "No address given", "Sin dirección"],
  recipient_is: ["收货人：{c}", "Recipient: {c}", "Contacto: {c}"],
  not_given: ["未填写", "not given", "sin datos"],
  due_is: ["要求送达：{d}", "Due: {d}", "Entrega: {d}"],
  note_is: ["备注：{n}", "Note: {n}", "Nota: {n}"],
  navigate: ["导航", "Navigate", "Navegar"],
  call: ["打电话", "Call", "Llamar"],
  to_deliver: ["要送的货", "Items to deliver", "Artículos a entregar"],
  driver_changed_note: ["{role}改过这张单，以上是最新内容", "Changed by {role}. This is the latest version.", "Modificado por {role}. Esta es la versión más reciente."],
  issue_reported_is: ["已报告问题：{n}", "Problem reported: {n}", "Problema reportado: {n}"],
  delivered_at: ["已于 {t} 送达", "Delivered {t}", "Entregado {t}"],
  issue_page_title: ["订单 #{id} 送货有问题", "Problem with order #{id}", "Problema con el pedido #{id}"],
  issue_question: ["是什么问题（公司和销售会收到）", "What's the problem? (company and sales rep will be notified)", "¿Cuál es el problema? (se avisará a la empresa y al vendedor)"],
  issue_ph: ["如：客户不在、地址不对、货物损坏", "e.g. customer not there, wrong address, damaged goods", "p. ej. cliente ausente, dirección incorrecta, mercancía dañada"],
  send: ["发送", "Send", "Enviar"],
  issue_sent: ["已告诉公司和销售", "The company and sales rep have been notified", "Se avisó a la empresa y al vendedor"],
  back_to_delivery: ["返回送货单", "Back to delivery", "Volver a la entrega"],

  // 修改
  edit_title: ["修改订单 #{id}", "Edit order #{id}", "Modificar pedido #{id}"],
  edit_notice: ["保存后只通知公司和这张订单的销售。", "Only the company and this order's sales rep will be notified.", "Solo se avisará a la empresa y al vendedor de este pedido."],
  items: ["货品", "Items", "Artículos"],
  new_items: ["新增货品", "New items", "Artículos nuevos"],
  add_item: ["加一项货品", "Add item", "Agregar artículo"],
  reason_optional: ["修改原因（可不填）", "Reason (optional)", "Motivo (opcional)"],
  reason_required: ["修改原因 *", "Reason *", "Motivo *"],
  reason_ph_driver: ["如：客户现场只收 8 箱", "e.g. customer only took 8 cases", "p. ej. el cliente solo recibió 8 cajas"],
  reason_ph_company: ["如：库存不足", "e.g. not enough stock", "p. ej. falta de inventario"],
  nothing_changed: ["没有改动任何内容", "Nothing was changed", "No se cambió nada"],
  need_reason: ["请填写修改原因", "Enter a reason", "Escribe el motivo"],
  save_changes: ["保存修改", "Save changes", "Guardar cambios"],
  saved_toast: ["已修改 {n} 项，公司和销售会收到通知", "{n} change(s) saved. The company and sales rep will be notified.", "{n} cambio(s) guardado(s). Se avisará a la empresa y al vendedor."],
  empty_value: ["空", "(empty)", "(vacío)"],

  // 通知
  notifications: ["通知", "Notifications", "Notificaciones"],
  mark_all_read: ["全部标为已读", "Mark all as read", "Marcar todo como leído"],
  no_notifications: ["还没有通知", "No notifications yet", "Aún no hay notificaciones"],

  // 设置
  my_tokens: ["我的 Agent 令牌", "My agent tokens", "Mis tokens de agente"],
  tokens_intro: ["把令牌交给你的 Agent（Claude、Codex、Muse 等），它就能以你的身份读写订单，权限和你本人完全一样。令牌只显示一次；丢了就作废重新生成。", "Give a token to your agent (Claude, Codex, Muse, etc.) and it can read and write orders as you, with exactly your permissions. A token is shown only once; if you lose it, revoke it and create a new one.", "Dale un token a tu agente (Claude, Codex, Muse, etc.) y podrá leer y escribir pedidos como tú, con tus mismos permisos. El token se muestra una sola vez; si lo pierdes, revócalo y crea otro."],
  created_at: ["生成于 {t}", "created {t}", "creado {t}"],
  last_used: ["最近使用 {t}", "last used {t}", "último uso {t}"],
  never_used: ["还没用过", "never used", "sin usar"],
  revoke: ["作废", "Revoke", "Revocar"],
  revoked: ["已作废", "Revoked", "Revocado"],
  no_tokens: ["还没有令牌", "No tokens yet", "Aún no hay tokens"],
  agent_name: ["Agent 名称", "Agent name", "Nombre del agente"],
  agent_name_ph: ["如 Claude、Codex", "e.g. Claude, Codex", "p. ej. Claude, Codex"],
  create_token: ["生成令牌", "Create token", "Crear token"],
  token_block: ["接口地址：{api}\n令牌：{token}\n\n说明文档：{docs}", "API: {api}\nToken: {token}\n\nGuide: {docs}", "API: {api}\nToken: {token}\n\nGuía: {docs}"],
  copy_for_agent: ["复制给 Agent", "Copy for agent", "Copiar para el agente"],
  copy_text: ["订单协作系统接口地址：{api}\n我的令牌：{token}\n用法说明：{docs}", "Order Hub API: {api}\nMy token: {token}\nHow to use it: {docs}", "API de Order Hub: {api}\nMi token: {token}\nCómo usarlo: {docs}"],
  my_language: ["我的语言", "My language", "Mi idioma"],
  language_hint: ["网页、通知和你的 Agent 收到的回复都会用这个语言。", "The website, your notifications and replies to your agent will use this language.", "El sitio web, tus notificaciones y las respuestas a tu agente usarán este idioma."],
  admin_title: ["账号管理（管理员）", "Accounts (admin)", "Cuentas (administrador)"],
  admin_badge: ["管理员", "admin", "administrador"],
  disabled_badge: ["已停用", "disabled", "desactivado"],
  reset_password: ["重置密码", "Reset password", "Restablecer contraseña"],
  new_password_prompt: ["给 {name} 设一个新密码（至少 8 位）", "New password for {name} (at least 8 characters)", "Nueva contraseña para {name} (mínimo 8 caracteres)"],
  password_reset: ["密码已重置", "Password reset", "Contraseña restablecida"],
  revoke_tokens: ["作废令牌", "Revoke tokens", "Revocar tokens"],
  tokens_revoked: ["令牌已全部作废", "All tokens revoked", "Todos los tokens revocados"],
  disable: ["停用", "Disable", "Desactivar"],
  enable: ["启用", "Enable", "Activar"],
  add_account: ["添加账号", "Add account", "Agregar cuenta"],
  name: ["姓名", "Name", "Nombre"],
  role: ["角色", "Role", "Rol"],
  login: ["登录名", "Username", "Usuario"],
  login_ph: ["邮箱或自定的登录名", "Email or a username you choose", "Correo o un usuario a elección"],
  initial_password: ["初始密码", "Initial password", "Contraseña inicial"],
  password_ph: ["至少 8 位", "At least 8 characters", "Mínimo 8 caracteres"],
  no_email_hint: ["没有邮箱的人（如司机）可以用自定的登录名，比如 wang01。", "People without email (e.g. drivers) can use a username like wang01.", "Quien no tenga correo (p. ej. conductores) puede usar un usuario como juan01."],
  add: ["添加", "Add", "Agregar"],
  user_lang: ["语言", "Language", "Idioma"],
};

const IDX = { zh: 0, en: 1, es: 2 };
let current = "zh";

export function detectLang(profileLang) {
  let saved = null;
  try { saved = localStorage.getItem("lang"); } catch { /* 隐私模式下读不到 */ }
  const nav = (navigator.language || "").toLowerCase();
  const fromNav = nav.startsWith("zh") ? "zh" : nav.startsWith("es") ? "es" : nav.startsWith("en") ? "en" : null;
  return [saved, profileLang, fromNav, "zh"].find((l) => l && l in IDX);
}
// persist=true 表示用户主动选择，记在本机；自动判断的不记
export function setLang(l, persist = false) {
  if (!(l in IDX)) return;
  current = l;
  if (persist) { try { localStorage.setItem("lang", l); } catch { /* 忽略 */ } }
  document.documentElement.lang = { zh: "zh-CN", en: "en", es: "es" }[l];
}
export function getLang() { return current; }
export function savedLang() { try { return localStorage.getItem("lang"); } catch { return null; } }
export function t(key, params = {}) {
  const row = D[key];
  const s = row ? row[IDX[current]] ?? row[0] : key;
  return s.replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));
}
export function locale() { return { zh: "zh-CN", en: "en-CA", es: "es" }[current]; }

// 数据库报错代码 → 当前语言。没有对应的就显示原来的说明。
const E = {
  not_logged_in: ["未登录或账号已停用", "Not signed in, or the account is disabled", "No has iniciado sesión o la cuenta está desactivada"],
  sales_only_submit: ["只有销售可以提交订单", "Only sales reps can submit orders", "Solo los vendedores pueden enviar pedidos"],
  customer_required: ["请填写客户名称", "Customer name is required", "El nombre del cliente es obligatorio"],
  need_items: ["订单至少要有一项货品", "An order needs at least one item", "El pedido necesita al menos un artículo"],
  qty_negative: ["数量不能小于 0", "Quantity cannot be negative", "La cantidad no puede ser negativa"],
  sales_edit_locked: ["公司开始处理后，销售不能再改订单", "Sales reps cannot change an order once the company has started on it", "El vendedor no puede cambiar el pedido una vez que la empresa lo procesa"],
  delivered_locked: ["已送达的订单不能修改", "Delivered orders cannot be changed", "Los pedidos entregados no se pueden modificar"],
  driver_edit_scope: ["司机只能修改派给自己、尚未送达的订单", "Drivers can only change undelivered orders assigned to them", "El conductor solo puede modificar pedidos asignados a él que aún no se entregaron"],
  driver_items_only: ["司机只能修改货品，不能改客户和送货信息", "Drivers can only change items, not customer or delivery details", "El conductor solo puede cambiar los artículos, no los datos del cliente ni de entrega"],
  reason_required: ["修改订单必须填写原因", "A reason is required to change an order", "Se requiere un motivo para modificar el pedido"],
  nothing_changed: ["没有需要修改的内容", "Nothing to change", "No hay nada que cambiar"],
  keep_one_item: ["订单至少要保留一项货品", "An order must keep at least one item", "El pedido debe conservar al menos un artículo"],
  company_only_assign: ["只有公司可以派单", "Only the company can assign drivers", "Solo la empresa puede asignar conductores"],
  already_delivering: ["订单已经开始送货，不能再派单", "Delivery has already started; the driver cannot be changed", "La entrega ya comenzó; no se puede cambiar el conductor"],
  driver_not_found: ["找不到这位司机", "Driver not found", "No se encontró al conductor"],
  need_signoff_photo: ["请先上传签收照片", "Upload the proof-of-delivery photo first", "Primero sube la foto de entrega"],
  issue_note_required: ["请写明是什么问题", "Describe the problem", "Describe el problema"],
  order_not_found: ["订单 #{id} 不存在或无权访问", "Order #{id} not found or not visible to you", "El pedido #{id} no existe o no tienes acceso"],
  photo_not_allowed: ["无权为订单 #{id} 上传这类照片", "You cannot upload this kind of photo for order #{id}", "No puedes subir este tipo de foto para el pedido #{id}"],
  admin_exists: ["系统已经有管理员了，请找管理员开通账号", "An admin already exists. Ask the admin for an account.", "Ya existe un administrador. Pídele una cuenta."],
  name_required: ["请填写姓名", "Name is required", "El nombre es obligatorio"],
  bad_lang: ["语言只能是 zh、en 或 es", "Language must be zh, en or es", "El idioma debe ser zh, en o es"],
};
export function errText(e) {
  if (!e) return "";
  const row = e.hint && E[e.hint];
  if (row) {
    let params = {};
    try { params = e.details ? JSON.parse(e.details) : {}; } catch { /* 忽略 */ }
    return row[IDX[current]].replace(/\{(\w+)\}/g, (_, k) => String(params[k] ?? ""));
  }
  return e.message || e.error_description || e.error || String(e);
}
