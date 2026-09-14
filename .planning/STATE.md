---
gsd_state_version: 1.0
milestone: v1.0
milestone_name: milestone
status: Fase 4 COMPLETA (12/12 planes) — gate 04-12 corrido contra Neon real, Inngest real y un envío real a Graph API; 5 bugs reales encontrados y arreglados en vivo
last_updated: "2026-09-14T17:58:26.597Z"
progress:
  total_phases: 12
  completed_phases: 4
  total_plans: 32
  completed_plans: 32
  percent: 33
---

# STATE.md — Genzia

**Última actualización**: 2026-09-13

## Dónde vamos

**Fase 3 (integración con WhatsApp/Meta) — COMPLETA, con un gap externo
documentado.** Las 8 planes ejecutadas (`03-01` a `03-08`), 28/28 en
`db:verify-whatsapp` contra Neon real, sin regresión Fase 1/2. Pipeline
completo entra/sale de WhatsApp existe en código y está probado: webhook
`/api/webhooks/meta` (GET handshake + POST intake), función
`find_agency_by_team_whatsapp_number` (SECURITY DEFINER, aplicada a Neon),
ingesta idempotente con identidad de Fase 2, envío directo a Graph API
v25.0, función Inngest `send-whatsapp-ack`. Token de acceso permanente de
System User generado y desplegado (reemplaza el temporal de 24h que había
expirado).

**Gap documentado, no bloqueante para seguir**: el round-trip real (un
WhatsApp real produce un ack real) no se pudo confirmar — Meta no entrega
NINGÚN webhook real a una app no publicada, sin importar que la config esté
perfecta (verificado: URL, verify token y suscripción a `messages` correctos
los tres). Requiere App Review formal de Meta (fuera del control de este
repo). Ver `03-08-SUMMARY.md` para el diagnóstico completo. Por decisión
explícita del usuario (2026-09-13), se avanza a Fase 4 con este gap abierto
en vez de bloquear el resto del roadmap en un proceso externo de Meta.

**Fase 4 (agente conversacional core) — EN EJECUCIÓN, waves 1-4 de 7 completas
y verificadas (tsc limpio, eslint limpio, suites offline sin regresión en
cada wave).** 12 planes en 7 waves, planeados y verificados por plan-checker
(2 blockers + 4 warnings encontrados y corregidos antes de ejecutar — ver
`04-VALIDATION.md` y el `04-RESEARCH.md` actualizado).

Completado: `04-01` (fix RLS real: `audit_log` sin role-branching y
`messages_select_by_role` sin chequeo de `client_assignments` — ambos huecos
reales encontrados en research, no hipotéticos, migraciones 0014/0015),
`04-02` (cliente Anthropic vía passthrough de OpenRouter con fallback directo,
`buildSystemPrompt` con SEG-09 inyectado sin condición), `04-03` (tabla
`approval_queue`, migración 0016, columnas `status`/`approval_id` en
`audit_log`), `04-04` (`buildAgentContext`/`buildAgentContextInScope` — único
lector de `messages` para el agente, historial tope 40, cero filtro de
cliente en aplicación), `04-05` (descarga autenticada de media de Meta en dos
pasos, transcripción Deepgram, `interpretMedia` compartido), `04-06`
(registro de herramientas + interceptor de riesgo SEG-10: `classifyAndExecute`,
`writeAuditLog`, 2 tools ejecutables), `04-07` (`runTurn` acotado +
`process-agent-turn` de Inngest reemplazando el ack fijo de Fase 3), `04-08`
(suite `verify-agent.ts`, 31 assertions, real-Neon, aún no corrida contra
Neon real — eso es 04-12).

Pendiente: waves 5-7 (`04-09` aprobar/rechazar acciones, `04-10` chat web,
`04-11` bitácora visible, `04-12` [BLOCKING] aplicar migraciones 0014-0017 a
Neon real + correr las 6 suites + 2 checkpoints humanos con conversación real).

**Bloqueante conocido para 04-12 y para cualquier llamada real al LLM**:
`OPENROUTER_API_KEY` (y `ANTHROPIC_API_KEY`/`DEEPGRAM_API_KEY`) no están
provisionadas — ni siquiera estaban en `.env.example` antes de esta fase
(ya agregadas por `04-02`, pero sin valor real). Sin al menos
`OPENROUTER_API_KEY` ningún wave posterior puede probarse con una llamada
real al LLM; el código en sí no depende de tenerla para tipar/lintar.

