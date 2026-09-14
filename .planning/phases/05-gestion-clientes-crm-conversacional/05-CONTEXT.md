# Phase 5: Gestión de clientes (CRM conversacional) - Context

**Gathered:** 2026-09-14
**Status:** Ready for planning

<domain>
## Phase Boundary

Dar de alta y consultar clientes, por formulario o por conversación con el
agente (CLI-01 a CLI-05). Incluye edición y búsqueda/consulta, ambas
disponibles tanto por formulario web como por lenguaje natural al agente,
con el aislamiento visible-cliente / solo-equipo (SEG-08) y la convención de
RLS de tres ramas (admin / miembro asignado / client_contact) establecida en
Fase 2, aplicada ahora a la tabla `clients`.

Fuera de esta fase: calendario/citas (Fase 6), pagos (Fase 8), borrado o
archivado de clientes, portal del cliente final (Fase 9).

</domain>

<decisions>
## Implementation Decisions

### Modelo de datos de la ficha de cliente
- **D-01:** Campos mínimos: `name`, `phone`, `email`, `industry` (ver D-04),
  `notes`. Nada de redes sociales, sitio web, dirección o tamaño de empresa
  en esta fase.
- **D-02:** `name` + al menos uno de `phone`/`email` son obligatorios al
  crear. `industry` y `notes` son opcionales.
- **D-03:** `notes` es un solo campo de texto libre (textarea) — sin tabla
  `client_notes` separada, sin historial de autoría/fecha por nota.
- **D-04:** `industry` es una lista fija (dropdown), bilingüe desde ya
  (código interno + label ES/EN, no solo texto en español). Claude propone
  el set inicial editable — sugerido: Restaurantes/gastronomía,
  Salud/estética, Moda/retail, Servicios profesionales, Inmobiliaria,
  Fitness/deporte, Educación, Otro.
- **D-05:** `phone`/`email` del cliente en la ficha son **informativos para
  el equipo**, distintos y sin auto-vincular a `authorized_contacts`
  (Fase 2). Autorizar a alguien para hablar con el agente sigue siendo un
  paso admin-only separado vía `manage-authorized-contacts.ts`. No conflates
  "dato de contacto del negocio" con "persona autorizada a hablar con el
  agente".

### Capas visible-cliente / solo-equipo (CLI-05, SEG-08)
- **D-06:** `notes` es **solo-equipo**. `name`, `phone`, `email`, `industry`
  son **visible-cliente** (aunque el portal del cliente final que los
  renderiza es Fase 9 — esto solo fija la clasificación del campo ahora).

### Alta y edición por dictado al agente
- **D-07:** Si falta un campo obligatorio (`phone`/`email`) en el dictado,
  el agente pregunta de vuelta antes de crear — nunca crea con datos
  incompletos.
- **D-08:** Nueva acción `create_client` en `agent_action_catalog`: riesgo
  **bajo** (ejecuta solo, sin aprobación) — no impacta al cliente final ni
  gasta dinero, es dato interno de la agencia. Nueva migración a añadir al
  catálogo (hoy solo tiene `payment_reminder`, `reschedule_appointment`,
  `new_client_content` — ver `drizzle/migrations/0008_agent_action_catalog_seed.sql`).
