# AGENTS.es.md: guía para agentes

Esta guía es para agentes de IA (Claude, Codex, Muse u otros). Al terminar de leerla podrás gestionar pedidos en nombre de tu usuario.

Direcciones en texto plano (fáciles de leer para un agente):
- Español: https://raw.githubusercontent.com/Looktar/order-hub/main/AGENTS.es.md
- English: https://raw.githubusercontent.com/Looktar/order-hub/main/AGENTS.en.md
- 中文: https://raw.githubusercontent.com/Looktar/order-hub/main/AGENTS.md
- Sitio web: https://looktar.github.io/order-hub/

## 1. Qué es este sistema

Una empresa vende aceite de motor, filtros de aceite, neumáticos y rines. El flujo de un pedido:

```
El vendedor envía el pedido → la empresa lo revisa (puede modificarlo) y asigna un conductor
→ el conductor entrega (puede cambiar artículos en el lugar) → toma una foto de entrega y confirma
```

Hay tres tipos de usuario: vendedor (`sales`), empresa (`company`) y conductor (`driver`). Cada usuario tiene su propio agente. **Actúas como tu usuario, con exactamente sus mismos permisos**: un vendedor solo ve sus pedidos, un conductor solo ve los pedidos asignados a él y la empresa ve todos. La base de datos rechaza cualquier cosa fuera de eso.

## 2. Dos cosas que necesitas de tu usuario

- **Dirección de la API**: `https://webbqhvgmsxjxgkfxxhp.supabase.co/functions/v1/api`
- **Token personal**: empieza con `oh_`. El usuario lo crea en el sitio web, en Ajustes → Mis tokens de agente. Solo se muestra una vez. Guárdalo bien y nunca lo pongas en un lugar público.

Envía estos dos encabezados en cada solicitud:

```
Authorization: Bearer oh_tu_token
X-Agent-Name: Claude        ← tu propio nombre; el historial mostrará "vía Claude"
```

**Idioma**: el sistema funciona en chino (`zh`), inglés (`en`) y español (`es`). Por defecto, la API responde en el idioma que tu usuario eligió en el sitio web (Ajustes → Mi idioma): textos de notificaciones, nombres de artículos, mensajes y errores. Para cambiarlo en una sola solicitud, agrega `?lang=en` o el encabezado `X-Lang: es`. Cada usuario puede usar un idioma distinto: la misma notificación se lee en chino para uno y en español para otro.

Los ejemplos de abajo suponen:

```bash
export API="https://webbqhvgmsxjxgkfxxhp.supabase.co/functions/v1/api"
export TOKEN="oh_..."
```

## 3. Primero confirma quién eres

```bash
curl -s "$API/me" -H "Authorization: Bearer $TOKEN"
```

El campo `role` es `sales`, `company` o `driver`. Haz solo lo que ese rol puede hacer.

## 4. Todos los roles: revisa las notificaciones con regularidad

No estás en línea todo el tiempo, así que **consulta las notificaciones con regularidad** (cada 15 a 60 minutos, o al menos cada vez que tu usuario te hable). Cuéntale lo importante en una o dos frases y luego márcalas como leídas.

```bash
# notificaciones sin leer
curl -s "$API/notifications" -H "Authorization: Bearer $TOKEN"
# todas, incluidas las leídas
curl -s "$API/notifications?all=1" -H "Authorization: Bearer $TOKEN"
# marcar como leídas; sin ids se marcan todas
curl -s -X POST "$API/notifications/read" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"ids":[12,13]}'
```

Cada notificación tiene `type`, `order_id` y una frase `summary` en el idioma del usuario que puedes transmitir tal cual. `summary_i18n` trae los tres idiomas.

| type | Significado | Quién la recibe |
|---|---|---|
| submitted | Un vendedor envió un pedido nuevo | Empresa |
| modified | Se modificó el pedido | Empresa + el vendedor de ese pedido |
| assigned | El pedido se asignó a un conductor | El vendedor de ese pedido + ese conductor |
| unassigned | El pedido pasó a otro conductor | El conductor anterior |
| delivering | El conductor salió a entregar | El vendedor de ese pedido |
| delivered | Entregado | Empresa + el vendedor de ese pedido |
| issue | El conductor reportó un problema de entrega | Empresa + el vendedor de ese pedido |
| issue_resolved | La empresa resolvió el problema | El vendedor de ese pedido + el conductor |

Nunca recibes notificaciones de tus propias acciones.

## 5. Consultar pedidos

```bash
# pedidos que puedo ver; filtrar por estado: pending / assigned / delivering / delivered
curl -s "$API/orders?status=pending" -H "Authorization: Bearer $TOKEN"
# todo sobre un pedido: artículos, historial de cambios, fotos, línea de tiempo
curl -s "$API/orders/12" -H "Authorization: Bearer $TOKEN"
# ver una foto: devuelve un enlace válido por 10 minutos
curl -s "$API/photos/5" -H "Authorization: Bearer $TOKEN"
```

Estados: `pending` (pendiente de la empresa) → `assigned` (asignado a un conductor) → `delivering` (en reparto) → `delivered` (entregado).
`modified_by` tiene valor cuando la empresa o el conductor modificaron el pedido; `has_issue` es true cuando hay un problema de entrega.
En cada artículo, `original_qty` es lo que el vendedor escribió al principio y `qty` es la cantidad actual.
Fechas (UTC, formato ISO): `created_at` pedido, `assigned_at` asignado, `started_at` salida del conductor, `delivered_at` entregado, `updated_at` último cambio.

## 6. Agente del vendedor

**Enviar un pedido.** Normalmente tu usuario te mandará una foto del pedido. Lee el cliente, la dirección, los artículos y las cantidades, **revísalos primero con tu usuario** y envía solo cuando lo confirme.

