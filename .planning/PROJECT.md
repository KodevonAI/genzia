# PROJECT.md — Genzia

## Nombre del producto

**Genzia** — nombre del producto/plataforma que se vende a las agencias. Distinto
del nombre que cada agencia le pone a SU agente frente a sus propios clientes (eso
queda configurable por agencia, ver sección de marca del agente).

## Visión

**Agent as a Service** para agencias de marketing: no es un dashboard donde el equipo
organiza todo manualmente, sino un **agente de IA que ejecuta la operación diaria**
de gestión de clientes — agenda, contenido, cobros y comunicación — con la marca
propia de cada agencia. El agente ES la interfaz principal del producto; el
calendario/CRM visual existe como vista de apoyo, no como el modo primario de uso.

## Problema que resuelve

Las agencias de marketing (freelancers, agencias pequeñas o grandes, con muchos o
pocos clientes) hoy organizan todo con **WhatsApp + Excel**. La información queda
dispersa en chats, se pierden fechas de grabación, publicaciones y pagos, y no hay
un lugar único con el contexto de cada cliente. No existe hoy una herramienta
equivalente enfocada en este dolor específico.

## Core value (lo que debe funcionar perfecto)

Tener **todo el contexto de cada cliente centralizado**, gestionado activamente por
un agente de IA — no solo un repositorio de datos que el humano consulta, sino un
agente que actúa (recuerda, cobra, agenda, redacta) en nombre de la agencia.

## Modelo de negocio

- SaaS **multi-tenant** desde el día uno (no herramienta interna de una sola agencia)
- Registro **autoservicio con prueba gratis**
- **Multiidioma desde v1** (español / inglés)
- Precios y planes específicos: por definir más adelante (no bloquea la planeación funcional)

## Usuarios y roles

| Rol | Alcance |
|---|---|
| Dueño / administrador de agencia | Ve y gestiona todo: todos los clientes, todo el equipo, toda la agenda |
| Equipo (diseñadores, editores, community managers, etc.) | Solo ve/gestiona los clientes que le fueron asignados |
| Cliente final de la agencia | Acceso a su propio espacio: portal + conversación con el agente |

## Cómo se interactúa con el agente

- **Equipo interno**: chat de texto dentro de la web app **y** WhatsApp
- **Clientes finales**: WhatsApp, chat dentro del portal, o email
- El agente entiende **texto, audio (notas de voz) e imágenes** en todos los canales
- Funciona en conversaciones **1 a 1** (WhatsApp y web). *Grupos de WhatsApp
  quedan fuera de v1*: la API de Meta para grupos es nueva, solo por invitación,
  se crean vía API (no se puede "adoptar" un grupo que la agencia ya tenga con un
  cliente), con tope de 8 participantes y requiere estatus de "Official Business
  Account" — no encaja con el valor que aportaría en v1 (ver
  `research/STACK-AGENT.md`).

### Dos números de WhatsApp, con propósitos distintos

- **De cara al cliente**: cada agencia conecta el número de WhatsApp Business
  **que YA tiene y que sus clientes ya conocen** (no un número nuevo) — no es una
  migración de clientes a un canal desconocido, es agregarle la capacidad del
  agente a un canal que ya existe y en el que ya hay historial y confianza. El
  agente responde ahí con la marca y tono de esa agencia (white-label) — el cliente
  final no percibe que usa una plataforma compartida.
- **Interno del equipo**: un **número único de la plataforma, compartido entre
  todas las agencias** (no requiere que cada agencia configure y verifique su propia
  línea de WhatsApp Business solo para uso interno). El sistema identifica a qué
  agencia pertenece cada persona por su registro (no por el número al que escribe).
  Justificación: el branding solo importa de cara al cliente; exigir dos números
  propios por agencia añadiría fricción de onboarding (verificación de negocio,
  plantillas) que contradice el registro autoservicio con prueba gratis. Además,
  separar el número interno del de cliente da una primera capa de aislamiento
  adicional (equipo vs. cliente ya queda resuelto por el número al que escriben,
  antes de mirar el remitente).
- Alta de un miembro del equipo: su número de WhatsApp se captura **al invitarlo a
  la plataforma** (el admin lo invita con su rol y su número).

### Integración directa con Meta — sin intermediarios (Tech Provider)

