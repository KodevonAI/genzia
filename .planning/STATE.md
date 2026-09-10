---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Waiting on human setup
last_updated: "2026-09-10T14:55:00.000Z"
progress:
  total_phases: 3
  completed_phases: 2
  total_plans: 20
  completed_plans: 19
  percent: 95
---

# STATE.md — Genzia

**Última actualización**: 2026-09-09

## Dónde vamos

**Fase 3 (integración con WhatsApp/Meta) — 7/8 planes ejecutados (waves 1-3),
esperando setup humano para wave 4.** `03-01` a `03-07` completos, mergeados
a `main`, verificados (tsc limpio, `npx next build` limpio, 31/31 assertions
en `verify-whatsapp-webhook-parsing.ts` + `verify-whatsapp-send.ts` sin
regresión en cada wave). Pipeline completo entra/sale de WhatsApp existe en
código: webhook `/api/webhooks/meta` (GET handshake + POST intake), función
`find_agency_by_team_whatsapp_number` (SECURITY DEFINER, en migración
0013, aún NO aplicada a Neon), ingesta idempotente con identidad de Fase 2,
envío directo a Graph API v25.0, función Inngest `send-whatsapp-ack`.

**Wave 4 (`03-08`) bloqueada — requiere setup humano, no automatizable:**
- `DATABASE_URL` real de Neon (aplicar migraciones 0012/0013 vía
  `npm run db:migrate`)
- Credenciales Meta reales: `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`,
  `META_WHATSAPP_PHONE_NUMBER_ID`, `META_WHATSAPP_ACCESS_TOKEN`
- Config en dashboard de Meta: registrar URL de callback + verify token,
  suscribir el app al field `messages`, confirmar la suscripción WABA→App,
  agregar números de prueba (tope 5)
- Round-trip real: mandar un WhatsApp real al número de prueba y confirmar
  que llega el ack

Varias desviaciones documentadas (Rule 1, bug fix) a lo largo de las waves:
API real de `inngest@4.20.0` difiere de lo que RESEARCH.md asumía
(`eventType`/`staticSchema` en vez de `EventSchemas`/`.fromRecord()`);
`import "server-only"` removido de `verify-meta-signature.ts` (rompía la
importación bajo `tsx`, mismo patrón ya usado en
`with-resolved-identity-context.ts`); `next build --no-lint` ya no existe en
esta versión del CLI. Todo documentado en los SUMMARY.md de cada plan.

Próximo paso: usuario corre `/gsd-execute-phase 3` de nuevo (o
`/gsd-execute-phase 3 --wave 4`) cuando tenga las credenciales/acceso reales
listos — el usuario eligió pausar en vez de que yo lo guíe paso a paso ahora.

**Fase 2 (modelo de identidad y permisos) — COMPLETA, verificada de punta a
punta contra Neon real.** 7 planes en 4 waves. Migraciones 0005-0008
aplicadas a Neon; `db:verify-rls` (regresión Fase 1) 7/7 y `db:verify-identity`
16/18 (ver `02-07-SUMMARY.md` para las 2 fallas conocidas y por qué se
dejaron abiertas — un hallazgo real de RLS, no un falso negativo). Próximo
paso: `/gsd-verify-work 2` o continuar a Fase 3.

**Fase 1 (fundaciones de cuenta y equipo) — COMPLETA.** Los 5 planes
(`01-01`, `01-02`, `01-03`, `01-04`, `01-05`) están verificados de punta a
punta contra Neon/Clerk/R2 reales, desde la máquina del usuario. `01-03` y
`01-04` tenían código ya comiteado (`1be8855`/`e65b47d` y
`240e009`/`433d11e`) de una sesión que nunca generó `SUMMARY.md` —
backfilleados y luego confirmados con verificación manual real (ver sus
SUMMARY.md para el detalle). Esa verificación encontró y corrigió 2 bugs
reales más (van 5 en total a lo largo de la fase): `middleware.ts` excluía
todas las rutas `/api/*` del contexto de auth de Clerk (rompía
`/api/uploads/brand-logo`), y el bucket R2 no tenía política CORS. Pendiente
formal: marcar la fase como cerrada en `ROADMAP.md` y decidir el siguiente
paso (Fase 2: modelo de identidad y permisos).

