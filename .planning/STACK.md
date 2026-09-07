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

### Costo de hosting a escala (250 → 10,000 usuarios en 1 año)

Verificado en `research/STACK-VERIFY.md` contra precios actuales de cada proveedor.
Supuesto: "usuarios" = cuentas individuales totales (equipo de agencia + contactos
de clientes) → 250 usuarios ≈ 25 agencias; 10,000 usuarios ≈ 500-1,000 agencias.

| | A 250 usuarios | A 10,000 usuarios |
|---|---|---|
| Vercel | ~$40-60/mes (Pro) | ~$500-1,500/mes (Pro, uso) |
| Neon (Postgres) | ~$20-40/mes | ~$200-450/mes (plan Scale) |
| Clerk | **$0/mes** | **$0/mes** (solo autentica equipo de agencia, no clientes finales — se mantiene muy por debajo del tier gratuito de 50,000 usuarios activos mensuales en ambos escenarios) |
| Inngest | $0-75/mes | ~$75-300/mes (Pro) |
| Cloudflare R2 | ~$0-5/mes | ~$20-100/mes |
| **Total infra** | **~$60-180/mes** | **~$795-2,350/mes** |

**Punto más importante: no hace falta re-arquitecturar nada entre 250 y 10,000
usuarios.** Los cinco servicios cobran 100% por consumo, no por escalones de
arquitectura — pasar de 250 a 10,000 usuarios es un aumento de factura, no una
reconstrucción del sistema. Esta es precisamente la razón por la que se eligió
esta combinación de servicios gestionados en vez de infraestructura propia.

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
| Acceso al LLM | **Vía OpenRouter**, no directo a Anthropic — para poder variar/cambiar de modelo sin quedar atado a un proveedor. Se usa el endpoint de OpenRouter **compatible-nativo con la API de Anthropic** (no el compatible-OpenAI, que rompe silenciosamente el prompt caching de Claude) — con esto, todo el diseño de orquestación de abajo se mantiene igual, solo cambia a dónde apunta la conexión |
| LLM principal | **Claude Sonnet 5** (vía OpenRouter) — mejor madurez de tool-calling; OpenRouter no cambia esta recomendación porque el problema real es confiabilidad en el uso de herramientas, no precio (OpenRouter pasa el precio de lista del proveedor, con ~5% de comisión al recargar crédito, no un markup por token) |
| LLM para tareas baratas | **Claude Haiku 4.5** (vía OpenRouter) — resúmenes, borradores, enrutamiento de intención |
| Modelo configurable | El modelo NO queda fijo en el código: se resuelve desde un mapa `MODEL_FOR_TASK` (`{principal, barato}`) — ahí es donde se aprovecha la flexibilidad de OpenRouter para experimentar o cambiar de modelo más adelante sin migrar de SDK |
| Resiliencia | OpenRouter no tiene SLA de disponibilidad. Se programa un respaldo directo a Anthropic (mismo formato de API, cambia solo `baseURL`/llave) que se activa si OpenRouter falla de forma sostenida |
| Orquestación | **Hecha a mano sobre el formato de la API de Anthropic** (ahora servido a través de OpenRouter) — explícitamente sin LangGraph/CrewAI/Temporal. Cada mensaje construye `{system, tools, messages}` desde cero, como función auditable, para que el aislamiento por conversación (SEG-05) no dependa de una abstracción de framework |
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
| Firma electrónica (CTR-01) | **Documenso**, plan Platform en la nube: **US$250/mes (facturado anual, US$3,000/año)**, usuarios y documentos ilimitados, sin cobro por documento, incluye acceso a API y widget de firma incrustable/white-label en la UI de Genzia. Válida legalmente en Colombia bajo la Ley 527 de 1999 |
| Bóveda de credenciales (BOV-01) | Cifrado por sobres (envelope encryption), AES-256-GCM a nivel de aplicación con llaves envueltas en KMS gestionado |

### ¿Por qué no auto-hospedar Documenso gratis?

Investigación inicial asumía que auto-hospedar Documenso era una alternativa
gratis al plan de $250/mes. **Corrección tras verificar** (`research/STACK-VERIFY.md`):
el código es de licencia AGPL-3.0 (gratis de correr), pero incrustar su flujo de
firma dentro de un producto comercial de código cerrado como Genzia activa la
obligación de copyleft de red de la AGPL — según los propios términos comerciales
de Documenso, eso exige o el plan Platform en la nube ($250/mes) o una **licencia
Enterprise auto-hospedada que arranca en US$30,000/año** (~10 veces más caro). El
plan Platform en la nube **es la opción más barata legítima**, no una alternativa
de presupuesto frente a un self-host gratuito real.

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
- `.planning/research/STACK-VERIFY.md` — verificación de precios de Documenso y costos de hosting a escala (250 → 10,000 usuarios)
- `.planning/research/STACK-OPENROUTER.md` — por qué y cómo usar OpenRouter en vez de conectar directo a Anthropic