Genzia se conecta a la plataforma de WhatsApp Business **directamente con Meta**,
sin pasar por un revendedor/BSP intermedio (tipo Twilio, 360dialog, etc.). Esto
requiere que **Genzia/Kodevon se convierta en "Tech Provider" oficial de Meta**:
el rol que permite administrar cuentas de WhatsApp Business de terceros (las
agencias) en nombre propio.

**Cómo se ve el flujo de conexión de una agencia:**
1. Genzia (como Tech Provider) se registra y verifica como negocio ante Meta
   (verificación de negocio: documentos legales, dominio propio) — trámite que
   toma tiempo real y no depende del desarrollo del producto.
2. Cuando una agencia llega al paso de "conectar tu WhatsApp" en el onboarding, ve
   el flujo oficial de Meta llamado **Embedded Signup**, incrustado dentro de la
   misma app de Genzia — la agencia nunca sale a un sitio de un tercero ni ve la
   marca de un revendedor. Inicia sesión con su cuenta de Facebook Business,
   selecciona o crea su cuenta de WhatsApp Business, y verifica su número (el que
   ya tiene, como se definió arriba).
3. Desde ese momento Genzia tiene acceso directo vía la API de Meta para
   enviar/recibir mensajes en nombre de esa agencia — sin intermediario alguno.

**Costos**: Meta cobra por conversación directamente al Tech Provider (Genzia).
Ese costo se traslada a la agencia **como un cargo aparte y transparente**, no
incluido de forma oculta en la suscripción — la agencia ve claramente cuánto le
cuesta el uso de conversaciones de WhatsApp.

**Dependencia crítica de cronograma**: la verificación de negocio de Genzia ante
Meta (paso 1) debe iniciarse **desde la primera fase del roadmap**, en paralelo al
desarrollo — es un trámite con Meta que puede ser el verdadero cuello de botella
del lanzamiento, no algo que se resuelva en una tarde. Debe quedar marcada
explícitamente como tarea temprana en `ROADMAP.md`.

## Modelo de identidad y permisos (crítico — evita fuga de información entre clientes)

**Principio**: el agente nunca decide el alcance de la información por el número al
que le escriben (siempre el mismo, el de la agencia) — lo decide **quién escribe** y
**en qué conversación**, resuelto antes de generar cualquier respuesta.

- Cada ficha de cliente tiene una lista de **contactos autorizados** (nombre, número
  de WhatsApp y/o email, rol dentro del cliente). Un cliente puede tener varios
  contactos autorizados (ej. dueño + asistente).
- **Solo el equipo de la agencia agrega o quita contactos autorizados** de la ficha
  del cliente. El cliente nunca se autoriza a sí mismo ni puede sumar otros
  contactos por su cuenta.
- Un número de teléfono solo puede estar vinculado a **un único cliente** (evita
  ambigüedad de contexto). *(Edge case anotado: una misma persona real gestionando
  dos clientes distintos de la agencia necesitaría dos números — a revisar si surge
  en la práctica).*
- Número no registrado (ni equipo ni contacto autorizado) → el agente responde con
  el objetivo de convertirlo en cliente/prospecto (flujo de captación).
- **Consentimiento de WhatsApp (opt-in) es obligatorio antes de mensajes
  proactivos**: agregar un número como contacto autorizado NO es suficiente por sí
  solo (política de Meta exige consentimiento afirmativo explícito). Al agregar un
  contacto autorizado a la ficha de un cliente, el sistema exige confirmar que ese
  contacto dio consentimiento explícito para recibir mensajes por WhatsApp — recién
  ahí se habilitan mensajes proactivos del agente hacia él (recordatorios, etc.).
- **Divulgación honesta**: si un contacto le pregunta directamente al agente si es
  un bot/IA, el agente **siempre lo admite** — nunca sostiene el personaje para
  negar o evadir esa pregunta, aunque tenga nombre y tono personalizados por la
  agencia.
- **Resolución de contexto por conversación**:
  - Chat 1:1 con miembro del equipo → responde con el alcance de su rol (admin ve
    todo; miembro solo sus clientes asignados)
  - Chat 1:1 con contacto autorizado de un cliente → el agente solo puede hablar de
    ESE cliente
