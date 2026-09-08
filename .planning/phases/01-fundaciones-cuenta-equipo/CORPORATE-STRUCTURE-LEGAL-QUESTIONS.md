# Preguntas para asesoría legal — Estructura corporativa de Genzia

> Documento listo para enviar a un abogado corporativo/tech tal cual. No es
> asesoría legal en sí mismo — es el set de preguntas derivado de las
> preocupaciones abiertas en `PROJECT.md` ("Consideraciones legales /
> estructura corporativa") que necesitan respuesta antes de que Genzia inicie
> la verificación de negocio ante Meta como Tech Provider.

## Contexto para el abogado (léase antes de las preguntas)

Genzia es un producto SaaS multi-tenant (agent-as-a-service para agencias de
marketing) que hoy se plantea operar bajo **Kodevon SAS** (Colombia), una
empresa que también factura servicios de agencia/consultoría por fuera de
Genzia. Para que Genzia funcione, la empresa que lo opera debe convertirse en
**"Tech Provider" oficial de Meta**: el rol que permite administrar cuentas de
WhatsApp Business de terceros (las agencias clientes de Genzia) en nombre
propio, sin un revendedor intermedio. Eso implica que **la entidad legal que
firme el acuerdo de Tech Provider con Meta y complete la verificación de
negocio queda, en la práctica, comprometida a esa relación a largo plazo** —
migrarla después no es trivial (ver pregunta 2). Cada pregunta abajo trae su
propio contexto de una línea para que puedas responderla sin necesitar leer
ningún otro documento de Genzia.

---

## 1. Contaminación de responsabilidad entre líneas de negocio

**Contexto**: si Kodevon SAS es quien firma el acuerdo de Tech Provider con
Meta, cualquier incumplimiento de política derivado del uso de Genzia (mal uso
de mensajería de WhatsApp por parte de una agencia cliente, una disputa de un
cliente final de esa agencia, etc.) recae legalmente sobre Kodevon SAS como
entidad firmante.

**Pregunta**: ¿Cuál es la exposición legal real de Kodevon SAS si algo sale
mal del lado de Genzia (mal uso de mensajería, disputa de un cliente final), y
esa exposición puede alcanzar otras líneas de negocio de Kodevon que también
dependan de la misma cuenta de negocio verificada ante Meta (ej. cuentas
publicitarias, otras integraciones)?

## 2. Costo/riesgo de separar la entidad más adelante

**Contexto**: la hipótesis de partida (sin confirmar) es que mover la relación
de Tech Provider y las cuentas de WhatsApp Business ya conectadas de agencias
activas a una nueva entidad legal, después de que Genzia ya esté operando, es
más difícil y riesgoso que registrar la entidad correcta desde el inicio.

**Pregunta**: en términos concretos, ¿qué tan difícil/costoso sería mover la
relación de Tech Provider y las WhatsApp Business Accounts ya conectadas de
agencias hacia una nueva entidad legal después del hecho, comparado con
registrar la entidad correcta desde el arranque? Pedimos específicamente que
confirmes o corrijas esta hipótesis — es la pregunta central de la que dependen
las demás.

## 3. Mezcla contable/fiscal

**Contexto**: si Genzia opera bajo Kodevon SAS, los ingresos SaaS de Genzia
(suscripciones de agencias, cargos por conversación de WhatsApp) quedarían
registrados dentro de la misma entidad que factura los servicios de
agencia/consultoría del negocio principal de Kodevon.

**Pregunta**: ¿qué implicaciones tributarias, de auditoría, o de
"investor-readiness" (si Genzia eventualmente busca inversión propia) tiene
mezclar ingresos SaaS de Genzia con los ingresos de servicios de Kodevon
dentro de la misma entidad?

## 4. Recomendación directa: ¿constituir Genzia como su propia SAS ahora?

**Contexto**: constituir una SAS nueva en Colombia es comparativamente
rápido y barato en comparación con deshacer una relación de Tech Provider ya
establecida con Meta.

**Pregunta**: dado ese balance de costos, ¿recomiendas constituir Genzia como
su propia SAS **antes** de iniciar la verificación de negocio ante Meta, o
existe una razón válida para proceder primero bajo Kodevon SAS y evaluar la
separación más adelante?

## 5. Mínimo resguardo legal viable si no se puede constituir a tiempo

**Contexto**: si constituir una SAS nueva antes de que deba iniciar la
verificación no es viable en el tiempo disponible, Genzia igual necesita
arrancar el trámite con Meta (es la tarea crítica de cronograma marcada en
Fase 1 del roadmap) sin cerrarse la puerta a separar la entidad después sin
interrumpir a agencias ya conectadas.

**Pregunta**: si no es viable incorporar una nueva SAS antes de que deba
iniciarse la verificación ante Meta, ¿cuál es el resguardo legal mínimo viable
mientras tanto — por ejemplo, lenguaje específico en los Términos de Servicio
que nombre la entidad operadora, o un acuerdo interno entre Kodevon y una
futura entidad de Genzia — que mantenga abierta la posibilidad de separar
después sin disrupción para las agencias ya onboarded?

## 6. Lenguaje mínimo requerido en Términos de Servicio

**Contexto**: independientemente de qué entidad quede registrada ante Meta,
Genzia ya está comprometido a que sus Términos de Servicio declaren
explícitamente qué entidad legal opera el producto (ej. "Genzia es un producto
operado por Kodevon SAS") — esto no está en duda, lo que falta es la redacción
exacta.

**Pregunta**: ¿cuál es el lenguaje mínimo requerido, y dónde debe ubicarse
dentro de los Términos de Servicio, para declarar correctamente qué entidad
opera Genzia — sin importar cuál de las opciones anteriores se elija?

---

## Nota final

Estas preguntas están ordenadas para que la respuesta a la pregunta 2 (costo
de separar después) informe directamente la recomendación de la pregunta 4
(constituir ahora o no). Si el tiempo de la consulta es limitado, las
preguntas 2 y 4 son las que bloquean la decisión de qué entidad usar para
iniciar la verificación ante Meta (ver
`META-BUSINESS-VERIFICATION-CHECKLIST.md` en esta misma carpeta, que depende
de esta respuesta); las preguntas 1, 3, 5 y 6 importan pero no bloquean el
arranque del trámite.
