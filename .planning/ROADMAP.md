# ROADMAP.md — Genzia

Profundidad: **Comprehensiva** (config.json). Deriva de `REQUIREMENTS.md`. Orden
por dependencia real, no por categoría — lo que todo lo demás necesita va primero.
No define stack técnico ni asigna tiempos (GSD no estima en horas/días/semanas).

## Fase 1 — Fundaciones de cuenta y equipo (multi-tenant) — COMPLETA

**Objetivo**: una agencia puede registrarse, invitar a su equipo, y el sistema
distingue quién es quién.

- CTA-01 a CTA-06 (registro self-serve, prueba gratis, marca del agente, invitar
  equipo con rol y número, asignar clientes)
- **Tarea crítica en paralelo, no bloqueante para el desarrollo**: iniciar el
  trámite de verificación de negocio de Genzia/Kodevon ante Meta (ver PROJECT.md,
  "Integración directa con Meta") — es un trámite externo lento, debe arrancar ya.
- **Tarea crítica en paralelo**: resolver con asesoría legal la estructura
  corporativa (Kodevon SAS vs. SAS propia para Genzia) antes de que la
  verificación ante Meta quede atada a la entidad equivocada (ver PROJECT.md,
  "Consideraciones legales").

**Éxito**: una agencia se registra, invita a 2+ miembros con roles distintos, y
cada quien ve solo lo que su rol permite.

**Plans:** 5 plans

Plans:
- [x] 01-PLAN.md — Esquema Drizzle + RLS forzada multi-tenant
- [x] 02-PLAN.md — Webhook de Clerk + onboarding self-serve con trial
- [x] 03-PLAN.md — Marca del agente (nombre, tono, logo)
- [x] 04-PLAN.md — Invitación de equipo con rol/WhatsApp y asignación de clientes
- [x] 05-PLAN.md — Checklist de verificación ante Meta y consulta legal

## Fase 2 — Modelo de identidad y permisos

**Objetivo**: dado un mensaje o sesión entrante, el sistema resuelve quién escribe
(miembro de equipo con rol, contacto autorizado de un cliente, o número
desconocido) y a qué datos tiene acceso — con el aislamiento cliente-a-cliente
enforced por RLS de Postgres, nunca por filtro en la aplicación. Sin canal real
todavía (WhatsApp llega en Fase 3; se prueba con mensajes simulados).

- SEG-01 a SEG-09 y SEG-12 (resolución de identidad, contactos autorizados,
  opt-in, aislamiento por conversación, capas visible/solo-equipo, divulgación
  honesta, número desconocido)
- SEG-10/SEG-11 solo como modelo de datos (catálogo estático de riesgo + esquema
  de `audit_log`), per 02-CONTEXT.md D-01 — el motor de clasificación, la cola de
  aprobación y la UI de bitácora son Fase 4.

**Éxito**: dado un mensaje simulado desde un número de equipo, un número de
cliente A, un número de cliente B y un número desconocido, el sistema resuelve
cada uno a la identidad y alcance correctos, y nunca deja pasar datos de un
cliente hacia otro.

**Plans:** 7 plans (4 waves)

Plans:
- [x] 02-01-PLAN.md — Contrato `ResolvedIdentity`, clasificador puro y suite unitaria sin red (SEG-01, SEG-09)
- [x] 02-02-PLAN.md — Tablas Drizzle `authorized_contacts` / `agent_action_catalog` / `audit_log` + migración generada 0005 (SEG-02, SEG-04)
- [x] 02-03-PLAN.md — Migraciones a mano 0006/0007/0008: GRANTs, RLS, triggers de colisión, rama `client_contact` y semilla del catálogo (SEG-02, SEG-03, SEG-05, SEG-07, SEG-08, SEG-12)
- [x] 02-04-PLAN.md — `resolveIdentity` + `withResolvedIdentityContext` (GUC `app.client_id`) (SEG-01, SEG-05, SEG-06, SEG-07, SEG-12)
- [x] 02-05-PLAN.md — Server Actions admin-only del roster de contactos con opt-in obligatorio (SEG-02, SEG-03, SEG-04)
- [x] 02-06-PLAN.md — Suite de integración `verify-identity-resolution.ts` contra Neon real (SEG-01..SEG-08, SEG-12)
- [x] 02-07-PLAN.md — [BLOCKING] aplicar migraciones a Neon y correr ambas suites en vivo (checkpoint, requiere red)

## Fase 3 — Integración con WhatsApp / Meta — COMPLETA CON GAP DOCUMENTADO

**Objetivo**: los mensajes de WhatsApp entran y salen del sistema.

- WA-01 a WA-07 (Tech Provider, Embedded Signup, número interno compartido,
  comprensión multimodal, conversaciones 1:1, costo transparente)
- Depende de que la Fase 1 (verificación de negocio) esté suficientemente
  avanzada; si Meta aún no aprueba, esta fase puede empezar con el número interno
  de la plataforma y una cuenta de prueba, y conectar agencias reales apenas Meta
  apruebe.

