# Phase 3: Integración con WhatsApp/Meta - Context

**Gathered:** 2026-09-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Los mensajes de WhatsApp entran y salen del sistema, con el modelo de
identidad de la Fase 2 aplicado a cada mensaje entrante. Cubre WA-01 a
WA-07: Tech Provider directo, número interno compartido para el equipo,
comprensión de texto (audio/imagen quedan detectados pero no interpretados
— ver D-05), conversaciones 1:1 (sin grupos), costo transparente.

**Éxito** (de ROADMAP): un mensaje de WhatsApp real llega al sistema y se le
aplica correctamente el modelo de identidad de la Fase 2 — y, según lo
discutido, el sistema también responde algo real por la API de Meta,
probando el envío de punta a punta.

**Explícitamente fuera de esta fase**: generación de respuesta real por el
agente (Fase 4: agente conversacional core), interpretación de audio/imagen
(Deepgram/Claude vision, Fase 4), UI de Embedded Signup para que una agencia
conecte su propio WhatsApp (se construye cuando Meta apruebe la verificación
de negocio de Genzia), tabla completa de historial de conversación/bitácora
visible (Fase 4).

</domain>

<decisions>
## Implementation Decisions

### Alcance entra/sale
- **D-01:** Esta fase cubre el pipeline completo inbound + outbound, pero
  con contenido trivial: el webhook recibe un mensaje real, resuelve
  identidad (equipo/contacto/desconocido), y el sistema envía de vuelta un
  mensaje fijo (ej. "Mensaje recibido") por la API real de envío de Meta —
  no un simple 200 OK al webhook. Esto prueba que el envío saliente
  funciona (permisos, formato, rate limits) antes de que Fase 4 dependa de
  él para respuestas reales. No hay generación de respuesta por LLM en esta
  fase — eso es exclusivamente Fase 4.

### Secuenciación con la verificación de Meta
- **D-02:** La verificación de negocio de Genzia ante Meta sigue en trámite
  (ver STATE.md, pendiente desde Fase 1). Esta fase arranca YA usando el
  número/WABA de prueba que Meta da gratis a cualquier developer sin
  verificación de negocio — no se espera a que el trámite legal resuelva
  para empezar a construir y probar el pipeline.
- **D-03:** Sin UI de Embedded Signup (WA-02) en esta fase. El flujo de
  onboarding para que una agencia conecte su propio número de WhatsApp
  Business se construye cuando Meta apruebe la verificación de negocio —
  antes de eso no hay forma de probarlo de punta a punta con una agencia
  real. Esta fase es solo el lado plataforma: webhook, identidad, envío,
  todo probado contra el número de prueba fijo (no hay UI de conexión por
  agencia todavía).

### Persistencia de mensajes
- **D-04:** Se crea una tabla nueva y mínima (nombre exacto a discreción de
  planning — ej. `messages`) para el registro crudo de mensajes
  entrantes/salientes (contenido, dirección, identidad resuelta del
  remitente, timestamp, canal). Es deliberadamente separada de `audit_log`
  (creada en Fase 2, schema-only) — `audit_log` se reserva para
  acciones/decisiones del agente (aprobaciones, cambios de riesgo) en fases
  posteriores, mezclar mensajes crudos ahí contaminaría su propósito
  documentado en `02-02-SUMMARY.md`.

### Alcance de medios
- **D-05:** Esta fase maneja mensajes de texto de punta a punta únicamente.
  Si llega un mensaje de audio o imagen, el sistema detecta el tipo y guarda
  una referencia (el `media_id` que da Meta) sin descargar, transcribir ni
  interpretar el contenido — la descarga (a R2) y la interpretación
  (Deepgram para voz, Claude vision para imágenes, ya investigado en
  `research/STACK-AGENT.md` §3-4) se implementan en Fase 4, cuando el
  agente conversacional exista para consumirlas.

### Claude's Discretion
- Nombre y estructura exacta de columnas de la tabla de mensajes (D-04).
- Mecanismo técnico de procesamiento asíncrono del webhook (Inngest, ya
  elegido en STACK.md pero aún no instalado/wireado en el repo — research
  confirma que el webhook debe responder rápido y procesar aparte).
- Manejo de errores del webhook (reintentos de Meta, timeouts, payloads
  malformados).
- Enfoque de testing dado que esta fase depende de credenciales reales de
  Meta (test WABA) — probablemente similar al patrón de Fase 1/2: algunos
  pasos requieren ejecutarse desde una máquina/sesión con acceso de red real
  y credenciales del usuario, no asumibles en una sesión sandboxed.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisitos y objetivo de fase
- `.planning/ROADMAP.md` §"Fase 3 — Integración con WhatsApp / Meta" — objetivo y criterio de éxito
- `.planning/REQUIREMENTS.md` §"WA — Integración con WhatsApp / Meta" (WA-01 a WA-07) — requisitos completos con REQ-IDs