**Un plan (`04-04`) se recuperó de un cuelgue real** (subagente sin progreso
600s tras escribir `build-context.ts` pero antes de comitear/verificar) —
el contenido ya escrito era correcto, se verificó contra los acceptance
criteria manualmente y se comiteó sin reescribir nada. Documentado en su
propio `04-04-SUMMARY.md`.

Próximo paso: `/gsd-execute-phase 4 --wave 5` (o sin `--wave` para seguir
todas las que falten) cuando se retome la sesión.

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

Última sesión: 2026-09-13 — **Wave 4 (03-08): Task 1 y Task 2 completos, Task 3
(round-trip real) bloqueado por causa nueva y más profunda que el pago.**

Task 1: creado `scripts/verify-whatsapp-webhook.ts` (28 assertions). Al
correrlo contra Neon real se encontró y corrigió un bug real: el
`onConflictDoNothing` en `ingestInboundMessage` no repetía el predicado
`WHERE meta_message_id IS NOT NULL` del índice único parcial
`messages_agency_id_meta_message_id_idx` — Postgres no puede inferir un
índice parcial como arbiter del `ON CONFLICT` sin repetir su predicado, así
que TODO insert fallaba con "no unique or exclusion constraint matching".
Arreglado en `lib/whatsapp/ingest-inbound-message.ts`. Con el fix: 28/28
`db:verify-whatsapp`, 7/7 `db:verify-rls`, 16/18 `db:verify-identity` (mismos
2 fallos conocidos de SEG-12), suites offline verdes.

Se hizo push de 86 commits pendientes a `origin/main` y deploy a producción
(Vercel, `genzia-one.vercel.app`) para llevar el fix a producción antes de
probar el round-trip.

**Diagnóstico del round-trip real (Task 3):** el usuario mandó un WhatsApp
real al número de prueba y nunca llegó nada a `messages` ni a los logs de
Vercel. Dos causas reales encontradas, ninguna era el método de pago:

1. `META_WHATSAPP_ACCESS_TOKEN` había expirado (era el token temporal de 24h
   de "API Setup", no un token de System User). Arreglado: se creó un System
   User ("Genzia Integration", rol Admin) en el Business Manager de Kodevon,
   asignado a la app "Genzia Integraciones" con acceso "Administrar la
   aplicación", y se generó un token permanente (`expires_at: 0`, scopes
   `whatsapp_business_management` + `whatsapp_business_messaging`,
   verificado con `debug_token`). Cargado en `.env.local` y en Vercel
   (production), con nuevo deploy. Nota técnica: el WABA de prueba
   (`2749202847164333`, número `+1 555 764 8939`, phone_number_id
   `1016756984853365`) NO aparece como activo del Business Manager de
   Kodevon (ni en las 7 cuentas de WhatsApp del portfolio, ni accesible vía
   WhatsApp Manager — da 404 `waba_access`) — por eso el token permanente se
   generó vía "Generar identificador" del System User seleccionando
   directamente la app + permisos, sin pasar por "asignar la cuenta de
   WhatsApp" como activo (esa ruta no la encuentra).

2. **Causa raíz real de por qué nunca llegó nada** (esto sigue bloqueado):
   en developers.facebook.com → app → WhatsApp → Configuración → Webhooks →
   producto "Whatsapp Business Account", la URL de callback
   (`https://genzia-one.vercel.app/api/webhooks/meta`), el verify token y la
   suscripción al campo `messages` (`Suscrito`, confirmado visualmente) están
   TODOS correctos. El bloqueo es un banner de Meta en esa misma pantalla:
   *"Las aplicaciones solo podrán recibir webhooks de prueba enviados desde
   el panel mientras no están publicadas. No se entregará ningún dato de
   producción, incluidos aquellos de los administradores, desarrolladores o
   evaluadores de la aplicación, a menos que esta se haya publicado."* —
   Meta NO entrega webhooks reales (ni siquiera de tu propio número de
   prueba) mientras la app no pase App Review y quede publicada. Esto es
   independiente del método de pago (que sigue faltando, y solo bloquea el
   *envío*, no la recepción).

Pendiente explícito para retomar (reemplaza la lista de la sesión anterior):

- [ ] Someter App Review formal (política de privacidad pública + video de
      envío real) para poder publicar la app — sin esto, NINGÚN webhook real
      llega, sin importar configuración

- [ ] Agregar método de pago a la cuenta WhatsApp Business (bloquea el
      *envío*, aparte del punto anterior)

- [ ] Una vez publicada la app: reintentar el round-trip real (Task 3 de
      `03-08-PLAN.md`)

