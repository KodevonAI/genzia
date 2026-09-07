# STACK.md — Genzia

Síntesis de `.planning/research/STACK-WEB.md`, `STACK-AGENT.md` y
`STACK-PAYMENTS.md`. Estas son las decisiones de stack para v1 — el detalle
completo y las alternativas descartadas están en cada research doc.

## Aplicación

| Área | Decisión |
|---|---|
| Framework | **Next.js 16** (App Router, TypeScript, React 19) — app full-stack única, no frontend/backend separados |
| Chat en tiempo real | Server-Sent Events vía Vercel AI SDK (`streamText`/`useChat`) — no WebSockets |
| Hosting | Vercel + Neon + Cloudflare R2 + Inngest Cloud + Clerk — 5 servicios gestionados, sin DevOps dedicado |

## Datos y aislamiento multi-tenant (decisión más crítica)

| Área | Decisión |
|---|---|
| Base de datos | **PostgreSQL** en **Neon** (serverless, con branching de BD para tests de aislamiento) |
| ORM | **Drizzle** — SQL-first, mantiene explícito el scoping de tenant en vez de esconderlo en middleware |
| Aislamiento entre clientes (SEG-01 a SEG-09) | **Row-Level Security (RLS)** de Postgres, con clave doble `agency_id` + `client_id`, más columna de `visibility` para la capa visible-cliente / solo-equipo. Se descartó aislamiento solo en capa de aplicación (se rompe con un `WHERE` olvidado) y esquema/BD por tenant (no escala a granularidad por cliente, alto costo operativo) |
| Auth — equipo de agencia | **Clerk Organizations** (org = agencia, roles admin/miembro) |
| Auth — cliente final | Flujo propio ligero de magic-link/OTP, sobre la misma tabla de `authorized_contacts` (fuente única de verdad, sin duplicar identidad) |
| Identidad por WhatsApp | Resuelta como lookup en base de datos (número → equipo/contacto/desconocido), no vía librería de auth |
| Jobs en segundo plano | **Inngest** (detección de cobros vencidos, recordatorios, regeneración de contenido) |

## Agente de IA

| Área | Decisión |
|---|---|
| LLM principal | **Claude Sonnet 5** (Anthropic) — mejor madurez de tool-calling y encaje con el ecosistema de desarrollo (Claude Code) |
| LLM para tareas baratas | **Claude Haiku 4.5** (resúmenes, borradores, enrutamiento de intención) |
| Orquestación | **Hecha a mano sobre el SDK de Anthropic** — explícitamente sin LangGraph/CrewAI/Temporal. Cada mensaje construye `{system, tools, messages}` desde cero, como función auditable, para que el aislamiento por conversación (SEG-05) no dependa de una abstracción de framework |
| Transcripción de voz | **Deepgram Nova-3** (ES/EN), con Whisper como respaldo |
| Comprensión de imágenes | Visión nativa de Claude — suficiente para v1, sin OCR aparte |
| Clasificación de riesgo (SEG-10) | Etiqueta de riesgo **fija en código por herramienta**, no decidida por el LLM |
| Bitácora + aprobaciones (SEG-11) | Patrón de dos tablas: `audit_log` + `approval_queue`, interceptando cada llamada a herramienta — sin motor de workflows ni message broker |

## WhatsApp / Meta

| Área | Decisión |
|---|---|
| Integración | API Cloud de Meta, directo, como Tech Provider — **Embedded Signup v4** (v2 se descontinúa el 15 oct. 2026) |
| Ventana de conversación | Recordatorios (pago, citas) son siempre mensajes proactivos → requieren **plantillas pre-aprobadas de categoría "Utility"** desde el día uno |
| Grupos de WhatsApp | **Fuera de v1** (ver decisión de producto abajo) |

### Decisión de producto derivada de esta investigación: grupos de WhatsApp fuera de v1

La investigación encontró que la API de Grupos de WhatsApp Business es nueva
(2026), solo por invitación, se crea vía API (no se puede "adoptar" un grupo que
la agencia ya tenga con un cliente), tiene tope de 8 participantes, y requiere
estatus de "Official Business Account". Esto contradecía el supuesto original de
que el agente participaría en grupos ya existentes de la agencia. **Decisión: se
saca el soporte de grupos de v1** (actualizado en `PROJECT.md` y
`REQUIREMENTS.md`, WA-06) — v1 es 1:1 únicamente, en WhatsApp y web.

## Pagos y firma electrónica

| Área | Decisión |
|---|---|
| Pagos a clientes (COB-01 a COB-06) | **MercadoPago**, con **Split Payments** (OAuth por agencia) para que el dinero caiga directo en la cuenta de MercadoPago de cada agencia — cubre PSE, Nequi, Daviplata, Efecty y equivalentes en el resto de LatAm hispanohablante |
| Fallback | Stripe, solo para clientes de habla inglesa fuera de la cobertura de MercadoPago |
| Confirmación de pago (COB-04) | Webhook dispara verificación real contra la API de MercadoPago (nunca se confía en el payload directo) + job periódico de reconciliación |
| Pagos recurrentes | API de Preapproval/Subscriptions de MercadoPago (tarjeta); para PSE/Nequi se sigue mandando el link cada mes |
| Facturación futura de Genzia a agencias | La misma API de Preapproval cubriría esto más adelante, sin segundo proveedor de pagos |
| Firma electrónica (CTR-01) | **Documenso** (plan sin límite de usuarios, o auto-hospedado) — evita precios por documento, se incrusta en la UI de Genzia. Válida legalmente en Colombia bajo la Ley 527 de 1999 |
| Bóveda de credenciales (BOV-01) | Cifrado por sobres (envelope encryption), AES-256-GCM a nivel de aplicación con llaves envueltas en KMS gestionado |

## Preguntas abiertas para etapas posteriores

- **Residencia de datos en Colombia** (Ley 1581/Habeas Data): no asumida, pendiente
  de confirmar si Neon/Vercel/R2 en la región elegida cumplen, o si se necesita
  una región específica.
- **Estructura corporativa** (Kodevon SAS vs. SAS propia de Genzia): sigue
  pendiente de asesoría legal, según quedó anotado en `PROJECT.md`.

## Documentos de research

- `.planning/research/STACK-WEB.md` — framework, base de datos, aislamiento, auth, hosting
- `.planning/research/STACK-AGENT.md` — LLM, orquestación, voz/imagen, WhatsApp Cloud API
- `.planning/research/STACK-PAYMENTS.md` — pagos, firma electrónica, cifrado