- **Aislamiento por diseño, no por filtro**: al llegar un mensaje, el sistema carga
  en el contexto del agente únicamente los datos del cliente correspondiente — los
  datos de otros clientes ni siquiera están disponibles en esa conversación. No es
  que el agente "elija" no decir algo; no tiene acceso a ello.
- **Capas dentro de la ficha de cada cliente**:
  - *Visible para el cliente*: agenda, estado de pago, contenido a aprobar, archivos
  - *Solo equipo*: notas internas, rentabilidad, riesgos, comentarios internos — el
    agente nunca cruza esta frontera hacia el cliente, ni aunque lo pregunte directamente

## Autonomía y control del agente

Cada acción se clasifica por nivel de riesgo:
- **Bajo riesgo** → el agente ejecuta solo (ej. enviar recordatorio de pago)
- **Riesgo alto** → requiere aprobación humana antes de llegar al cliente (ej.
  reagendar una cita, contenido nuevo hacia el cliente)

Toda acción y mensaje del agente queda en una **bitácora completa y visible** para
el equipo, para poder auditar y corregir.

## Alcance funcional — v1

### Funciones del Agente
1. Comprensión multimodal (texto, audio, imágenes) en web y WhatsApp
2. Gestión de clientes: alta (formulario o dictado en lenguaje natural), consulta,
   edición, búsqueda
3. Calendario: agendar/reagendar/cancelar citas de grabación; calendario de
   contenido (solo planeación, sin auto-publicar); recordatorios automáticos
4. Cobros a clientes: registrar plan de pago **recurrente (mensualidad) o puntual
   (por proyecto/entrega)**, detectar próximos/vencidos, recordatorio + link de
   pago, consultar estado de cuenta ("¿quién me debe?"). El pago se marca como
   pagado **solo con confirmación real del procesador de pagos** (nunca por
   inferencia de lo que el cliente escribe en el chat, ej. "ya te pagué"); el
   equipo de la agencia también puede marcarlo como pagado manualmente (ej. pago
   recibido por fuera del sistema).
5. Contenido: redactar/proponer piezas por cliente, enviar para aprobación,
   **regenerar automáticamente** ante feedback del cliente, marcar aprobado
6. Comunicación con el cliente final: responder preguntas de su cuenta/agenda/pagos,
   mensajes proactivos con la marca de la agencia, recibir archivos compartidos
7. Pagos a terceros: registrar pagos que la agencia hace a freelancers, proveedores,
   pauta publicitaria
8. Ventas: pipeline de prospectos + generación de propuestas/cotizaciones para
   clientes nuevos

### Funciones del Sistema (plataforma)
- **Cuenta de agencia (multi-tenant)**: registro self-serve + prueba gratis,
  configurar marca del agente (nombre/tono/logo), conectar número propio de
  WhatsApp Business
- **Equipo**: invitar miembros, roles y permisos, asignar clientes a miembros
- **Portal del cliente final**: login propio, ver calendario y estado de pago,
  aprobar/comentar contenido, subir/descargar archivos
- **Identidad y permisos**: contactos autorizados por cliente, resolución de
  contexto por conversación, separación visible-cliente / solo-equipo (ver sección
  dedicada arriba)
- **Biblioteca de assets** por cliente (logos, videos, fotos, archivos de marca)
- **Ficha de colaboradores externos** (influencers/freelancers): directorio con
  datos de contacto y acuerdos
- **Contratos**: alertas de vencimiento/renovación por cliente (la firma
  electrónica dentro de la plataforma se movió a v2 — ver tabla de "Fuera de v1")
- **Bóveda de credenciales del cliente** (accesos a redes, Ads, Analytics, dominio, etc.)
- **Tablero de tareas internas** ligado al cliente/calendario
- **Rentabilidad por cliente**
- **Vistas de apoyo**: calendario visual (mensual/semanal), lista de clientes con
  estado (al día / atrasado), historial de conversación con el agente (bitácora)
- **Notificaciones**: in-app, email, WhatsApp
- **Idioma**: español / inglés desde v1

## Fuera de v1 (backlog para el futuro)

