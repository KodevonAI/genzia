# Phase 5: Gestión de clientes (CRM conversacional) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-14
**Phase:** 05-Gestión de clientes (CRM conversacional)
**Areas discussed:** Campos de la ficha de cliente, Alta por dictado al agente, Búsqueda por nombre o tema, Qué muestra la ficha hoy (CLI-02)

---

## Campos de la ficha de cliente

| Option | Description | Selected |
|--------|-------------|----------|
| Mínimo | Nombre, contacto principal, industria/tipo de negocio, notas | ✓ |
| Ampliado | + redes sociales, sitio web, dirección, tamaño de empresa | |
| Tú decides | Claude propone según necesidades de otras fases | |

**User's choice:** Mínimo.

| Question | Selected |
|---|---|
| Campos visible-cliente vs solo-equipo | Notas = solo-equipo, resto visible |
| ¿Notas: campo único o lista con fecha/autor? | Un solo campo de texto libre |
| Campos obligatorios al crear | Nombre + contacto principal |
| Contacto: separado o libre | Teléfono y email separados |
| ¿Teléfono/email de ficha = contacto autorizado (Fase 2)? | Distintos, sin auto-vincular |
| Industria: lista fija o texto libre | Lista fija (dropdown) |
| ¿Quién define la lista de industrias? | Claude propone set inicial |

**Notes:** El usuario aclaró explícitamente que teléfono/email en la ficha
de cliente es informativo para el equipo y NO debe confundirse ni
auto-vincularse con `authorized_contacts` (Fase 2) — son dos conceptos
distintos que Fase 2 mantuvo separados a propósito.

---

## Alta por dictado al agente

| Question | Selected |
|---|---|
| Falta dato obligatorio en el dictado | El agente pregunta de vuelta antes de crear |
| Riesgo de `create_client` en el catálogo | Bajo (ejecuta solo) |
| Nombre dictado coincide con cliente existente | El agente avisa y confirma |
| ¿Edición (CLI-03) también por dictado? | Sí — nuevo tool `update_client`, mismo riesgo bajo |

**Notes:** Ninguna.

---

## Búsqueda por nombre o tema

**Primera pregunta rechazada por el usuario** ("¿qué es 'tema' exactamente?"
con dos opciones técnicas) — el usuario pidió aclarar antes de elegir entre
opciones y reformuló el alcance real de la pregunta.

**Aclaración del usuario (texto libre):** "esta busqueda debe darse bajo
cualquier cosa que busque el usuario con el agente, el agente debe tener
acceso a todos los datos que debe poder ver el usuario, y debe ser capaz de
hacer cualquier accion de consulta sobre los datos que puede ver, deberia
tambien poder editar los clientes que tiene asignados y demas cosas"

Esto reencuadró la "búsqueda" (CLI-04) de una feature aislada a un
principio de acceso general: el agente debe poder consultar **y editar**
todo lo que el usuario ya puede ver según su rol (RLS), no solo buscar por
nombre/industria.

| Question | Selected |
|---|---|
| ¿Tool explícito list_clients/get_client, o precargar en buildAgentContext? | Tool explícito de consulta |
| ¿Quién puede dar de alta un cliente? | Cualquier miembro del equipo |
| ¿Cliente creado por un miembro queda autoasignado? | Sí, autoasignado a quien lo crea |
| ¿Borrado/archivo de cliente en esta fase? | Fuera de alcance |

**Notes:** Ninguna adicional.

---

## Qué muestra la ficha hoy (CLI-02)

| Question | Selected |
|---|---|
| Ficha ahora (sin pagos/citas implementados) | Historial real + placeholders vacíos |
| ¿Ficha muestra asignado y permite reasignar? | Sí, visible + reasignar (reusa assign-client.ts) |
| ¿Lista de industrias necesita ES/EN desde ya? | Bilingüe desde ya |

**Notes:** El usuario tuvo dificultad para articular esta respuesta en dos
intentos de texto libre (respuestas cortadas/ambiguas: "necesito que de
esto esumen de historial..." y luego repitió el fragmento del requisito
CLI-02 textual). Claude reflejó la interpretación más razonable —el
placeholder de pagos/citas se llena solo cuando esas fases existan, sin
rediseñar la ficha— y el usuario confirmó explícitamente con "Sí,
confirmado".

Durante esta área el usuario también escribió, fuera de contexto de la
pregunta activa: "necesito terminar lo de las citas de la fase 6" — se
interpretó como posible intento de traer alcance de Fase 6 a esta
discusión. Se le aclaró que Fase 6 es su propia fase en el roadmap y se le
preguntó si quería anotar algo específico; el usuario eligió seguir con
Fase 5 sin anotar nada adicional.

---

## Claude's Discretion

- Set inicial exacto de categorías del dropdown de industria.
- Estructura exacta de la migración para agregar `create_client`/`update_client`
  al `agent_action_catalog`.
- Diseño visual/layout exacto de la ficha y sus placeholders.

## Deferred Ideas

- Fase 6 (citas/calendario) — mencionada de pasada por el usuario, sin nota
  específica; se confirmó que corre en su propio ciclo de discuss-phase.