### Research de dominio (ya investigado, no repetir)
- `.planning/research/STACK-AGENT.md` §5 "WhatsApp Cloud API integration (WA-01–WA-07)" — Tech Provider Program, Embedded Signup v4 (NO v2, deprecado 15-oct-2026), estructura de webhook único multi-agencia vía `phone_number_id`, ventana de 24h y templates, API de grupos (fuera de v1 per D anterior), modelo de dos números
- `.planning/research/STACK-AGENT.md` §3 "Voice note transcription" y §4 "Image understanding" — Deepgram/Claude vision, diferidos a Fase 4 per D-05
- `.planning/research/STACK-AGENT.md` §6 "Audit log / approval queue pattern" — por qué `audit_log` es de Fase 4+, no de esta fase

### Modelo de identidad (Fase 2, dependencia directa de esta fase)
- `.planning/phases/02-modelo-identidad-permisos/02-04-SUMMARY.md` — contrato de `resolveIdentity(agencyId, phoneNumber)` y `withResolvedIdentityContext` que esta fase debe invocar por cada mensaje entrante
- `.planning/phases/02-modelo-identidad-permisos/02-07-SUMMARY.md` — **hallazgo abierto SEG-12**: una identidad `unknown` en un scope `withResolvedIdentityContext` ya resuelto todavía puede leer `team_members`/`authorized_contacts` si algún código futuro abre ese scope y consulta esas tablas. Esta fase es exactamente el primer código real que invoca `withResolvedIdentityContext` para mensajes reales — **debe evitar ese patrón** (nunca consultar `team_members`/`authorized_contacts` directamente dentro de un scope de identidad `unknown`) hasta que el gap se cierre formalmente.

### Contexto de producto
- `.planning/PROJECT.md` §"Cómo se interactúa con el agente" (líneas 46-110) — dos números de WhatsApp, integración directa con Meta, flujo de conexión de agencia, costos
- `.planning/STATE.md` — estado actual de la verificación de negocio ante Meta (en trámite, sin resolver) y del acceso de red a Neon/APIs externas desde sesiones sandboxed (variable por sesión, verificar directamente en cada una)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `lib/identity/resolve-identity.ts`, `lib/tenant/with-resolved-identity-context.ts` (Fase 2) — el contrato de resolución de identidad que cada mensaje entrante debe pasar por acá antes de cualquier lectura de datos
- `app/api/webhooks/clerk/route.ts` (Fase 1) — patrón existente de webhook con verificación de firma (Svix) e idempotencia; el webhook de Meta necesita el mismo patrón con `X-Hub-Signature-256` en vez de Svix

### Established Patterns
- Verificación de firma + idempotencia en webhooks (Clerk ya lo hace)
- RLS + GUCs como único mecanismo de aislamiento (Fase 1/2) — cualquier tabla nueva de mensajes debe seguir la convención de tres ramas (admin / miembro-asignado / client_contact) de `0007_client_contact_scope.sql` si va a ser client-scoped
- Scripts de verificación `scripts/verify-*.ts` contra Neon real, con limpieza de datos de prueba — mismo patrón esperado para lo que pruebe esta fase

### Integration Points
- Inngest (elegido en `STACK.md` para jobs en segundo plano) — no instalado todavía en el repo (`package.json` no lo tiene). Esta fase es el primer punto de integración real: el research confirma que el webhook debe responder rápido a Meta y procesar identidad/envío aparte, de forma asíncrona.
- No existe código de WhatsApp/Meta en el repo todavía — esta fase parte de cero en esa área.

</code_context>

<specifics>
## Specific Ideas

No hay referencias visuales o de UI — esta fase es backend puro (webhook,
identidad, envío, persistencia mínima). No se mencionaron ejemplos externos
o comportamientos específicos más allá de las decisiones D-01 a D-05.

</specifics>

<deferred>
## Deferred Ideas

- **UI de Embedded Signup real** (WA-02) — se construye cuando Meta apruebe
  la verificación de negocio de Genzia; no es parte de esta fase (D-03).
- **Interpretación de audio/imagen** (Deepgram, Claude vision) — Fase 4,
  cuando el agente conversacional exista para consumir esos medios (D-05).
- **Generación de respuesta real del agente** — Fase 4 (agente
  conversacional core), esta fase solo prueba el pipeline con un ack fijo
  (D-01).
- **Tabla completa de historial de conversación/bitácora visible** — Fase 4;
  esta fase solo crea un registro crudo mínimo (D-04).

Ninguna de estas ideas surgió como scope creep durante la discusión — son
los límites de fase ya implícitos en ROADMAP.md, hechos explícitos acá para
que planning no los confunda con trabajo de esta fase.

</deferred>

---

*Phase: 03-integraci-n-con-whatsapp-meta*
*Context gathered: 2026-09-09*