## Completado

- [x] `PROJECT.md` — visión, modelo de negocio, roles, modelo de identidad y
      permisos, integración con Meta, consideraciones legales abiertas

- [x] `config.json` — modo YOLO, profundidad comprehensiva, ejecución paralela
- [x] `research/FEATURES.md` y `research/PITFALLS.md` — investigación de dominio
- [x] `REQUIREMENTS.md` — requisitos v1 con REQ-IDs por categoría, backlog v2/futuro
- [x] `ROADMAP.md` — 12 fases en orden de dependencia
- [x] `research/STACK-WEB.md`, `STACK-AGENT.md`, `STACK-PAYMENTS.md` — investigación de stack
- [x] `STACK.md` — síntesis de decisiones: Next.js 16, Postgres+RLS multi-tenant,
      Drizzle, Neon, Clerk, Inngest, Claude Sonnet 5 + Haiku 4.5, orquestación a
      mano, MercadoPago (Split Payments), Documenso, KMS

- [x] Ajuste de alcance derivado del research: grupos de WhatsApp sacados de v1
      (limitación real de la API de Meta)

- [x] Ajuste de alcance: firma electrónica de contratos (CTR-01) movida a v2 —
      costo fijo de US$250/mes desde el primer contrato no se justifica en v1;
      v1 mantiene solo alertas de vencimiento (CTR-02)

- [x] LLM consumido vía OpenRouter (endpoint compatible-Anthropic) en vez de
      directo a Anthropic, para poder variar de modelo sin lock-in

- [x] Costos de hosting verificados a 250 y 10,000 usuarios — la arquitectura
      escala por facturación, no por reconstrucción

- [x] `01-05` — `META-BUSINESS-VERIFICATION-CHECKLIST.md` y
      `CORPORATE-STRUCTURE-LEGAL-QUESTIONS.md` redactados; usuario confirmó que
      ambos trámites externos (verificación ante Meta, consulta al abogado) ya
      arrancaron — ver
      `.planning/phases/01-fundaciones-cuenta-equipo/01-fundaciones-cuenta-equipo-05-SUMMARY.md`

- [x] `01-01` — App Next.js 16 (App Router, next-intl es/en, Clerk) +
      esquema Drizzle completo (agencies, team_members, clients,
      client_assignments, agent_brand_config) + RLS de Postgres forzada en
      cada tabla multi-tenant, con políticas por `app.agency_id` /
      `app.team_member_id` / `app.role`; `withTenantContext` como único
      camino a datos multi-tenant; aislamiento probado con
      `scripts/verify-rls-isolation.ts` (7/7 aserciones) contra la base Neon
      real — ver
      `.planning/phases/01-fundaciones-cuenta-equipo/01-fundaciones-cuenta-equipo-01-SUMMARY.md`

- [x] `01-02` — webhook de Clerk (`organization.created`/`.deleted`,
      verificado con Svix, idempotente) que aprovisiona `agencies` con
      trial de 14 días; flujo self-serve completo signup -> onboarding
      (crea la Clerk Organization) -> dashboard con banner de trial; probado
      de punta a punta contra Neon/Clerk reales por el usuario (webhook vía
      ngrok, dos agencias independientes, firma inválida rechazada con 400)
      — ver
      `.planning/phases/01-fundaciones-cuenta-equipo/01-fundaciones-cuenta-equipo-02-SUMMARY.md`
      para el bug real encontrado y corregido (escrituras del webhook a
      `agencies` violaban RLS por no fijar `app.agency_id` antes de escribir
      — mismo patrón que el bug de `01-01`: RLS no tiene fallback seguro por
      defecto para un GUC olvidado)

- [x] `01-03` — CTA-02 verificado de punta a punta: nombre/tono/logo se
      guardan y persisten, aislados por agencia. 2 bugs reales encontrados y
      corregidos en la verificación: `middleware.ts` excluía `/api/**` del
      contexto de Clerk (rompía el upload de logo con 401), y faltaba
      política CORS en el bucket R2 (bloqueaba el PUT presignado con 403) —
      ver
      `.planning/phases/01-fundaciones-cuenta-equipo/01-fundaciones-cuenta-equipo-03-SUMMARY.md`

