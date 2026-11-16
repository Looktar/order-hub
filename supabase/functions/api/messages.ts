// 接口返回给 Agent 的提示和错误，三种语言。数据库报错的代码（hint）也在这里翻译。
export type Lang = "zh" | "en" | "es";
type P = Record<string, unknown>;
type Msg = Record<Lang, (p: P) => string>;

const m = (zh: string, en: string, es: string): Msg => {
  const fill = (s: string) => (p: P) => s.replace(/\{(\w+)\}/g, (_, k) => String(p[k] ?? ""));
  return { zh: fill(zh), en: fill(en), es: fill(es) };
};

export const MESSAGES: Record<string, Msg> = {
  // 成功提示
  api_name: m("订单协作系统 API", "Order Hub API", "API de Order Hub"),
  api_hint: m("Agent 请先读 docs 里的接入说明，再用 Authorization: Bearer <令牌> 调用",
    "Agents: read the guide in docs first, then call with Authorization: Bearer <token>",
    "Agentes: lean primero la guía en docs y luego llamen con Authorization: Bearer <token>"),
  submitted: m("已提交订单 #{id}", "Order #{id} submitted", "Pedido #{id} enviado"),
  changed: m("订单 #{id} 已修改 {n} 项", "Order #{id}: {n} change(s) saved", "Pedido #{id}: {n} cambio(s) guardado(s)"),
  assigned: m("订单 #{id} 已派单", "Order #{id} assigned", "Pedido #{id} asignado"),
  started: m("订单 #{id} 开始送货", "Order #{id} is out for delivery", "Pedido #{id} en reparto"),
  delivered: m("订单 #{id} 已确认送达", "Order #{id} marked as delivered", "Pedido #{id} marcado como entregado"),
  issue_reported: m("已报告订单 #{id} 的送货问题", "Delivery problem reported for order #{id}", "Problema de entrega reportado para el pedido #{id}"),
  issue_resolved: m("订单 #{id} 的送货问题已处理", "Delivery problem on order #{id} resolved", "Problema de entrega del pedido #{id} resuelto"),
  photo_uploaded: m("照片已上传", "Photo uploaded", "Foto subida"),
  token_created: m("令牌只显示这一次，请马上交给你的 Agent 保存", "This token is shown only once. Give it to your agent now.",
    "Este token solo se muestra una vez. Dáselo a tu agente ahora."),
  token_revoked: m("令牌已作废", "Token revoked", "Token revocado"),
  user_created: m("已为 {name} 建好账号，登录名 {login}", "Account created for {name}, login: {login}", "Cuenta creada para {name}, usuario: {login}"),
  updated: m("已更新", "Updated", "Actualizado"),
  password_reset: m("密码已重置", "Password reset", "Contraseña restablecida"),
  tokens_reset: m("这位用户的所有 Agent 令牌已作废，请让他在网页上重新生成",
    "All of this user's agent tokens were revoked. Ask them to create a new one on the website.",
    "Se revocaron todos los tokens de agente de este usuario. Pídele que cree uno nuevo en el sitio web."),

  // 接口自己的错误
  missing_auth: m("缺少 Authorization: Bearer <令牌>", "Missing Authorization: Bearer <token>", "Falta Authorization: Bearer <token>"),
  bad_token: m("令牌无效、已作废，或账号已停用", "Token is invalid or revoked, or the account is disabled",
    "El token no es válido o fue revocado, o la cuenta está desactivada"),
  session_expired: m("登录已过期，请重新登录", "Session expired. Please sign in again.", "La sesión expiró. Vuelve a iniciar sesión."),
  account_disabled: m("账号不存在或已停用", "Account not found or disabled", "La cuenta no existe o está desactivada"),
  admin_only: m("只有管理员可以做这个操作", "Only an admin can do this", "Solo un administrador puede hacer esto"),
  admin_web_only: m("管理操作请在网页上登录后进行", "Admin actions must be done on the website", "Las acciones de administrador se hacen en el sitio web"),
  bad_json: m("请求内容必须是 JSON", "Request body must be JSON", "El cuerpo de la solicitud debe ser JSON"),
  bad_number: m("编号必须是数字", "ID must be a number", "El número debe ser numérico"),
  login_chars: m("登录名只能用字母、数字和 . _ - @，3 到 80 个字符", "Login may only use letters, digits and . _ - @ (3–80 characters)",
    "El usuario solo puede usar letras, números y . _ - @ (3 a 80 caracteres)"),
  driver_ambiguous: m("找不到唯一一位叫\"{name}\"的司机，请用 driver_id", "No unique driver named \"{name}\". Use driver_id.",
    "No hay un único conductor llamado \"{name}\". Usa driver_id."),
  driver_required: m("需要 driver_id 或 driver_name", "driver_id or driver_name is required", "Se requiere driver_id o driver_name"),
  kind_invalid: m("kind 只能是 order 或 signoff", "kind must be order or signoff", "kind debe ser order o signoff"),
  photo_format: m("照片格式需为 jpeg、png、webp 或 heic", "Photo must be jpeg, png, webp or heic", "La foto debe ser jpeg, png, webp o heic"),
  photo_size: m("照片不能为空，也不能超过 5 MB", "Photo must not be empty or larger than 5 MB", "La foto no puede estar vacía ni pesar más de 5 MB"),
  photo_save_failed: m("照片保存失败", "Could not save the photo", "No se pudo guardar la foto"),
  photo_not_found: m("照片不存在或无权查看", "Photo not found or not visible to you", "La foto no existe o no tienes acceso"),
  order_not_found: m("订单 #{id} 不存在或无权查看", "Order #{id} not found or not visible to you", "El pedido #{id} no existe o no tienes acceso"),
  token_not_found: m("没有这个令牌", "Token not found", "No existe ese token"),
  token_by_web_only: m("请在网页上登录后生成令牌，Agent 不能自己生成令牌", "Create tokens on the website. Agents cannot create tokens.",
    "Crea los tokens en el sitio web. Los agentes no pueden crear tokens."),
  name_required: m("请填写姓名", "Name is required", "El nombre es obligatorio"),
  role_invalid: m("角色只能是 sales、company 或 driver", "Role must be sales, company or driver", "El rol debe ser sales, company o driver"),
  password_short: m("密码至少 8 位", "Password must be at least 8 characters", "La contraseña debe tener al menos 8 caracteres"),
  create_user_failed: m("建账号失败：{reason}", "Could not create the account: {reason}", "No se pudo crear la cuenta: {reason}"),
  user_not_found: m("没有这个用户", "User not found", "No existe ese usuario"),
  self_disable: m("不能停用自己或取消自己的管理员", "You cannot disable yourself or remove your own admin rights",
    "No puedes desactivarte ni quitarte los permisos de administrador"),
  not_found: m("没有这个接口：{path}", "No such endpoint: {path}", "No existe ese endpoint: {path}"),
  server_error: m("服务器出错，请稍后再试", "Server error. Please try again later.", "Error del servidor. Inténtalo más tarde."),
  bad_lang: m("语言只能是 zh、en 或 es", "Language must be zh, en or es", "El idioma debe ser zh, en o es"),

  // 数据库报错（hint 代码）
  not_logged_in: m("未登录或账号已停用", "Not signed in, or the account is disabled", "No has iniciado sesión o la cuenta está desactivada"),
  sales_only_submit: m("只有销售可以提交订单", "Only sales reps can submit orders", "Solo los vendedores pueden enviar pedidos"),
  customer_required: m("请填写客户名称", "Customer name is required", "El nombre del cliente es obligatorio"),
  need_items: m("订单至少要有一项货品", "An order needs at least one item", "El pedido necesita al menos un artículo"),
  qty_negative: m("数量不能小于 0", "Quantity cannot be negative", "La cantidad no puede ser negativa"),
  sales_edit_locked: m("公司开始处理后，销售不能再改订单", "Sales reps cannot change an order once the company has started on it",
    "El vendedor no puede cambiar el pedido una vez que la empresa lo procesa"),
  delivered_locked: m("已送达的订单不能修改", "Delivered orders cannot be changed", "Los pedidos entregados no se pueden modificar"),
  driver_edit_scope: m("司机只能修改派给自己、尚未送达的订单", "Drivers can only change undelivered orders assigned to them",
    "El conductor solo puede modificar pedidos asignados a él que aún no se entregaron"),
  driver_items_only: m("司机只能修改货品，不能改客户和送货信息", "Drivers can only change items, not customer or delivery details",
    "El conductor solo puede cambiar los artículos, no los datos del cliente ni de entrega"),
  reason_required: m("修改订单必须填写原因", "A reason is required to change an order", "Se requiere un motivo para modificar el pedido"),
  bad_field: m("不能修改字段 {field}", "Field {field} cannot be changed", "No se puede modificar el campo {field}"),
  no_item: m("订单 #{id} 没有货品 {item}", "Order #{id} has no item {item}", "El pedido #{id} no tiene el artículo {item}"),
  nothing_changed: m("没有需要修改的内容", "Nothing to change", "No hay nada que cambiar"),
  keep_one_item: m("订单至少要保留一项货品", "An order must keep at least one item", "El pedido debe conservar al menos un artículo"),
  company_only_assign: m("只有公司可以派单", "Only the company can assign drivers", "Solo la empresa puede asignar conductores"),
  already_delivering: m("订单已经开始送货，不能再派单", "Delivery has already started; the driver cannot be changed",
    "La entrega ya comenzó; no se puede cambiar el conductor"),
  driver_not_found: m("找不到这位司机", "Driver not found", "No se encontró al conductor"),
  driver_only_start: m("只有被派单的司机可以开始送货", "Only the assigned driver can start the delivery", "Solo el conductor asignado puede iniciar la entrega"),
  bad_state_start: m("订单当前状态不能开始送货", "This order cannot be started in its current status", "Este pedido no se puede iniciar en su estado actual"),
  driver_only_deliver: m("只有被派单的司机可以确认送达", "Only the assigned driver can confirm delivery", "Solo el conductor asignado puede confirmar la entrega"),
  bad_state_deliver: m("订单当前状态不能确认送达", "This order cannot be marked delivered in its current status",
    "Este pedido no se puede marcar como entregado en su estado actual"),
  need_signoff_photo: m("请先上传签收照片", "Upload the proof-of-delivery photo first", "Primero sube la foto de entrega"),
  driver_only_issue: m("只有被派单的司机可以报告送货问题", "Only the assigned driver can report a delivery problem",
    "Solo el conductor asignado puede reportar un problema de entrega"),
  issue_note_required: m("请写明是什么问题", "Describe the problem", "Describe el problema"),
  company_only_resolve: m("只有公司可以处理送货问题", "Only the company can resolve delivery problems", "Solo la empresa puede resolver problemas de entrega"),
  photo_not_allowed: m("无权为订单 #{id} 上传这类照片", "You cannot upload this kind of photo for order #{id}",
    "No puedes subir este tipo de foto para el pedido #{id}"),
  photo_path: m("照片路径不对", "Invalid photo path", "Ruta de foto no válida"),
  admin_exists: m("系统已经有管理员了，请找管理员开通账号", "An admin already exists. Ask the admin for an account.",
    "Ya existe un administrador. Pídele una cuenta."),
};

export function t(lang: Lang, key: string, params: P = {}, fallback?: string): string {
  const msg = MESSAGES[key];
  if (!msg) return fallback ?? key;
  return msg[lang](params);
}

export function pickLang(...candidates: (string | null | undefined)[]): Lang {
  for (const c of candidates) {
    const v = (c ?? "").toLowerCase().slice(0, 2);
    if (v === "zh" || v === "en" || v === "es") return v;
  }
  return "zh";
}