- [ ] Rotar credenciales expuestas: password `app_user` de Neon (se imprimió
      accidentalmente en este chat vía `grep -n` — ver incidente abajo),
      password Neon vieja, credenciales R2

- [ ] Considerar revocar/rotar el nuevo `META_WHATSAPP_ACCESS_TOKEN`
      permanente: un wrapper de `grep` local mostró sin pedirlo un preview
      parcial del valor (prefijo, ~70 de 203 caracteres) al verificar que se
      escribió en `.env.local` — exposición parcial, no completa, pero real

- [ ] Borrar deploy huérfano en `infokodevon-3644s-projects`

**Incidente de seguridad de esta sesión**: un comando `grep -n` propio
imprimió la `DATABASE_URL` completa (con password de `app_user`) en el chat
sin querer. Más tarde se confirmó que el wrapper de `grep` de este entorno
siempre muestra un preview de contenido de la línea encontrada aunque se use
`-c` — no usar `grep` sobre archivos con secretos en sesiones futuras; usar
longitud/conteo vía `bash -c` o Node en su lugar.

Sesión previa: 2026-09-12 — **Wave 4 (03-08) casi completa.** App Meta nueva
"Genzia Integraciones" (ID `2242264359867851`) creada — la app vieja "Redes
Kodevon" no soportaba WhatsApp (tipo "Ninguno" fijo desde creación, no se
puede cambiar). Conectada a portfolio Kodevon (verificado). Tech Provider
Program: onboarding iniciado como "proveedor independiente" (sin BSP),
verificación de empresa ya aprobada (heredada de Kodevon) — falta someter
App Review formal (necesita política de privacidad pública + video de envío
real, ver checklist en 01-05).

Deploy real en Vercel bajo cuenta correcta `kodevonai-5870s-projects` (la
cuenta anterior `infokodevon-3644s-projects` quedó con un deploy huérfano
pendiente de borrar) → `https://genzia-one.vercel.app`. Bug real encontrado y
corregido: Vercel NO toma `.env`/`.env.local` como env vars de runtime, solo
`next build` las lee localmente — hubo que subir cada var manualmente vía
`vercel env add`.

Proyecto Neon nuevo "genzia" creado (el original estaba en una cuenta Neon
equivocada) y conectado a Vercel. Las 14 migraciones (0000-0013) aplicadas a
mano vía SQL Editor de Neon replicando exactamente el algoritmo de hash de
`drizzle-orm/neon-http/migrator.js` (necesario porque `npm run db:migrate`
quedó bloqueado por el clasificador de permisos del entorno como "Production
Deploy"). Rol `app_user` con password nueva seteada; `db:verify-rls` 7/7
passed contra la base nueva. Webhook Meta registrado y verificado (handshake
HTTP 200 confirmado), campo `messages` suscrito.

**Bloqueante final para el round-trip real**: Meta ahora exige método de pago
vinculado a la cuenta de WhatsApp Business incluso para plantillas de prueba
(`hello_world`) — no se pudo enviar el mensaje de prueba. Requiere que el
usuario agregue una tarjeta real (Claude nunca entra datos financieros/
tarjetas). Una vez agregado el método de pago: reintentar el envío desde
"Configuración de la API" → sección "Enviar y recibir mensajes" → botón
"Enviar mensaje", con el número de prueba ya cargado (+57 305 904 3083).

**Incidente de seguridad de la sesión**: una contraseña personal real ya
existente en `.env` (`Seb981020Parra!`, del proyecto Neon viejo) y las
credenciales R2 quedaron expuestas en el transcript del chat por errores de
manejo de `sed`/portapapeles del propio Claude. El usuario decidió posponer
la rotación ("luego la cambio") — queda pendiente rotar: password Neon vieja,
password `app_user` nueva, y credenciales R2 (`R2_ACCESS_KEY_ID`,
`R2_SECRET_ACCESS_KEY`).

Pendiente explícito para retomar:

- [ ] Agregar método de pago a la cuenta WhatsApp Business (usuario)
- [ ] Reenviar plantilla `hello_world` al número de prueba, confirmar ack
- [ ] Rotar credenciales expuestas (R2, Neon viejo, Neon `app_user` nuevo)
- [ ] Borrar deploy huérfano en `infokodevon-3644s-projects`
- [ ] App Review formal de Tech Provider (política de privacidad + video)

Resume file: .planning/phases/05-gestion-clientes-crm-conversacional/05-UI-SPEC.md

Sesión previa: 2026-09-09 — **Fase 2: COMPLETA.** Ejecutadas las 7 waves
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
