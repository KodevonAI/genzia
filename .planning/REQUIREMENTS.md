# REQUIREMENTS.md — Genzia

Deriva de `.planning/PROJECT.md` y de `.planning/research/{FEATURES,PITFALLS}.md`.
Cada requisito tiene un REQ-ID estable para referenciar desde `ROADMAP.md` y los
planes de ejecución futuros. No define stack técnico — solo comportamiento.

## SEG — Identidad, permisos y cumplimiento (crítico, transversal)

| ID | Requisito |
|---|---|
| SEG-01 | Cada mensaje entrante se resuelve a una identidad antes de generar respuesta: miembro de equipo (con rol), contacto autorizado de un cliente, o número desconocido. |
| SEG-02 | Un número de teléfono está vinculado a un único cliente. Un cliente puede tener varios contactos autorizados. |
| SEG-03 | Solo el equipo de la agencia agrega/quita contactos autorizados de la ficha de un cliente — el cliente nunca se autoriza a sí mismo. |
| SEG-04 | Al agregar un contacto autorizado, el sistema exige confirmar consentimiento explícito de WhatsApp (opt-in) antes de habilitar mensajes proactivos del agente hacia ese contacto. |
| SEG-05 | El contexto de una conversación (1:1 equipo, 1:1 cliente) determina el alcance de datos que el agente puede usar — nunca por instrucción/filtro, sino porque el sistema no carga datos fuera de ese alcance. |
| SEG-06 | Un chat 1:1 con un miembro de equipo respeta su rol: admin ve todos los clientes, miembro solo los asignados. |
| SEG-07 | Un chat 1:1 con un contacto de cliente limita al agente a los datos de ese único cliente. |
| SEG-08 | La ficha de cada cliente separa datos "visibles para el cliente" de datos "solo equipo" (notas internas, rentabilidad, riesgos); el agente nunca cruza esa frontera hacia el cliente. |
| SEG-09 | Si un contacto pregunta directamente si el agente es una IA/bot, el agente siempre lo admite — nunca sostiene el personaje para negar o evadir. |
| SEG-10 | Cada acción del agente se clasifica por riesgo: bajo riesgo se auto-ejecuta; alto riesgo requiere aprobación humana antes de llegar al cliente. |
| SEG-11 | Toda acción y mensaje del agente queda registrado en una bitácora completa y visible para el equipo. |
| SEG-12 | Un número no registrado (ni equipo ni contacto autorizado) recibe una respuesta orientada a conversión a cliente/prospecto, sin acceso a ningún dato de cuenta. |

## WA — Integración con WhatsApp / Meta

| ID | Requisito |
|---|---|
| WA-01 | Genzia opera como Tech Provider oficial de Meta — sin BSP intermediario (Twilio, 360dialog, etc.). |
| WA-02 | Cada agencia conecta el número de WhatsApp Business que ya tiene (no uno nuevo) vía el flujo Embedded Signup de Meta, incrustado dentro de la app de Genzia. |
| WA-03 | Existe un número único de la plataforma, compartido entre todas las agencias, dedicado a las conversaciones internas del equipo (no requiere verificación propia por agencia). |
| WA-04 | El sistema identifica a qué agencia pertenece cada miembro de equipo por su registro, no por el número al que escribe. |
| WA-05 | El agente entiende texto, notas de voz e imágenes, en WhatsApp y en el chat web. |
| WA-06 | El agente funciona en conversaciones 1:1 (WhatsApp y web). Grupos de WhatsApp quedan fuera de v1 (ver v2/Futuro) — la API de grupos de Meta es invite-only, con tope de 8 participantes y requiere Official Business Account. |
| WA-07 | El costo de conversación que Meta cobra al Tech Provider se traslada a la agencia como cargo aparte y transparente (no oculto en la suscripción). |

## CTA — Cuenta de agencia y equipo (multi-tenant)

| ID | Requisito |
|---|---|
| CTA-01 | Registro self-serve de una agencia nueva, con período de prueba gratis. |
| CTA-02 | La agencia configura la marca del agente de cara a sus clientes: nombre, tono, logo. |
| CTA-03 | La plataforma es multiidioma (español/inglés) desde v1. |
| CTA-04 | El admin invita miembros del equipo con rol y número de WhatsApp (capturado en la invitación). |
| CTA-05 | Roles de equipo: admin (todo) y miembro (solo clientes asignados). |
| CTA-06 | El admin asigna clientes a miembros del equipo. |

## CLI — Gestión de clientes (CRM conversacional)

| ID | Requisito |
|---|---|
| CLI-01 | Alta de cliente nuevo por formulario o dictado en lenguaje natural al agente. |
| CLI-02 | Consulta de ficha de cliente: resumen de historial, pagos, próximas citas. |
| CLI-03 | Edición de datos de un cliente. |
| CLI-04 | Búsqueda de cliente por nombre o tema. |
| CLI-05 | Ficha de cliente con capas visible-cliente / solo-equipo (ver SEG-08). |

## CAL — Calendario y agenda

| ID | Requisito |
|---|---|
| CAL-01 | Agendar, reagendar y cancelar citas de grabación (fecha, hora, lugar, asistentes) por lenguaje natural o desde la vista visual. |
| CAL-02 | Calendario de contenido por cliente: fechas propuestas de publicación (solo planeación, sin auto-publicar). |
| CAL-03 | Recordatorios automáticos de citas próximas, al equipo y al cliente. |
| CAL-04 | Vista de calendario visual (mensual/semanal) como apoyo al modo conversacional. |
| CAL-05 | El agente responde preguntas de agenda ("¿qué tengo esta semana?"). |

