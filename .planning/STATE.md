# STATE.md — Genzia

**Última actualización**: 2026-09-07

## Dónde vamos

Etapa de **planeación funcional Y stack técnico** completadas: `PROJECT.md`,
`REQUIREMENTS.md`, `ROADMAP.md` y `STACK.md` están definidos. Listo para pasar a
`plan-phase 1` cuando se decida empezar a ejecutar.

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

## Pendiente / próximos pasos

- [ ] `plan-phase 1` cuando se decida empezar a ejecutar
- [ ] Resolver con abogado la estructura corporativa (Kodevon SAS vs. SAS propia
      para Genzia) — idealmente antes de iniciar la verificación ante Meta
- [ ] Iniciar el trámite de verificación de negocio ante Meta (Tech Provider)
- [ ] Confirmar residencia de datos en Colombia (Ley 1581/Habeas Data) contra la
      región elegida de Neon/Vercel/R2

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
