# Phase 2: Modelo de identidad y permisos - Context

**Gathered:** 2026-09-08
**Status:** Ready for planning

<domain>
## Phase Boundary

Dado un mensaje/sesión entrante, resolver **quién escribe** (miembro de equipo
con rol, contacto autorizado de un cliente específico, o número desconocido) y
**a qué datos tiene acceso** — sin canal real todavía (WhatsApp llega en Fase
3; se prueba con mensajes simulados, per el criterio de Éxito del ROADMAP).
Backend/modelo de datos puro, sin UI nueva.

**Explícitamente fuera de esta fase** (per ROADMAP Fase 4): el motor de
clasificación de riesgo en funcionamiento, la cola de aprobación humana, y la
UI de bitácora visible — todos dependen de que el agente exista primero.

</domain>

<decisions>
## Implementation Decisions

### Riesgo y bitácora — alcance
- **D-01:** Fase 2 solo define el modelo de datos: catálogo estático de
  `risk_level` ('low'/'high') por tipo de acción, y el esquema de la tabla
  `audit_log` (sin lógica de negocio ni UI). El motor de clasificación
  funcional, la cola de aprobación y la UI de bitácora visible quedan para
  Fase 4, cuando exista el agente generando acciones reales que clasificar y
  loguear.
- **D-02:** El catálogo de tipos de acción se siembra ahora con los ejemplos
  ya concretos de PROJECT.md: recordatorio de pago = bajo riesgo; reagendar
  cita, contenido nuevo hacia el cliente = alto riesgo. Fase 4 agrega más
  tipos según los necesite el agente.

### Contactos autorizados + opt-in
- **D-03:** Confirmación de opt-in es **manual por el equipo**: al agregar un
  contacto autorizado, checkbox obligatorio "confirmo que este contacto dio
  consentimiento afirmativo para WhatsApp" (sin default marcado). Se guarda
  quién confirmó y cuándo. No se construye verificación activa vía WhatsApp
  (enviar plantilla de opt-in y esperar respuesta) — eso requiere canal real,
  que es Fase 3.
- **D-04:** El opt-in solo bloquea mensajes **proactivos** del agente
  (recordatorios, etc.). Si el contacto autorizado escribe primero, el agente
  responde normalmente dentro del alcance de ese cliente, tenga o no opt-in
  confirmado — per SEG-04/PROJECT.md, que solo restringe mensajes proactivos.
- **D-05:** Tabla nueva de contactos autorizados (hoy `clients.ts` es un stub
  sin esto — ver `<code_context>`). Campos mínimos: nombre, teléfono (único
  por cliente, ver D-08), email, rol dentro del cliente (ej. "dueño",
  "asistente"), estado de opt-in, quién confirmó y cuándo.

### Contrato de resolución de identidad
- **D-06:** La resolución de identidad de un **miembro de equipo** por
  WhatsApp usa `team_members.whatsapp_number` (ya existe desde Fase 1,
  CTA-04) — búsqueda por `(agencyId, whatsappNumber)`. No se limita a
  `clerkUserId`/sesión Clerk, porque eso no cubre mensajes de WhatsApp
  simulados/reales sin sesión Clerk (necesario para Fase 3).
- **D-07:** El resolver se construye como función pura testeable —
  `resolveIdentity(agencyId, phoneNumber) -> { type, scope }` — con una suite
  de tests automatizados (mismo patrón que
  `scripts/verify-rls-isolation.ts`) cubriendo los 4 casos del criterio de
  Éxito del ROADMAP: número de equipo, cliente A, cliente B, número
  desconocido. Sin UI ni endpoint de prueba nuevo — no lo pide el ROADMAP
  para esta fase.
- Nota: `agencyId` se recibe como parámetro explícito del caller — el mapeo
  número-destino → agencia real llega con Embedded Signup en Fase 3; el
  resolver de Fase 2 no asume ninguna fuente concreta de `agencyId` todavía.

### Aislamiento — caso límite
- **D-08:** Un número de teléfono vinculado a un segundo cliente se
  **bloquea con error claro** — constraint único a nivel de datos (mismo
  patrón que `team_members_agency_id_email_idx`) más un mensaje que indique a
  qué otro cliente ya pertenece ese número. Refuerza SEG-02 sin ambigüedad
  silenciosa de contexto.

### Permisos sobre `authorized_contacts` (resueltas post-research)
- **D-09:** Lectura (SELECT) de contactos autorizados es por agencia, igual
  que `team_members` — cualquier miembro de la agencia ve todos los contactos
  autorizados de la agencia, sin filtrar por cliente asignado.