- [x] `01-04` — CTA-04/05/06 verificado de punta a punta: founder queda
      admin activo sin invitación (tras suscribir
      `organizationMembership.created` en Clerk Dashboard), invitación con
      rol+WhatsApp aceptada correctamente, miembro no-admin bloqueado de
      páginas admin-only, asignar/desasignar cliente cambia inmediatamente
      lo que el miembro ve — confirmado a nivel de datos (`client_assignments`),
      no solo UI — ver
      `.planning/phases/01-fundaciones-cuenta-equipo/01-fundaciones-cuenta-equipo-04-SUMMARY.md`

- [x] `02-01` — Contrato de identidad puro y testeable: `ResolvedIdentity`
      (discriminated union), `classifyIdentity` (equipo gana sobre contacto
      si ambas filas existen), regla de disclosure SEG-09; suite sin red,
      7/7 aserciones — ver
      `.planning/phases/02-modelo-identidad-permisos/02-01-SUMMARY.md`

- [x] `02-02` — Esquema Drizzle de Fase 2: `authorized_contacts` (trío de
      atestación de opt-in, único por (agency_id, phone_number)),
      `agent_action_catalog` (solo `low`/`high`), `audit_log`
      (append-only); migración 0005 generada — ver
      `.planning/phases/02-modelo-identidad-permisos/02-02-SUMMARY.md`

- [x] `02-03` — GRANTs, RLS y triggers anti-colisión de teléfono (migraciones
      0006-0008); tres-ramas admin/miembro-asignado/client_contact en
      `clients_select_by_role` — ver
      `.planning/phases/02-modelo-identidad-permisos/02-03-SUMMARY.md`

- [x] `02-04` — `resolveIdentity(agencyId, phoneNumber)` y
      `withResolvedIdentityContext` (GUCs no-Clerk); ni un filtro por
      cliente en código de aplicación, solo GUCs+RLS — ver
      `.planning/phases/02-modelo-identidad-permisos/02-04-SUMMARY.md`

- [x] `02-05` — Server Actions admin-only para el roster de contactos
      (`addAuthorizedContact`/`removeAuthorizedContact`/`listAuthorizedContacts`),
      opt-in obligatorio antes de escribir, confirmador derivado del caller
      — ver `.planning/phases/02-modelo-identidad-permisos/02-05-SUMMARY.md`

- [x] `02-06` — `scripts/verify-identity-resolution.ts`, prueba de
      integración completa (18 aserciones) contra Neon real — ver
      `.planning/phases/02-modelo-identidad-permisos/02-06-SUMMARY.md`

- [x] `02-07` — Migraciones 0005-0008 aplicadas a Neon real; `db:verify-rls`
      7/7 (regresión Fase 1) y `db:verify-identity` 16/18. Encontrado un bug
      real de RLS (SEG-12: identidad `unknown` en un scope ya resuelto
      todavía puede leer `team_members`/`authorized_contacts`); un primer
      intento de arreglo (migración 0009) rompió tanto los webhooks de
      Clerk como `resolveIdentity()` mismo — revertido por completo
      (migraciones 0010/0011), el gap queda documentado y abierto para un
      plan futuro en vez de forzarse con una migración no probada — ver
      `.planning/phases/02-modelo-identidad-permisos/02-07-SUMMARY.md`

## Pendiente / próximos pasos

- [ ] SEG-12: cerrar el gap de RLS donde una identidad `unknown` ya
      resuelta puede leer `team_members`/`authorized_contacts` si algún
      código futuro abre un scope `withResolvedIdentityContext` para ella y
      consulta esas tablas — ningún código actual lo hace, pero
      `resolveIdentity()` necesita ese mismo patrón de GUC (solo
      `app.agency_id`) para resolver contactos, así que RLS sola no puede
      distinguir los dos casos; requiere una conexión/rol separado con
      `BYPASSRLS` para la resolución, o una invariante de código revisada
      manualmente — ver la sección de Desviaciones en
      `.planning/phases/02-modelo-identidad-permisos/02-07-SUMMARY.md`