- **D-09:** Si el nombre dictado coincide con un cliente ya existente, el
  agente avisa y confirma ("ya existe un cliente llamado X, ¿es el mismo o
  uno nuevo?") antes de crear — sin bloqueo duro, solo confirmación
  conversacional.
- **D-10:** CLI-03 (edición) también se puede hacer por dictado, no solo
  por formulario — nuevo tool `update_client`, mismo patrón y mismo riesgo
  bajo que `create_client`.

### Acceso de consulta del agente (CLI-04 — reinterpretado)
- **D-11 (decisión central de esta fase):** "Buscar por nombre o tema" NO
  es un campo de búsqueda aislado. El agente debe tener acceso de consulta
  **y edición** sobre todo lo que el usuario ya puede ver según su rol —
  igual que el resto del sistema, el alcance lo da RLS (`clients_select_by_role`,
  ya existe: admin ve todos los clientes de la agencia, miembro solo los
  asignados vía `client_assignments`), nunca un filtro en la aplicación.
- **D-12:** Se agregan tools explícitos en `lib/agent/tools/` —
  `list_clients` (filtro por nombre/industria/notas, texto plano tipo
  ILIKE, sin embeddings/búsqueda semántica) y `get_client` (ficha
  completa) — siguiendo el mismo patrón que `draft-client-content.ts` /
  `send-payment-reminder.ts`. Ambos heredan el scope de RLS vía
  `withTenantContext`, sin re-filtrar en la app (mismo criterio que
  `lib/clients/list-clients.ts` ya documenta).
- **D-13:** Cualquier miembro del equipo puede dar de alta un cliente
  nuevo (no solo admin) — un cliente creado por un miembro queda
  **autoasignado** a quien lo creó (reusa `lib/clients/assign-client.ts`
  existente de CTA-06); el admin puede reasignar después.
- **D-14:** Sin borrado ni archivado de clientes en esta fase — no lo pide
  ningún CLI-0x. Un alta equivocada se corrige editando.

### Qué muestra la ficha de cliente hoy (CLI-02)
- **D-15:** La ficha muestra el historial de conversación **real** (ya
  existe: bitácora de mensajes/aprobaciones de Fase 4) más secciones
  placeholder vacías para "pagos" y "próximas citas" — mismo layout, esas
  secciones se llenan solas cuando Fase 8 y Fase 6 se implementen; no hay
  que rediseñar la ficha después. Confirmado explícitamente por el usuario
  tras pedir aclaración.
- **D-16:** La ficha muestra a qué miembro(s) del equipo está asignado el
  cliente y permite reasignar ahí mismo (solo admin) — reusa
  `assign-client.ts`, no duplica esa UI en otro lugar.

### Claude's Discretion
- Set inicial exacto de categorías del dropdown de industria (D-04) — el
  usuario delegó la propuesta a Claude, editable después.
- Estructura exacta de la migración para agregar `create_client` /
  `update_client` al `agent_action_catalog` (D-08) — sigue el patrón de
  `0008_agent_action_catalog_seed.sql`.
- Diseño visual/layout exacto de la ficha (placeholders, disposición de
  secciones) — decisión de researcher/planner, no del usuario.

### Preguntas abiertas de RESEARCH.md (resueltas tras research)
- **D-17:** `list_clients` y `get_client` (tools de solo lectura) también se
  siembran en `agent_action_catalog` con riesgo **bajo**, mismo patrón que
  `create_client`/`update_client` — consistente con que TODO tool pasa por
  `classifyAndExecute`. Un fast-path que exima a las lecturas del gate de
  catálogo queda fuera de esta fase (posible refactor futuro).
- **D-18:** El flujo viejo de alta rápida de cliente en la página Team
  (`assign-clients-form.tsx` → `addClient()`, solo nombre, sin validar
  phone/email) se **elimina**, redirigiendo esa acción a
  `/dashboard/clients/new`. El propio comentario del stub en `clients.ts`
  ya asumía que Fase 5 reemplaza este flujo; dejarlo vivo crearía dos
  caminos de creación con validación distinta (diverge de D-02).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisitos y alcance de la fase
- `.planning/ROADMAP.md` (sección "Fase 5 — Gestión de clientes (CRM
  conversacional)") — objetivo y criterio de éxito de la fase.
- `.planning/REQUIREMENTS.md` (CLI-01 a CLI-05, SEG-08) — requisitos
  funcionales exactos que esta fase debe cubrir.
- `.planning/PROJECT.md` (secciones "Modelo de identidad y permisos" y
  "Alcance funcional — v1 → Funciones del Agente #2") — define las capas
  visible-cliente/solo-equipo y el principio de que el alcance de datos lo
  decide identidad+conversación, nunca un filtro de aplicación.
- `.planning/research/FEATURES.md` — investigación de dominio (HoneyBook,
  Dubsado, ClickUp, Taskip) que informó el criterio de "campos mínimos" (D-01).

### Convenciones que esta fase debe seguir
- `drizzle/migrations/0008_agent_action_catalog_seed.sql` — patrón exacto
  para agregar `create_client`/`update_client` al catálogo de riesgo (D-08).
- RLS de tres ramas (admin / miembro asignado / client_contact) establecida
  en Fase 2 (ver `.planning/phases/02-modelo-identidad-permisos/`) — la
  convención que toda tabla nueva con alcance por cliente debe repetir
  (nota explícita del roadmap para Fase 5).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/db/schema/clients.ts`: tabla stub deliberada (`id`, `agencyId`,
  `name`, `createdAt`) — el propio comentario del archivo dice "Phase 5
  adds the real client fields to this same table via a later migration".
  Esta fase amplía esta migración, no crea tabla nueva.
- `lib/clients/list-clients.ts`: `listClients()` ya filtra por RLS
  (`clients_select_by_role`, admin ve todo / miembro solo asignados) sin
  filtro manual en la app — reusar directo para `list_clients` tool y para
  el listado del formulario web.
- `lib/clients/list-clients.ts` → `listAssignedClientIds()`: ya existe para
  UI de asignación admin-only.
- `lib/clients/assign-client.ts`: Server Action de asignación (CTA-06,
  Fase 1) — reusar para autoasignación en alta (D-13) y reasignación desde
  la ficha (D-16).
- `lib/agent/tools/index.ts`: registro de tools (`AGENT_TOOLS`), función
  `toolsFor(identity)` que solo da tools a `team_member`, y `executeTool()`
  — patrón exacto a seguir para `create_client`, `update_client`,
  `list_clients`, `get_client`.
- `lib/agent/tools/draft-client-content.ts`: plantilla de tool con
  `catalogCode`, `definition` (Anthropic tool schema), narrowing manual de
  input (sin librería de validación runtime — postura del repo), y
  `execute()`.
- `lib/db/schema/client-assignments.ts` y `client_assignments` table: ya
  existen desde Fase 1.
- `lib/db/schema/authorized-contacts.ts`: modelo de contactos autorizados
  (Fase 2) — NO se toca ni se auto-vincula (D-05).
- `lib/agent/risk-interceptor.ts`: intercepta por `catalogCode` (bajo
  ejecuta, alto encola) — `create_client`/`update_client` entran con riesgo
  bajo (D-08).

### Established Patterns
- RLS-first, sin filtro de rol en código de aplicación — ver comentario en
  `list-clients.ts` citando `STACK-WEB.md §2`.
- `withTenantContext` para toda query scoped a agencia/rol.
- Catálogo de riesgo declarado por migración SQL (`agent_action_catalog`),
  nunca hardcodeado en TypeScript.

### Integration Points
- Nuevo tool de creación/edición/consulta de clientes se registra en
  `AGENT_TOOLS` (`lib/agent/tools/index.ts`).
- Migración de ampliación de `clients` (D-01) + migración de catálogo
  (D-08) son dos migraciones separadas, siguiendo la numeración secuencial
  de `drizzle/migrations/`.

</code_context>

<specifics>
## Specific Ideas

- El usuario fue explícito en que la reinterpretación de "búsqueda" (CLI-04)
  es la decisión central de esta fase: no es una feature de búsqueda
  aislada, es que el agente tenga el mismo acceso de consulta **y edición**
  que el usuario humano ya tiene por su rol — ver D-11.

</specifics>

<deferred>
## Deferred Ideas

- Fase 6 (citas/calendario): el usuario mencionó de pasada "terminar lo de
  las citas de la fase 6" — se confirmó que es su propia fase en el
  roadmap y no se discute aquí. Sin nota específica pendiente; se retoma
  cuando corra `/gsd-discuss-phase 6`.

[No hubo otras ideas fuera de alcance — la discusión se mantuvo dentro del
dominio de Fase 5.]

</deferred>

---

*Phase: 05-Gestión de clientes (CRM conversacional)*
*Context gathered: 2026-09-14*