## CON — Contenido

| ID | Requisito |
|---|---|
| CON-01 | El agente redacta/propone piezas de contenido por cliente. |
| CON-02 | La propuesta se envía al cliente para aprobación (portal, WhatsApp, o email). |
| CON-03 | Ante feedback del cliente, el agente regenera la propuesta automáticamente (riesgo alto → puede requerir aprobación humana antes de reenviar, según SEG-10). |
| CON-04 | El contenido aprobado queda marcado como listo (la publicación en sí sigue siendo manual, fuera del sistema). |

## COB — Cobros a clientes

| ID | Requisito |
|---|---|
| COB-01 | Registrar plan de pago de un cliente: recurrente (mensualidad) o puntual (por proyecto/entrega). |
| COB-02 | Detectar pagos próximos a vencer o vencidos. |
| COB-03 | Enviar recordatorio de pago con link de pago integrado. |
| COB-04 | Marcar como pagado automáticamente SOLO con confirmación real del procesador de pagos — nunca por inferencia de mensajes de chat. |
| COB-05 | El equipo de la agencia puede marcar un pago como recibido manualmente (pago fuera del sistema). |
| COB-06 | Consultar estado de cuenta general ("¿quién me debe?"). |

## PAG — Pagos que la agencia hace a terceros

| ID | Requisito |
|---|---|
| PAG-01 | Registrar pagos que la agencia hace a freelancers, proveedores o pauta publicitaria. |

## CTR — Contratos

| ID | Requisito |
|---|---|
| CTR-01 | Enviar un contrato a un cliente para firma electrónica dentro de la plataforma. |
| CTR-02 | Alertas de vencimiento/renovación de contrato por cliente. |

## VEN — Ventas / prospectos

| ID | Requisito |
|---|---|
| VEN-01 | Pipeline de prospectos (clientes potenciales, antes de ser clientes activos). |
| VEN-02 | El agente ayuda a generar propuestas/cotizaciones para prospectos. |

## COL — Colaboradores externos

| ID | Requisito |
|---|---|
| COL-01 | Directorio de colaboradores externos (influencers/freelancers) con datos de contacto y acuerdos, sin manejar sus pagos ahí (ver PAG-01 para el registro del pago en sí). |

## BOV — Bóveda de credenciales

| ID | Requisito |
|---|---|
| BOV-01 | Guardar de forma segura accesos del cliente (redes sociales, Ads, Analytics, dominio, etc.), visibles solo para el equipo. |

## TAR — Tareas internas y rentabilidad

| ID | Requisito |
|---|---|
| TAR-01 | Tablero de tareas internas ligado al cliente/calendario, con asignación por miembro. |
| TAR-02 | Vista de rentabilidad por cliente. |

## POR — Portal del cliente final

| ID | Requisito |
|---|---|
| POR-01 | Login propio del cliente final. |
| POR-02 | Ver su calendario y estado de pago. |
| POR-03 | Aprobar o comentar contenido propuesto. |
| POR-04 | Subir y descargar archivos compartidos con la agencia. |

## SIS — Plataforma / soporte

| ID | Requisito |
|---|---|
| SIS-01 | Historial de conversación con el agente, visible como bitácora (ver SEG-11). |
| SIS-02 | Lista de clientes con estado (al día / atrasado). |
| SIS-03 | Notificaciones in-app, email y WhatsApp. |
| SIS-04 | Biblioteca de assets por cliente (logos, videos, fotos, archivos de marca). |

---

## v2 / Futuro (fuera de v1, con razón)

| Función | Por qué se difiere |
|---|---|
| Community management asistido (responder comentarios/DMs en redes) | Requiere integraciones directas por red social |
| Email marketing (redactar/enviar campañas de correo) | Canal adicional, no crítico para el dolor principal |
| Facturación formal (generar/enviar facturas) | v1 usa cobros simples + link de pago |
| Auto-publicación en redes sociales | v1 es solo planeación; publicar sigue siendo manual |
| Reportes/métricas de rendimiento (ROI, tráfico, resultados) | Requiere integraciones con Meta/Google Analytics/etc. |
| Panel de campañas de ads (visibilidad y gestión) | Ningún competidor lo integra al CRM core; alto mantenimiento para el valor que aporta en v1 |
| SEO y mantenimiento técnico de sitio web | Trabajo técnico especializado, no encaja en el modelo cliente/calendario/pagos |
| Planes/precios detallados del SaaS (tiers, límites) | Se define antes del lanzamiento, no bloquea la planeación funcional |
| Grupos de WhatsApp con el agente | La API de grupos de Meta es invite-only, se crea vía API (no se puede adoptar un grupo existente de la agencia), tope de 8 participantes, requiere Official Business Account — reevaluar si Meta flexibiliza esto |

## Fuera de alcance (no es parte de esta planeación)

- **Stack técnico**: se define en una fase de planeación separada, posterior a este documento.
- **Estructura corporativa/legal definitiva**: pendiente de asesoría legal (ver `PROJECT.md`, sección "Consideraciones legales").
- **Autonomía del agente sin clasificación de riesgo**: nunca es un objetivo, ni en v2 (no-goal explícito).

## Validación contra el core value

Cada categoría de requisitos sostiene el core value ("todo el contexto del cliente
centralizado, gestionado activamente por un agente"): CLI y SEG dan el contexto
centralizado y seguro; CAL, CON, COB y el resto de funciones del agente son la
parte "gestionado activamente"; POR y CTA extienden ese mismo valor a clientes
finales y a la operación multi-agencia del negocio.