**Éxito**: un mensaje de WhatsApp real llega al sistema y se le aplica
correctamente el modelo de identidad de la Fase 2, y el sistema responde con
un ack fijo por la API real de envío de Meta (D-01), probando el pipeline
completo entra/sale.

**Plans:** 8 plans (4 waves)

Plans:
- [x] 03-01-PLAN.md — Tabla `messages` (D-04) + migraciones 0012/0013: RLS con GUC `app.actor`, función SECURITY DEFINER `find_agency_by_team_whatsapp_number`, índice único global de `whatsapp_number` (WA-04, WA-07)
- [x] 03-02-PLAN.md — Credenciales Meta en `.env.example`, instalación de Inngest + cliente tipado, `withSystemWebhookContext`, manejo de colisión global de WhatsApp al invitar (WA-01, WA-03)
- [x] 03-03-PLAN.md — Verificación HMAC de `X-Hub-Signature-256` y parser de payloads (texto/imagen/audio/no-soportado/status) + suite sin red (WA-05)
- [x] 03-04-PLAN.md — Envío saliente directo a Graph API v25.0 + suite con `fetch` stub (WA-01)
- [x] 03-05-PLAN.md — Resolución cross-agencia del número, ruteo por `phone_number_id` e ingesta idempotente con identidad de Fase 2 (WA-02, WA-03, WA-04)
- [x] 03-06-PLAN.md — Función Inngest `send-whatsapp-ack` (D-01) y handler `serve()` (WA-01, WA-07)
- [x] 03-07-PLAN.md — Route handler `/api/webhooks/meta` (handshake GET + intake POST) y backfill de estado/precio desde `statuses[]` (WA-01, WA-03, WA-05, WA-07)
- [x] 03-08-PLAN.md — Migraciones aplicadas a Neon real, suite de integración `verify-whatsapp-webhook.ts` (28/28), sin regresión Fase 1/2 (WA-01, WA-03, WA-04, WA-05, WA-07). Round-trip real de WhatsApp queda abierto — bloqueado por App Review de Meta (app no publicada), no por código; ver `03-08-SUMMARY.md`.

## Fase 4 — Agente conversacional core

**Objetivo**: el agente responde con criterio, en el chat web y por WhatsApp.

- Comprensión multimodal end-to-end (WA-05)
- Motor de clasificación de riesgo y cola de aprobación humana (SEG-10)
- Bitácora visible de acciones/mensajes (SEG-11, SIS-01)
- Inyectar `AI_DISCLOSURE_RULE` (creado en Fase 2) en todo system prompt (SEG-09)

**Éxito**: el agente sostiene una conversación de varios turnos, usa solo el
contexto permitido por la Fase 2, y cualquier acción de alto riesgo queda
pendiente de aprobación visible para el equipo.

**Requirements:** WA-05, SEG-10, SEG-11, SIS-01, SEG-09 (primer consumidor real
de SEG-05/06/07/08)

**Plans:** 12 plans (7 waves)

Plans:
- [x] 04-01-PLAN.md — Migraciones 0014/0015: cerrar los dos gaps reales de RLS (`audit_log` sin ramas de rol, `messages` sin chequeo de `client_assignments`) + suite `verify-agent-rls.ts` (SEG-11, SIS-01, SEG-06, SEG-08)
- [x] 04-02-PLAN.md — Dependencias, contrato de env, cliente Anthropic vía passthrough de OpenRouter y system prompt con SEG-09 inyectado sin ramas (SEG-09, SEG-07, SEG-05)
- [x] 04-03-PLAN.md — Tabla `approval_queue` + migración 0016 (RLS solo-equipo) y columnas `status`/`approval_id` en `audit_log` (SEG-10, SEG-11)
- [x] 04-04-PLAN.md — `buildAgentContext`: el único lector de contexto por turno, con tope de historial y cero filtros de cliente en aplicación (SEG-05/06/07/08, SIS-01)
- [x] 04-05-PLAN.md — Descarga de media en dos pasos desde Meta, transcripción Deepgram Nova-3 e `interpretMedia` compartido (WA-05)
- [x] 04-06-PLAN.md — Registro de herramientas + interceptor de riesgo SEG-10 (bajo ejecuta, alto encola) con cross-check de alcance (SEG-10, SEG-11, SEG-07)
- [x] 04-07-PLAN.md — `runTurn` acotado + `process-agent-turn` de Inngest reemplazando el ack fijo de la Fase 3 (WA-05, SEG-09, SEG-10, SIS-01, SEG-05)
- [x] 04-08-PLAN.md — `scripts/verify-agent.ts`: suite de integración contra Neon real del motor SEG-10 y la frontera de contexto (SEG-10, SEG-11, SEG-05/06/07)
- [x] 04-09-PLAN.md — Server Actions de aprobación/rechazo + función Inngest que reproduce la acción aprobada (SEG-10, SEG-11)
- [x] 04-10-PLAN.md — Chat web solo-equipo: migración 0017, `POST /api/chat` y página de conversación multimodal (WA-05, SIS-01, SEG-09, SEG-05)
- [ ] 04-11-PLAN.md — Bitácora visible con cola de aprobación e historial de conversación (SEG-11, SIS-01, SEG-10, SEG-06)
- [ ] 04-12-PLAN.md — [BLOCKING] aplicar 0014-0017 a Neon, correr las nueve suites y verificación humana de conversación y aprobación (checkpoint, requiere red y claves)

