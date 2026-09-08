# STATE.md — Genzia

**Última actualización**: 2026-09-08

## Dónde vamos

Fase 1 (fundaciones de cuenta y equipo) en ejecución. **Wave 1 completa**:
`01-01` (Next.js 16 + schema Drizzle + RLS de Postgres) y `01-05` (tracks
externos no-código: verificación de negocio ante Meta y consulta legal de
estructura corporativa). Con `01-01` cerrado, Wave 2 (`01-02` — webhook de
Clerk y aprovisionamiento de agencia) queda desbloqueada.

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

## Pendiente / próximos pasos

- [ ] `01-02` (Wave 2, desbloqueada) — webhook de Clerk y aprovisionamiento
      de agencia, sobre el esquema y `withTenantContext` de `01-01`
- [ ] Resolver con abogado la estructura corporativa (Kodevon SAS vs. SAS propia
      para Genzia) — consulta ya enviada (`01-05`), respuesta pendiente;
      idealmente antes de someter los pasos entidad-específicos de la
      verificación ante Meta (documentos legales, aplicación al Tech Provider
      Program — ver gate en `META-BUSINESS-VERIFICATION-CHECKLIST.md`)
- [ ] Verificación de negocio ante Meta (Tech Provider) — trámite ya iniciado
      (`01-05`); dar seguimiento a su avance fuera de este repo
- [ ] Confirmar residencia de datos en Colombia (Ley 1581/Habeas Data) contra la
      región elegida de Neon/Vercel/R2
- [ ] Esta sesión sandboxed no tiene salida de red hacia Neon ni Clerk (ver
      `01-01`-SUMMARY, sección "Authentication / Environment Gates") — cualquier
      plan futuro ejecutado en una sesión de este mismo tipo debe esperar el
      mismo bloqueo para pasos que toquen la base de datos real o la API de
      Clerk en vivo, y verificar localmente o en CI en su lugar

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

## Continuidad de sesión

Última sesión: 2026-09-08 — Completado `01-fundaciones-cuenta-equipo-01-PLAN.md`
(Next.js 16 + esquema Drizzle + RLS de Postgres forzada, probada 7/7 contra
Neon real; ver `01-fundaciones-cuenta-equipo-01-SUMMARY.md` para los dos
checkpoints atravesados — credenciales Neon/Clerk, y el bloqueo de red de
esta sesión sandboxed hacia Neon/Clerk, resuelto verificando desde la máquina
local del usuario). Wave 1 de Fase 1 completa (`01-01` + `01-05`).
Resume file: ninguno.
