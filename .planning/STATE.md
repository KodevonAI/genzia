# STATE.md — Genzia

**Última actualización**: 2026-09-08

## Dónde vamos

Fase 1 (fundaciones de cuenta y equipo) en ejecución. **Wave 1 y Wave 2
completas**: `01-01` (Next.js 16 + schema Drizzle + RLS de Postgres), `01-05`
(tracks externos no-código) y `01-02` (webhook de Clerk + signup/onboarding +
dashboard). Con `01-02` cerrado, Wave 3 queda desbloqueada: `01-03` (marca del
agente, CTA-02) y `01-04` (equipo, CTA-04/05/06) — ambos en paralelo, ambos
`depends_on: ["01", "02"]`.

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

## Pendiente / próximos pasos

- [ ] `01-03` y `01-04` (Wave 3, desbloqueadas, en paralelo) — marca del
      agente (CTA-02) y equipo/roles/asignación de clientes (CTA-04/05/06),
      ambos sobre el dashboard shell de `01-02`. Nota para `01-04`: debe
      confirmar que su manejo de `organizationMembership.created` también
      aprovisiona el `team_members` del admin-fundador (no solo miembros
      invitados) — ver "Next Phase Readiness" de `01-02`-SUMMARY.
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

Última sesión: 2026-09-08 — Completado `01-fundaciones-cuenta-equipo-02-PLAN.md`
(webhook de Clerk + signup/onboarding + dashboard shell; ver
`01-fundaciones-cuenta-equipo-02-SUMMARY.md` para el checkpoint atravesado —
mismo bloqueo de red de esta sesión sandboxed hacia Neon/Clerk documentado en
`01-01`, resuelto verificando de punta a punta desde la máquina local del
usuario, que encontró y corrigió un bug real de RLS en las escrituras del
webhook). Wave 1 y Wave 2 de Fase 1 completas (`01-01` + `01-05` + `01-02`).
Resume file: ninguno.
