# Meta Business Verification — Checklist para Genzia / Kodevon

> Checklist de ejecución única (no es un tracker vivo). Úsese para arrancar y
> guiar el trámite; el seguimiento día a día de su avance debe llevarse fuera de
> este repo (ej. tablero del equipo, Plane, etc.).

## ⚠️ Gate de entidad — leer esto primero

**Este checklist no se puede terminar de ejecutar hasta resolver qué entidad
legal se registra ante Meta.** Ver
`CORPORATE-STRUCTURE-LEGAL-QUESTIONS.md` en esta misma carpeta.

- Los pasos **1 y 4** de este documento (verificación de documentos legales y
  aplicación al Tech Provider Program) requieren saber **a nombre de qué
  entidad** se somete la documentación — Kodevon SAS o una SAS propia de
  Genzia. Empezar la verificación bajo la entidad equivocada y tener que
  corregirlo después es exactamente el riesgo que `ROADMAP.md` marca como
  costoso de deshacer ("la verificación ante Meta quede atada a la entidad
  equivocada").
- Los pasos **2 y 3** (setup de Meta Business Manager con datos preliminares,
  preparación de verificación de dominio) **sí se pueden avanzar en paralelo**
  a la consulta legal, porque no comprometen todavía qué entidad queda
  registrada de forma definitiva — pero no se debe **someter** la verificación
  final (paso 1) ni **aplicar** al Tech Provider Program (paso 4) hasta tener
  la confirmación legal.
- Si la consulta legal tarda más que el resto de la preparación: avanzar todo
  lo que no dependa de la entidad (dominio, número de teléfono, datos de
  contacto) y dejar en pausa explícita solo la sumisión de documentos legales
  y la aplicación al programa.

---

## 1. Meta Business Manager — cuenta de negocio

- [ ] Crear (o identificar si ya existe) una cuenta de **Meta Business Manager**
      a nombre de la entidad legal que finalmente se use (ver gate arriba).
- [ ] Completar los datos básicos del negocio: nombre legal exacto (como
      aparece en el registro mercantil), dirección, número de teléfono del
      negocio, sitio web.
- [ ] Asignar como administradores de la cuenta a las personas correctas de
      Kodevon (no dejarla a nombre de una sola persona individual sin
      redundancia — si esa persona pierde acceso, bloquea el trámite).

## 2. Verificación de negocio ante Meta — documentos requeridos

Reunir, con anticipación, los siguientes documentos concretos (el set estándar
que Meta pide en Business Verification; algunos pueden no aplicar según el país
pero deben revisarse todos):

- [ ] **Documento de registro/constitución legal del negocio** — para Colombia:
      Certificado de Existencia y Representación Legal (Cámara de Comercio),
      vigencia no mayor a 30-90 días según lo que Meta solicite en el momento.
- [ ] **Comprobante de dirección del negocio** — factura de servicios públicos,
      extracto bancario, o documento oficial que muestre la dirección
      registrada, a nombre de la entidad.
- [ ] **Verificación de número de teléfono del negocio** — un número que Meta
      pueda llamar o enviar SMS/código para confirmar que pertenece al negocio
      (no tiene que ser el mismo número que luego se use para WhatsApp de
      clientes).
- [ ] **NIT / identificación tributaria** de la entidad, si Meta lo solicita
      como parte del set (varía por país/categoría de negocio).
- [ ] **Prueba de propiedad del dominio** de un dominio que el negocio
      controle (ver sección 3 — es un requisito separado pero relacionado, y
      PROJECT.md lo marca como crítico específicamente).
- [ ] Confirmar que el **nombre legal en todos los documentos coincide
      exactamente** entre sí (Business Manager, certificado de existencia,
      comprobante de dirección) — la causa más común de rechazo/demora en
      Business Verification es una discrepancia de nombre o dirección entre
      documentos.

## 3. Verificación de dominio

- [ ] Confirmar cuál dominio se usará (ej. el dominio de producción de Genzia,
      o un dominio de Kodevon si Genzia aún no tiene el propio decidido —
      depende también del gate de entidad).
- [ ] Verificar el dominio en Meta Business Manager por uno de estos dos
      métodos:
  - [ ] **Registro DNS TXT**: agregar el registro TXT que Meta provee al
        proveedor de DNS del dominio, o
  - [ ] **Archivo HTML**: subir el archivo de verificación que Meta provee a
        la raíz del sitio web servido en ese dominio.
- [ ] Confirmar quién tiene acceso al DNS/hosting del dominio elegido — sin
      ese acceso este paso se bloquea (típicamente quien administra el dominio
      de Kodevon).
- [ ] Por qué importa específicamente para el Tech Provider (no solo
      "buena práctica"): Meta usa el dominio verificado como parte de la
      identidad del negocio verificado que respalda la solicitud de Tech
      Provider — sin dominio verificado la aplicación al programa (paso 4) no
      puede avanzar.

## 4. Aplicación al Tech Provider Program (antes "Solution Provider")

- [ ] Confirmar que los pasos 1–3 están completos y la entidad ya quedó
      resuelta con asesoría legal (ver gate arriba) antes de aplicar.
- [ ] Enviar la aplicación al **Tech Provider Program** desde Meta Business
      Manager / Meta for Developers, seleccionando la categoría que aplica a
      un producto que administra WhatsApp Business Accounts de terceros
      (agencias) en nombre propio.
- [ ] **Expectativa de tiempo: semanas, no días.** Este trámite es
      históricamente lento (confirmado en `research/STACK-AGENT.md` §5) — no
      planear ninguna fecha de lanzamiento real con agencias que dependa de
      una aprobación rápida.
- [ ] Enviar la aplicación **lo antes posible una vez resuelta la entidad** —
      no esperar a que el resto del producto esté listo. Es exactamente la
      tarea "crítica en paralelo, no bloqueante para el desarrollo" que marca
      `ROADMAP.md` Fase 1.
- [ ] Registrar la fecha de sumisión de la aplicación (fuera de este repo, en
      el tracker que use el equipo) para poder hacer seguimiento de tiempos de
      respuesta.

## 5. Lo que este checklist NO cubre (a propósito)

- [ ] **Embedded Signup v4** (el flujo que cada agencia usa para conectar su
      propio número de WhatsApp) es trabajo de **desarrollo**, no de este
      trámite de verificación — corresponde a la Fase 3 del roadmap
      (`WA-01`–`WA-07`). Este checklist no bloquea ese trabajo de código: se
      puede construir e incluso probar con una cuenta de prueba de Meta
      mientras la verificación de negocio real sigue en curso.
  - Nota técnica para quien ejecute Fase 3: construir contra **Embedded
    Signup v4**, no v2 — v2 queda deprecado el 15 de octubre de 2026.
- [ ] Este checklist tampoco cubre la creación de plantillas de mensajes
      (message templates) ni la configuración del webhook de mensajes
      entrantes — ambos son parte del trabajo de Fase 3, no de este trámite de
      cuenta/negocio.

## 6. Ownership y seguimiento

- [ ] **Quién lo lleva**: debe quedar asignada una persona específica de
      Kodevon como responsable de impulsar este trámite (no "el equipo" de
      forma difusa) — dado lo lento del proceso, sin un dueño claro es fácil
      que quede estancado semanas sin que nadie lo note.
- [ ] El seguimiento de avance (documentos enviados, fecha de aplicación,
      respuestas de Meta, tiempos de espera) se lleva **fuera de este repo**
      — este documento es la checklist de arranque, no un tracker vivo que se
      vaya actualizando.
- [ ] Revisar este checklist una sola vez más después de la consulta legal
      (Task 2 / `CORPORATE-STRUCTURE-LEGAL-QUESTIONS.md`) para confirmar que
      la entidad elegida no cambia ningún dato ya recopilado (nombre legal,
      dirección, documentos) antes de someter la aplicación del paso 4.