| Función | Por qué se difiere |
|---|---|
| Community management asistido (responder comentarios/DMs en redes) | Requiere integraciones directas por red social |
| Email marketing (redactar/enviar campañas de correo) | Canal adicional, no crítico para el dolor principal |
| Facturación formal (generar/enviar facturas) | v1 usa cobros simples + link de pago |
| Auto-publicación en redes sociales | v1 es solo planeación; publicar sigue siendo manual |
| Reportes/métricas de rendimiento (ROI, tráfico, resultados) | Requiere integraciones con Meta/Google Analytics/etc. |
| Panel de campañas de ads (visibilidad y gestión) | Ningún competidor lo integra al CRM core; alto mantenimiento de las APIs de Meta/Google Ads para el valor que aporta en v1 |
| SEO y mantenimiento técnico de sitio web | Trabajo técnico especializado, no encaja en el modelo cliente/calendario/pagos |
| Firma electrónica de contratos dentro de la plataforma | La única opción viable evaluada (Documenso) cuesta US$250/mes fijo desde el primer contrato — no se justifica en v1; v1 mantiene solo alertas de vencimiento de contrato |
| Planes/precios detallados del SaaS (tiers, límites) | Se define antes del lanzamiento, no bloquea la planeación funcional |

## No-goals explícitos

- No se define el **stack técnico** en esta etapa — es una fase de planeación separada
- El agente **nunca** actúa sin clasificación de riesgo, ni en v2 tendría autonomía
  totalmente libre sin control
- El aislamiento de información entre clientes es una regla dura, no configurable
  por agencia

## Consideraciones legales / estructura corporativa (abierto)

> ⚠️ No es asesoría legal formal — pendiente de confirmar con un abogado
> corporativo/tech antes de iniciar la verificación de negocio ante Meta.

Hoy Genzia se plantea como un producto de **Kodevon SAS** (Colombia), que sería
quien se registre y verifique ante Meta como Tech Provider. Puntos a resolver con
asesoría legal antes de avanzar:

- **Contaminación de responsabilidad entre líneas de negocio**: si Kodevon SAS es
  quien firma el acuerdo de Tech Provider, cualquier incumplimiento de política
  derivado de Genzia (mal uso de mensajes por una agencia cliente, disputa de un
  cliente final, etc.) expone legalmente a Kodevon SAS, y podría afectar otras
  actividades de Kodevon que también dependan de Meta (ads, otra cuenta de negocio),
  al compartir la misma cuenta de negocio verificada.
- **Separación futura**: si Genzia crece y en algún momento necesita levantar
  inversión propia, sumar un socio, o separar su riesgo/patrimonio del resto de
  Kodevon, mover la relación de Tech Provider y las cuentas de WhatsApp Business ya
  conectadas de las agencias a una nueva entidad legal **no es trivial con Meta** —
  puede implicar re-verificación completa y riesgo de interrupción del servicio
  para agencias ya activas durante la transición.
- **Mezcla contable/fiscal**: los ingresos de Genzia (SaaS) quedarían dentro de la
  misma entidad que factura los servicios de agencia/consultoría de Kodevon.
- **Recomendación a evaluar con el abogado**: dado que constituir una SAS nueva en
  Colombia es relativamente rápido/barato, y que deshacer una relación de Tech
  Provider ya establecida con Meta es lento y costoso, vale la pena confirmar si
  conviene registrar **Genzia como su propia SAS desde ahora**, antes de iniciar el
  trámite de verificación ante Meta, en vez de corregirlo después.
- **Transparencia mínima mientras se decide**: independientemente de qué entidad
  legal quede registrada ante Meta, los Términos de Servicio de Genzia deben
  declarar explícitamente qué entidad opera el producto (ej. "Genzia es un producto
  operado por Kodevon SAS") — la ambigüedad es lo que genera riesgo, no el hecho de
  que una empresa tenga varias marcas.

## Investigación de dominio

Ver `.planning/research/FEATURES.md` (comparación con HoneyBook, Dubsado, ClickUp,
Content Snare, Planable, etc.) y `.planning/research/PITFALLS.md` (riesgos
específicos de un agente de IA mensajeando clientes de forma autónoma). Las
decisiones que surgieron de esa investigación ya están incorporadas en las
secciones de arriba (firma electrónica, consentimiento WhatsApp, divulgación del
bot, confirmación de pago, alcance de ads y pipeline de prospectos).

## Repositorio

- Proyecto independiente del repo `ImprelappWeb` (tienda en línea, sin relación)
- Repo: `KodevonAI/genzia` (privado)