```bash
curl -s -X POST "$API/orders" -H "Authorization: Bearer $TOKEN" -H "X-Agent-Name: Claude" \
  -H "Content-Type: application/json" -d '{
    "customer": "Taller Mecánico Sol",
    "address": "123 Main St, Markham",
    "contact": "Sr. García 905-000-0000",
    "due_date": "2026-11-20",
    "note": "entregar por la tarde",
    "items": [
      {"category": "oil",        "spec": "5W-30 4L", "qty": 12, "unit": "cajas"},
      {"category": "oil_filter", "spec": "PH-3614",  "qty": 20, "unit": "pzas"}
    ]
  }'
# devuelve {"id": 13, ...}
```

`category` debe ser `oil` (aceite de motor), `oil_filter` (filtro de aceite), `tire` (neumático) o `rim` (rin).

**Sube también la foto original del pedido** (el cuerpo de la solicitud es el archivo de imagen, máximo 5 MB):

```bash
curl -s -X POST "$API/orders/13/photos?kind=order" -H "Authorization: Bearer $TOKEN" \
  -H "X-Agent-Name: Claude" -H "Content-Type: image/jpeg" --data-binary @pedido.jpg
```

**Cambios:** solo antes de que la empresa empiece a procesarlo (`pending`); ver la sección 9. Después, pide a tu usuario que hable con la empresa.

**Seguimiento:** cuando tu usuario pregunte cómo va un pedido, consulta `/orders` y `/notifications` y dile si se modificó (qué, quién y por qué), a quién se asignó y si ya se entregó.

## 7. Agente de la empresa

```bash
# pedidos nuevos
curl -s "$API/orders?status=pending" -H "Authorization: Bearer $TOKEN"
# lista de conductores
curl -s "$API/drivers" -H "Authorization: Bearer $TOKEN"
# asignar: usa driver_id, o driver_name si el nombre es único
curl -s -X POST "$API/orders/13/assign" -H "Authorization: Bearer $TOKEN" -H "X-Agent-Name: Codex" \
  -H "Content-Type: application/json" -d '{"driver_name": "Juan"}'
# modificar un pedido (motivo obligatorio): ver la sección 9
# cuando se resuelva un problema de entrega
curl -s -X POST "$API/orders/13/issue/resolve" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"note": "se reprogramó para mañana"}'
```

Un pedido se puede pasar a otro conductor mientras el conductor asignado no haya salido. Los pedidos entregados no se pueden modificar.

## 8. Agente del conductor

```bash
# pedidos asignados a mí
curl -s "$API/orders?status=assigned" -H "Authorization: Bearer $TOKEN"
# salir a entregar
curl -s -X POST "$API/orders/13/start" -H "Authorization: Bearer $TOKEN"
# cambiar artículos en el lugar (motivo obligatorio), ver la sección 9; el conductor solo puede cambiar artículos, no la dirección ni el cliente
# subir la foto de entrega
curl -s -X POST "$API/orders/13/photos?kind=signoff" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: image/jpeg" --data-binary @entrega.jpg
# confirmar la entrega (primero debe haber una foto de entrega)
curl -s -X POST "$API/orders/13/delivered" -H "Authorization: Bearer $TOKEN"
# reportar un problema de entrega
curl -s -X POST "$API/orders/13/issue" -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{"note": "el cliente no está y no contesta el teléfono"}'
```

Cuando tu usuario diga "ya entregué el 13": primero asegúrate de que tomó y subió la foto de entrega, y luego llama a `delivered`.

## 9. Cómo modificar un pedido

Primero haz `GET /orders/13` para obtener el `id` de cada artículo y luego:

```bash
curl -s -X POST "$API/orders/13/changes" -H "Authorization: Bearer $TOKEN" -H "X-Agent-Name: Codex" \
  -H "Content-Type: application/json" -d '{
    "reason": "el cliente solo recibió 8 cajas",
    "items": [
      {"id": 31, "qty": 8},
      {"id": 32, "remove": true},
      {"add": {"category": "rim", "spec": "17 pulg", "qty": 4, "unit": "pzas"}}
    ],
    "fields": {"address": "nueva dirección", "due_date": "2026-11-21"}
  }'
```

- `items`: cambia una cantidad con `id` + `qty`, elimina con `id` + `remove`, agrega con `add`.
- `fields`: `customer`, `address`, `contact`, `due_date`, `note`. El conductor no puede cambiar estos campos.
- `reason` es obligatorio cuando el cambio lo hace la empresa o un conductor.
- Cada cambio queda registrado para siempre (quién, vía qué agente, valor anterior, valor nuevo, motivo) y **solo se avisa a la empresa y al vendedor de ese pedido**.

## 10. Errores

La respuesta es `{"error": "mensaje en el idioma del usuario", "code": "codigo_de_error"}`. `code` no cambia con el idioma, así que úsalo en tu lógica, por ejemplo `reason_required`, `need_signoff_photo`, `order_not_found`.

| Código HTTP | Significado |
|---|---|
| 400 | La solicitud está mal; corrígela según el mensaje |
| 401 | El token no es válido o fue revocado; pide a tu usuario que cree uno nuevo en el sitio web |
| 403 | Tu rol no puede hacer esto, o el estado del pedido no lo permite |
| 404 | El pedido no existe, o no tienes permiso para verlo |

No intentes rodear un 403. Explícale a tu usuario por qué se rechazó.

## 11. Reglas básicas

- Haz solo lo que tu usuario te pida. Confirma el contenido con él antes de enviar o modificar algo.
- Un token vale lo mismo que la contraseña del usuario. Nunca lo compartas, no lo guardes en registros ni lo pongas en un lugar público.
- Si no estás seguro de algo que leíste en una foto, pregúntale a tu usuario. No adivines.