- [ ] Resolver con abogado la estructura corporativa (Kodevon SAS vs. SAS propia
      para Genzia) — consulta ya enviada (`01-05`), respuesta pendiente;
      idealmente antes de someter los pasos entidad-específicos de la
      verificación ante Meta (documentos legales, aplicación al Tech Provider
      Program — ver gate en `META-BUSINESS-VERIFICATION-CHECKLIST.md`)

- [ ] Verificación de negocio ante Meta (Tech Provider) — trámite ya iniciado
      (`01-05`); dar seguimiento a su avance fuera de este repo

- [ ] Confirmar residencia de datos en Colombia (Ley 1581/Habeas Data) contra la
      región elegida de Neon/Vercel/R2

- [ ] La Fase 1 documentó que las sesiones sandboxed no tienen salida de red
      hacia Neon/Clerk; la sesión que corrió `02-07` SÍ tuvo salida de red
      real (confirmado con `psql`) — no asumir el bloqueo, verificar
      directamente en cada sesión antes de tratar un paso como imposible

## Decisiones clave que no deben perderse

- El agente ES la interfaz principal; el dashboard es vista de apoyo, no el modo
  primario de uso.

- Dos números de WhatsApp: uno propio por agencia (de cara al cliente, el que ya
  tienen) + uno compartido de la plataforma (uso interno del equipo).

- Aislamiento de datos entre clientes es una regla dura resuelta por identidad del
  remitente + contexto de conversación, nunca por instrucción/filtro.

- Confirmación de pago automática SOLO vía procesador de pagos real, nunca por
  inferencia de chat.

- Genzia = Tech Provider directo de Meta, sin intermediario (BSP).

- Convención de tres ramas para RLS en toda tabla client-scoped futura
  (Fase 5 CRM, Fase 6 calendario, Fase 7 contenido): admin OR
  miembro-asignado (vía `client_assignments`) OR `client_contact` con
  `id = app.client_id`. Copiar solo dos ramas reintroduce en silencio la
  fuga que esta fase existe para prevenir — ver `0007_client_contact_scope.sql`.

- Todo GUC nuevo tipo uuid debe compararse con
  `NULLIF(current_setting('app.xxx', true), '')::uuid`, nunca `::uuid` a
  secas — una conexión pooled reusada devuelve `''`, no `NULL`, para un GUC
  transaction-local después de su primer uso en ese backend físico, y
  `''::uuid` explota en vez de fallar cerrado (ver `0002` y `0007`).

## Continuidad de sesión

Última sesión: 2026-09-09 — **Fase 2: COMPLETA.** Ejecutadas las 7 waves
(`02-01` a `02-07`) vía subagentes en worktrees paralelos. `02-07` (checkpoint
bloqueante) corrido con acceso real a Neon: migraciones 0005-0008 aplicadas,
`db:verify-rls` 7/7, `db:verify-identity` 16/18. Encontrado un bug real de
RLS (SEG-12, identidad `unknown` puede leer `team_members`/`authorized_contacts`
en un scope ya resuelto); el primer intento de arreglo (migración 0009) rompió
los webhooks de Clerk Y `resolveIdentity()` mismo — revertido por completo
(0010/0011), gap documentado y abierto en vez de forzado. Próximo paso:
`/gsd-verify-work 2` o continuar a Fase 3.
Resume file: .planning/phases/03-integraci-n-con-whatsapp-meta/03-CONTEXT.md

Sesión previa: 2026-09-08 — **Fase 1 completa.** Verificados `01-03` y
`01-04` de punta a punta contra Neon/Clerk/R2 reales desde la máquina local
del usuario, backfillenado sus SUMMARY.md (el código había llegado por una
sesión previa sin generarlos). Encontrados y corregidos 2 bugs reales:
`middleware.ts` excluía `/api/**` del contexto de auth de Clerk, y faltaba
CORS en el bucket R2.
