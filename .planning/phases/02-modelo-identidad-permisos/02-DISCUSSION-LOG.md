# Phase 2: Modelo de identidad y permisos - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-08
**Phase:** 02-modelo-identidad-permisos
**Areas discussed:** Riesgo + bitácora (alcance), Contactos autorizados + opt-in, Contrato de resolución de identidad, Caso límite: número compartido entre 2 clientes

---

## Riesgo + bitácora: alcance ahora vs Fase 4

| Option | Description | Selected |
|--------|-------------|----------|
| Solo catálogo de datos | Modelo de risk_level + esquema audit_log, sin motor/cola/UI | ✓ |
| Motor completo ahora | Clasificación y bitácora funcional aunque no exista agente | |
| Nada ahora, todo a Fase 4 | Ni siquiera el modelo de datos | |

**User's choice:** Solo catálogo de datos (recomendado)
**Notes:** ROADMAP.md lista SEG-10/SEG-11 tanto en Fase 2 como en Fase 4; se resolvió la ambigüedad a favor de dejar el motor/cola/UI en Fase 4, cuando exista el agente.

**Follow-up — ¿cómo se puebla el catálogo sin agente aún?**

| Option | Description | Selected |
|--------|-------------|----------|
| Sembrar con tipos de PROJECT.md | recordatorio de pago = bajo; reagendar cita, contenido nuevo = alto | ✓ |
| Enum vacío | Solo el tipo risk_level, sin tipos de acción concretos | |

**User's choice:** Sembrar con tipos de PROJECT.md

---

## Contactos autorizados + opt-in

**Q1 — Captura de opt-in:**

| Option | Description | Selected |
|--------|-------------|----------|
| Confirmación manual del equipo | Checkbox obligatorio al agregar contacto, se guarda quién/cuándo | ✓ |
| Verificación activa vía WhatsApp | Plantilla de opt-in + espera de confirmación — requiere canal real (Fase 3) | |

**User's choice:** Confirmación manual del equipo (recomendado para v1)

**Q2 — Mensaje reactivo sin opt-in confirmado:**

| Option | Description | Selected |
|--------|-------------|----------|
| Sí, reactivo siempre permitido | Opt-in solo bloquea mensajes proactivos | ✓ |
| No, bloqueado hasta opt-in | Ningún mensaje hasta confirmar opt-in | |

**User's choice:** Sí, reactivo siempre permitido (recomendado)

**Q3 — Campos mínimos del contacto (multiSelect):**

| Option | Description | Selected |
|--------|-------------|----------|
| Nombre + teléfono | Mínimo para SEG-01/02 | ✓ |
| + Email | Identificador alternativo/adicional | ✓ |
| + Rol dentro del cliente | Ej. "dueño", "asistente" | ✓ |

**User's choice:** Los tres — Nombre + teléfono, Email, Rol dentro del cliente

---

## Contrato de resolución de identidad

**Q1 — Resolución de identidad de equipo por WhatsApp:**

| Option | Description | Selected |
|--------|-------------|----------|
| Por whatsapp_number | Búsqueda por (agencyId, whatsappNumber) — ya existe desde Fase 1 | ✓ |
| Solo vía Clerk | No cubre mensajes de WhatsApp simulados/reales sin sesión Clerk | |

**User's choice:** Por whatsapp_number (recomendado)

**Q2 — Cómo probar el criterio de Éxito del ROADMAP:**

| Option | Description | Selected |
|--------|-------------|----------|
| Suite de tests automatizados | Función pura + tests cubriendo los 4 casos | ✓ |
| Tests + página interna de prueba | Lo mismo más una UI de demo — no pedida por el ROADMAP | |

**User's choice:** Suite de tests automatizados (recomendado)

---

## Caso límite: número compartido entre 2 clientes

| Option | Description | Selected |
|--------|-------------|----------|
| Bloquear con error claro | Constraint único + mensaje explícito | ✓ |
| Permitir sin validar | Riesgo de fuga de contexto entre clientes | |

**User's choice:** Bloquear con error claro (recomendado)

---

## Claude's Discretion

- Nombres exactos de tablas/columnas
- Forma exacta del tipo de retorno del resolver de identidad
- Estructura interna de la suite de tests

## Deferred Ideas

- Verificación activa de opt-in vía plantilla de WhatsApp (esperar respuesta afirmativa) — depende de canal real (Fase 3+)
- Reclasificación de riesgo tras un "near-miss" y umbrales de confianza (PITFALLS.md #1) — no es parte de v1, posible backlog v2
