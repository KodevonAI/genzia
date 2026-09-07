# ROADMAP.md — Genzia

Profundidad: **Comprehensiva** (config.json). Deriva de `REQUIREMENTS.md`. Orden
por dependencia real, no por categoría — lo que todo lo demás necesita va primero.
No define stack técnico ni asigna tiempos (GSD no estima en horas/días/semanas).

## Fase 1 — Fundaciones de cuenta y equipo (multi-tenant)

**Objetivo**: una agencia puede registrarse, invitar a su equipo, y el sistema
distingue quién es quién.

- CTA-01 a CTA-06 (registro self-serve, prueba gratis, marca del agente, invitar
  equipo con rol y número, asignar clientes)
- **Tarea crítica en paralelo, no bloqueante para el desarrollo**: iniciar el
  trámite de verificación de negocio de Genzia/Kodevon ante Meta (ver PROJECT.md,
  "Integración directa con Meta") — es un trámite externo lento, debe arrancar ya.
- **Tarea crítica en paralelo**: resolver con asesoría legal la estructura
  corporativa (Kodevon SAS vs. SAS propia para Genzia) antes de que la
  verificación ante Meta quede atada a la entidad equivocada (ver PROJECT.md,
  "Consideraciones legales").

**Éxito**: una agencia se registra, invita a 2+ miembros con roles distintos, y
cada quien ve solo lo que su rol permite.

## Fase 2 — Modelo de identidad y permisos

**Objetivo**: el sistema resuelve correctamente quién escribe y qué puede ver,
para cualquier canal — esto es prerrequisito de todo lo que hable con clientes.

- SEG-01 a SEG-12 (resolución de identidad, contactos autorizados, opt-in,
  aislamiento por conversación, capas visible/solo-equipo, divulgación honesta,
  clasificación de riesgo, bitácora)

**Éxito**: dado un mensaje simulado desde un número de equipo, un número de
cliente A, un número de cliente B y un número desconocido, el sistema resuelve
cada uno a la identidad y alcance correctos, y nunca deja pasar datos de un
cliente hacia otro.

## Fase 3 — Integración con WhatsApp / Meta

**Objetivo**: los mensajes de WhatsApp entran y salen del sistema.

- WA-01 a WA-07 (Tech Provider, Embedded Signup, número interno compartido,
  comprensión multimodal, conversaciones 1:1, costo transparente)
- Depende de que la Fase 1 (verificación de negocio) esté suficientemente
  avanzada; si Meta aún no aprueba, esta fase puede empezar con el número interno
  de la plataforma y una cuenta de prueba, y conectar agencias reales apenas Meta
  apruebe.

**Éxito**: un mensaje de WhatsApp real llega al sistema y se le aplica
correctamente el modelo de identidad de la Fase 2.

## Fase 4 — Agente conversacional core

**Objetivo**: el agente responde con criterio, en el chat web y por WhatsApp.

- Comprensión multimodal end-to-end (WA-05)
- Motor de clasificación de riesgo y cola de aprobación humana (SEG-10)
- Bitácora visible de acciones/mensajes (SEG-11, SIS-01)

**Éxito**: el agente sostiene una conversación de varios turnos, usa solo el
contexto permitido por la Fase 2, y cualquier acción de alto riesgo queda
pendiente de aprobación visible para el equipo.

## Fase 5 — Gestión de clientes (CRM conversacional)

**Objetivo**: dar de alta y consultar clientes, por formulario o por conversación.

- CLI-01 a CLI-05

**Éxito**: se da de alta un cliente dictándoselo al agente, y otro por formulario;
ambos quedan consultables y editables, con la separación visible-cliente /
solo-equipo funcionando.

## Fase 6 — Calendario y agenda

**Objetivo**: agendar, reagendar y recordar citas y contenido, por lenguaje
natural o vista visual.

- CAL-01 a CAL-05

**Éxito**: se agenda una cita de grabación por WhatsApp en lenguaje natural,
aparece en la vista visual, y el sistema manda el recordatorio automático a
tiempo.

## Fase 7 — Contenido

**Objetivo**: proponer, aprobar y regenerar contenido con el cliente.

- CON-01 a CON-04

**Éxito**: el agente propone una pieza, el cliente pide un cambio por WhatsApp, y
el agente regenera automáticamente (o pide aprobación humana si el caso lo
amerita) sin perder el hilo del cliente correcto.

## Fase 8 — Cobros a clientes

**Objetivo**: cobrar sin ambigüedad ni riesgo de disputa.

- COB-01 a COB-06

**Éxito**: un pago recurrente y uno puntual se registran, el agente manda el
recordatorio con link de pago, y el sistema SOLO marca como pagado con
confirmación real del procesador (una afirmación del cliente en el chat no
alcanza).

## Fase 9 — Portal del cliente final

**Objetivo**: el cliente final tiene su propio espacio, sin salir de lo que le
corresponde ver.

- POR-01 a POR-04

**Éxito**: un contacto autorizado entra al portal, ve solo su calendario/pagos,
aprueba una pieza de contenido y sube un archivo — nunca ve nada de otro cliente.

## Fase 10 — Contratos y bóveda de credenciales

**Objetivo**: formalizar la relación con el cliente y guardar sus accesos de forma
segura.

- CTR-01, CTR-02, BOV-01

**Éxito**: se envía un contrato, el cliente lo firma electrónicamente dentro de la
plataforma, y el equipo guarda credenciales del cliente visibles solo para ellos.

## Fase 11 — Ventas, colaboradores externos y pagos a terceros

**Objetivo**: cubrir el ciclo completo de la agencia, no solo clientes activos.

- VEN-01, VEN-02, COL-01, PAG-01

**Éxito**: se crea un prospecto, se le genera una propuesta asistida por el
agente, se registra un colaborador externo y un pago a un freelancer.

## Fase 12 — Tareas internas, rentabilidad y pulido de plataforma

**Objetivo**: cerrar el v1 con la operación interna y las vistas de apoyo.

- TAR-01, TAR-02, SIS-02, SIS-03, SIS-04, CTA-03 (verificar multiidioma end-to-end)

**Éxito**: el equipo gestiona tareas ligadas al calendario, ve rentabilidad por
cliente, recibe notificaciones por los 3 canales, y la plataforma funciona
completa en español e inglés.

---

## Dependencias críticas fuera del desarrollo (seguimiento continuo)

- **Verificación de negocio ante Meta** (arranca en Fase 1, bloquea el uso real de
  Fase 3 con agencias reales — no bloquea el desarrollo).
- **Definición de estructura corporativa** (arranca en Fase 1, debe resolverse
  antes de completar la verificación ante Meta para no tener que rehacerla).
- **Stack técnico**: pendiente de una fase de planeación separada, antes de
  empezar a ejecutar cualquier fase de este roadmap.
