# STATE.md — Genzia

**Última actualización**: 2026-09-07

## Dónde vamos

Etapa de **planeación** completada: `PROJECT.md`, `REQUIREMENTS.md` y
`ROADMAP.md` están definidos. El stack técnico **todavía no se ha definido** — es
la siguiente etapa, separada de esta.

## Completado

- [x] `PROJECT.md` — visión, modelo de negocio, roles, modelo de identidad y
      permisos, integración con Meta, consideraciones legales abiertas
- [x] `config.json` — modo YOLO, profundidad comprehensiva, ejecución paralela
- [x] `research/FEATURES.md` y `research/PITFALLS.md` — investigación de dominio
- [x] `REQUIREMENTS.md` — requisitos v1 con REQ-IDs por categoría, backlog v2/futuro
- [x] `ROADMAP.md` — 12 fases en orden de dependencia

## Pendiente / próximos pasos

- [ ] Definir el **stack técnico** (etapa separada, aún no iniciada)
- [ ] `plan-phase 1` cuando se decida empezar a ejecutar
- [ ] Resolver con abogado la estructura corporativa (Kodevon SAS vs. SAS propia
      para Genzia) — idealmente antes de iniciar la verificación ante Meta
- [ ] Iniciar el trámite de verificación de negocio ante Meta (Tech Provider)

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