## Fase 5 — Gestión de clientes (CRM conversacional)

**Objetivo**: dar de alta y consultar clientes, por formulario o por conversación.

- CLI-01 a CLI-05
- Toda tabla nueva con alcance por cliente debe repetir la convención de tres
  ramas de RLS establecida en Fase 2 (admin / miembro asignado / `client_contact`).

**Éxito**: se da de alta un cliente dictándoselo al agente, y otro por formulario;
ambos quedan consultables y editables, con la separación visible-cliente /
solo-equipo funcionando.

## Fase 6 — Calendario y agenda

**Objetivo**: agendar, reagendar y recordar citas y contenido, por lenguaje
natural o vista visual.

- CAL-01 a CAL-05

**Éxito**: se agenda una cita de grabación por WhatsApp en lenguaje natural,
aparece en la vista visual, y el sistema manda el recordatorio automático a
tiempo.

## Fase 7 — Contenido

**Objetivo**: proponer, aprobar y regenerar contenido con el cliente.

- CON-01 a CON-04

**Éxito**: el agente propone una pieza, el cliente pide un cambio por WhatsApp, y
el agente regenera automáticamente (o pide aprobación humana si el caso lo
amerita) sin perder el hilo del cliente correcto.

## Fase 8 — Cobros a clientes

**Objetivo**: cobrar sin ambigüedad ni riesgo de disputa.

- COB-01 a COB-06

**Éxito**: un pago recurrente y uno puntual se registran, el agente manda el
recordatorio con link de pago, y el sistema SOLO marca como pagado con
confirmación real del procesador (una afirmación del cliente en el chat no
alcanza).

## Fase 9 — Portal del cliente final

**Objetivo**: el cliente final tiene su propio espacio, sin salir de lo que le
corresponde ver.

- POR-01 a POR-04

**Éxito**: un contacto autorizado entra al portal, ve solo su calendario/pagos,
aprueba una pieza de contenido y sube un archivo — nunca ve nada de otro cliente.

## Fase 10 — Contratos y bóveda de credenciales

**Objetivo**: dar seguimiento a la relación contractual con el cliente y guardar
sus accesos de forma segura. *(La firma electrónica dentro de la plataforma,
CTR-01, se movió a v2 — costaba US$250/mes fijo desde el primer contrato con la
única opción viable evaluada, Documenso; no se justifica en v1.)*

- CTR-02, BOV-01

**Éxito**: el sistema alerta a tiempo el vencimiento/renovación de un contrato, y
el equipo guarda credenciales del cliente visibles solo para ellos.

## Fase 11 — Ventas, colaboradores externos y pagos a terceros

**Objetivo**: cubrir el ciclo completo de la agencia, no solo clientes activos.

- VEN-01, VEN-02, COL-01, PAG-01

**Éxito**: se crea un prospecto, se le genera una propuesta asistida por el
agente, se registra un colaborador externo y un pago a un freelancer.

## Fase 12 — Tareas internas, rentabilidad y pulido de plataforma

**Objetivo**: cerrar el v1 con la operación interna y las vistas de apoyo.

- TAR-01, TAR-02, SIS-02, SIS-03, SIS-04, CTA-03 (verificar multiidioma end-to-end)

**Éxito**: el equipo gestiona tareas ligadas al calendario, ve rentabilidad por
cliente, recibe notificaciones por los 3 canales, y la plataforma funciona
completa en español e inglés.

---

## Dependencias críticas fuera del desarrollo (seguimiento continuo)

- **Verificación de negocio ante Meta** (arranca en Fase 1, bloquea el uso real de
  Fase 3 con agencias reales — no bloquea el desarrollo).
- **Definición de estructura corporativa** (arranca en Fase 1, debe resolverse
  antes de completar la verificación ante Meta para no tener que rehacerla).
- **Residencia de datos en Colombia (Ley 1581/Habeas Data)** — relevante desde
  Fase 2, que introduce la primera tabla con datos personales de terceros
  (`authorized_contacts`: nombre, teléfono, email de contactos del cliente).
- **Stack técnico**: resuelto en `STACK.md` (Next.js 16, Postgres+RLS, Drizzle,
  Neon, Clerk, Inngest, OpenRouter, MercadoPago).