- **D-10:** Escritura (agregar/quitar contactos autorizados) es solo admin —
  mismo patrón que `assign-client.ts` y el resto de mutaciones cerca de
  `clients` hoy.

### Claude's Discretion
- Nombres exactos de tablas/columnas, forma exacta del tipo de retorno del
  resolver, y estructura interna de la suite de tests quedan a criterio de
  research/planning — las decisiones arriba fijan comportamiento, no sintaxis.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Modelo de identidad y permisos (fuente de verdad de diseño)
- `.planning/PROJECT.md` §"Modelo de identidad y permisos" (líneas ~111-151) —
  principio de resolución por quién-escribe/en-qué-conversación, capas
  visible-cliente/solo-equipo, divulgación honesta
- `.planning/PROJECT.md` §"Autonomía y control del agente" (líneas ~153-161) —
  clasificación de riesgo y bitácora (contexto para D-01/D-02, implementación
  completa en Fase 4)
- `.planning/REQUIREMENTS.md` §"SEG — Identidad, permisos y cumplimiento"
  (SEG-01 a SEG-12) — requisitos formales de esta fase

### Research de dominio
- `.planning/research/PITFALLS.md` #1 ("Risk classification is a judgment
  call...") — por qué el motor de riesgo real espera al agente (Fase 4)
- `.planning/research/PITFALLS.md` #2 ("WhatsApp opt-in consent isn't
  satisfied by...") — gap real que motiva D-03/D-04

### Código existente relevante
- `lib/tenant/with-tenant-context.ts` — patrón de RLS/GUC vía transacción que
  el resolver de identidad debe complementar (no reemplazar) para mensajes
  sin sesión Clerk
- `lib/db/schema/clients.ts`, `team-members.ts`, `client-assignments.ts` —
  esquema existente sobre el que se agrega la tabla de contactos autorizados

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/tenant/with-tenant-context.ts` — patrón de `set_config` transaccional
  para GUCs de RLS (`app.agency_id`, `app.team_member_id`, `app.role`); el
  resolver de identidad de Fase 2 necesita un mecanismo análogo pero
  independiente de `auth()` de Clerk, ya que el remitente no siempre tiene
  sesión Clerk (contactos de cliente, WhatsApp).
- `team_members.whatsappNumber` (`lib/db/schema/team-members.ts`) — ya
  capturado desde Fase 1 (CTA-04), reutilizable directamente para D-06.
- `scripts/verify-rls-isolation.ts` — patrón de test de aislamiento contra
  Neon real; modelo a seguir para la suite de D-07.

### Established Patterns
- Cada tabla multi-tenant lleva `agencyId` con RLS forzada por GUC — la nueva
  tabla de contactos autorizados debe seguir el mismo patrón.
- `uniqueIndex` a nivel de tabla para invariantes de unicidad (ej.
  `team_members_agency_id_email_idx`) — mismo patrón aplica a D-08.
- `check()` constraints para enums a nivel de DB (ej. `role`, `status` en
  `team_members`) — aplicable al campo `risk_level`/estado de opt-in.

### Integration Points
- `lib/db/schema/clients.ts` es un stub deliberado (comentario explícito: CRM
  real llega en Fase 5) — la tabla de contactos autorizados se agrega junto a
  él, no dentro de él.
- Ninguna sesión sandboxed de este tipo tiene salida de red hacia Neon/Clerk
  (ver STATE.md) — cualquier plan de ejecución de Fase 2 que corra en un
  entorno similar debe esperar el mismo bloqueo para pasos que toquen la base
  de datos real, y verificar localmente o en CI en su lugar.

</code_context>

<specifics>
## Specific Ideas

No hay referencias visuales o de producto externas — el diseño ya está
completamente especificado en PROJECT.md §"Modelo de identidad y permisos".
Las decisiones de esta discusión resuelven ambigüedades de alcance e
implementación, no de producto.

</specifics>

<deferred>
## Deferred Ideas

- Verificación activa de opt-in vía plantilla de WhatsApp (esperar respuesta
  afirmativa antes de habilitar mensajes proactivos) — depende de canal real,
  candidato natural para Fase 3 o refinamiento posterior de Fase 2.
- Motor de clasificación de riesgo funcional, cola de aprobación humana, UI
  de bitácora visible — confirmado para Fase 4 (ya estaba en ROADMAP.md, no
  es un hallazgo nuevo).
- Reclasificación de riesgo tras un "near-miss" y umbrales de confianza del
  agente (PITFALLS.md #1) — no es parte del alcance de v1 descrito en
  PROJECT.md; anotado como posible backlog v2 si surge en producción.

</deferred>

---

*Phase: 02-modelo-identidad-permisos*
*Context gathered: 2026-09-08*
