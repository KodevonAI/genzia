# Phase 3: Integración con WhatsApp/Meta - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-09-09
**Phase:** 03-integracion-con-whatsapp-meta
**Areas discussed:** Alcance entra/sale, Secuenciación Meta, Persistencia de mensajes, Alcance de medios

---

## Alcance entra/sale

| Option | Description | Selected |
|--------|-------------|----------|
| Solo inbound + ack mínimo | Webhook recibe, resuelve identidad, guarda/loguea; el "sale" es un ack técnico mínimo, sin generación de respuesta real | |
| Inbound + eco de prueba | Responde algo fijo probando el pipeline de envío real por la API de Meta, sin lógica de agente | ✓ |
| Inbound + respuesta real básica | Ya integra una respuesta generada por LLM simple, adelantando trabajo de Fase 4 | |

**User's choice:** "Solo inbound + ack mínimo (recomendado)", refinado en la pregunta de seguimiento a: sí, el ack debe ser un mensaje real enviado de vuelta por la API de Meta (no solo un 200 OK al webhook).

**Follow-up question:** ¿El "ack mínimo" implica probar el envío real de un mensaje de vuelta por la API de Meta, o esta fase se queda solo en el lado inbound?

| Option | Description | Selected |
|--------|-------------|----------|
| Sí, envía un mensaje real de vuelta | Manda un mensaje fijo por la API de envío de Meta — prueba el pipeline completo (inbound Y outbound) | ✓ |
| No, solo inbound | Se limita a recibir, resolver identidad y responder 200 al webhook | |

**Notes:** El envío real (aunque trivial) se prioriza para descubrir ahora problemas de permisos/formato/rate limits, no en Fase 4.

---

## Secuenciación Meta

| Option | Description | Selected |
|--------|-------------|----------|
| Número de prueba de Meta ya | Arranca ya con el test WABA gratuito de Meta, sin esperar verificación de negocio | ✓ |
| Esperar WABA real de agencia piloto | No se construye nada hasta tener una agencia real conectada vía Embedded Signup | |

**User's choice:** Número de prueba de Meta ya.

**Follow-up question:** ¿Esta fase ya construye el flujo Embedded Signup completo (UI de onboarding), o solo el lado de la plataforma probado con el número de prueba fijo?

| Option | Description | Selected |
|--------|-------------|----------|
| Solo plataforma, sin UI de Signup aún | Prueba webhook + identidad + envío contra el número de prueba fijo, sin UI de conexión por agencia | ✓ |
| Construir Embedded Signup ya | UI completa de Embedded Signup ahora, aunque solo se pueda probar en modo test | |

**Notes:** Embedded Signup real (WA-02) se construye cuando Meta apruebe la verificación de negocio — evita construir una UI no probable de punta a punta todavía.

---

## Persistencia de mensajes

| Option | Description | Selected |
|--------|-------------|----------|
| Sí, tabla mínima ya | Tabla básica (mensaje, dirección, remitente, timestamp, canal) para no perder mensajes de prueba | ✓ |
| No, sin persistencia aún | Pura tubería sin guardar nada; Fase 4 diseña la tabla completa desde cero | |

**User's choice:** Sí, tabla mínima ya.

**Follow-up question:** ¿Esta tabla mínima ES `audit_log` (Fase 2, primer escritor real), o es una tabla nueva separada?

| Option | Description | Selected |
|--------|-------------|----------|
| Tabla nueva separada | `audit_log` es para acciones/decisiones del agente — mezclar mensajes crudos contaminaría su propósito | ✓ |
| Usar audit_log ya | Reusa audit_log como primer registro de mensajes | |

**Notes:** Evita contaminar el propósito documentado de `audit_log` en `02-02-SUMMARY.md` (append-only, sin lógica de negocio).

---

## Alcance de medios

| Option | Description | Selected |
|--------|-------------|----------|
| Solo texto por ahora | Maneja solo texto; audio/imagen se detecta y guarda referencia (media_id) sin descargar/interpretar | ✓ |
| Descargar ya, interpretar después | Descarga el archivo a R2 pero no transcribe/interpreta aún | |
| Interpretación completa ya | Integra Deepgram y Claude vision de punta a punta ya | |

**User's choice:** Solo texto por ahora.

**Notes:** Descarga e interpretación (Deepgram, Claude vision) se implementan en Fase 4, cuando el agente conversacional exista para consumirlas.

---

## Claude's Discretion

- Nombre y estructura exacta de columnas de la tabla de mensajes
- Mecanismo técnico de procesamiento asíncrono del webhook (Inngest)
- Manejo de errores del webhook (reintentos, timeouts, payloads malformados)
- Enfoque de testing dado el requisito de credenciales reales de Meta

## Deferred Ideas

- UI de Embedded Signup real → cuando Meta apruebe verificación de negocio
- Interpretación de audio/imagen (Deepgram, Claude vision) → Fase 4
- Generación de respuesta real del agente → Fase 4
- Tabla completa de historial de conversación/bitácora visible → Fase 4

Ninguna surgió como scope creep — son límites de fase ya implícitos en ROADMAP.md, hechos explícitos para evitar confusión en planning.
