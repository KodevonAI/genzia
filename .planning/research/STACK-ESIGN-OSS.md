# STACK-ESIGN-OSS.md — ¿Existe una alternativa open-source realmente gratis a Documenso?

Investigación puntual (sept. 2026), vía búsqueda web, a pedido directo del product
owner tras `STACK-VERIFY.md`: ¿hay algún proyecto de firma electrónica
open-source con licencia permisiva (MIT/Apache-2.0, no AGPL) que Genzia pueda
auto-hospedar e incrustar en su propio SaaS de código cerrado sin costo de
licencia? Se evaluó DocuSeal, OpenSign y LibreSign — los tres candidatos
creíbles además de Documenso — verificando la licencia directamente en el
archivo `LICENSE` de cada repo de GitHub (no en páginas de marketing).

## Resultado directo: no hay ninguno. Los tres son AGPL-3.0, igual que Documenso

| Proyecto | Licencia real (verificada en GitHub) | ¿Lo que dice el marketing/blogs? |
|---|---|---|
| **DocuSeal** | **AGPL-3.0**, con "Section 7(b) Additional Terms" propios | Correcto en la mayoría de fuentes |
| **OpenSign** (OpenSignLabs) | **AGPL-3.0** — confirmado leyendo `LICENSE` directo en `github.com/OpenSignLabs/OpenSign` y la etiqueta de licencia que GitHub le asigna al repo | **Incorrecto en varias fuentes**: varios blogs/agregadores (openalternative.co y otros) afirman que OpenSign es "MIT license". Es falso — el repo real es AGPL-3.0. Esto es exactamente el patrón de riesgo que motivó esta investigación: marketing de "open source" que no coincide con la licencia real del código |
| **LibreSign** (Nextcloud) | **AGPL-3.0** — confirmado en la página del repo de GitHub | Consistente en todas las fuentes |
| **Documenso** (ya evaluado en STACK-VERIFY.md) | AGPL-3.0 | Consistente |

**Conclusión de licencia**: no existe hoy un proyecto de firma electrónica
open-source, feature-completo y activamente mantenido, bajo licencia
permisiva (MIT/Apache-2.0). El mercado entero de "open-source e-signature"
converge en AGPL-3.0 porque es el modelo de negocio estándar de esta
categoría: código abierto para auditar/contribuir, pero con el copyleft de
red de AGPL empujando a cualquier empresa que quiera incrustarlo en un
producto cerrado hacia un plan pago. No es una particularidad de Documenso —
es el patrón de toda la categoría.

## Y hay una segunda trampa, peor que en Documenso: open-core sobre la propia versión auto-hospedada

Esto es lo que más le importa a Genzia, porque CTR-01 exige exactamente
"API/SDK para incrustar el flujo en la UI propia" (no redirigir al cliente a
una página de terceros — el mismo principio ya aplicado en el onboarding de
WhatsApp):

- **DocuSeal**: la edición Community auto-hospedada (gratis, AGPL) **no
  incluye acceso a API ni embedding ni white-label ni SSO** — todo eso está
  gateado detrás de una licencia **Pro auto-hospedada de US$20/usuario/mes**,
  además de la obligación de AGPL si se auto-hospeda sin esa licencia Pro. Es
  decir: incluso pagando para resolver el problema de AGPL, DocuSeal cobra
  *otra vez* por la funcionalidad específica que Genzia necesita.
- **OpenSign**: la versión gratis auto-hospedada **no permite generar tokens
  de API para producción** — solo tokens de sandbox. Un token de API en
  producción (lo que hace falta para incrustar el flujo de firma dentro de
  Genzia) requiere un plan pago, incluso auto-hospedado.
- **LibreSign**: no aplica el mismo problema de open-core, pero tiene un
  problema de arquitectura más grave — es una app de **Nextcloud**, no un
  servicio standalone. Requiere correr una instancia completa de Nextcloud
  como dependencia. No es una API/SDK ligera para incrustar en un Next.js
  existente; es adoptar una segunda plataforma entera. Se descarta por
  completo de fit, independientemente de la licencia.

**En resumen**: incluso si Genzia decidiera absorber el riesgo legal de AGPL
(inviable, ya descartado en STACK-VERIFY.md), DocuSeal y OpenSign *igual*
cobrarían por la funcionalidad de API/embedding en su edición auto-hospedada.
La licencia AGPL no es la única barrera — hay una segunda barrera comercial
encima, independiente de la licencia.

## Feature completeness (si el problema de licencia no existiera)

Para lo que CTR-01 necesita (enviar contrato, firma tipeada/dibujada del
cliente, audit trail, API embebible):

- **DocuSeal**: el más completo de los tres — SDKs en JS/Python/Ruby/PHP/Java/C#/Go,
  web components embebibles, plantillas, firma multi-parte, audit trail y
  certificado de finalización. Stack Ruby on Rails. ~12,000–18,000 stars en
  GitHub (cifras varían según fuente/fecha de snapshot), fork activo,
  commits recientes — proyecto sano.
- **OpenSign**: funcionalmente comparable (firma dibujada/tipeada/subida,
  firmantes múltiples, orden de firma, enlaces de firma), pero con superficie
  de API más limitada en la práctica por el gating de tokens de producción
  mencionado arriba. Stack sobre Parse Server. ~7,000 stars, buen ritmo de
  crecimiento reciente.
- **LibreSign**: funcionalmente capaz para firmar PDFs, pero descartado por
  la dependencia de Nextcloud (ver arriba).

## Validez legal en Colombia (Ley 527 de 1999)

Igual que con Documenso: la ley no exige un proveedor específico — cualquier
método que permita identificar al firmante en relación con el mensaje de
datos (firma tipeada, dibujada, OTP, etc.) es válido como **firma
electrónica simple**. La diferencia legal real no es de vendor, sino de
**tipo de firma**: una firma electrónica simple (no una firma digital
certificada con criptografía asimétrica) no goza de la presunción legal de
integridad/autenticidad — en caso de disputa, puede requerir **peritaje
técnico o informe de auditoría** para sostenerse en juicio. Esto hace que la
**calidad del audit trail** (IP, timestamp, hash del documento, verificación
de identidad del firmante, registro inalterable del evento de firma) importe
más que la marca del proveedor — un punto igual de válido para Documenso,
DocuSeal u OpenSign.

## Costo real de auto-hospedar (para comparar contra los US$250/mes de Documenso)

Licencia gratis no es lo mismo que costo cero. Estimado realista para un
equipo pequeño, usando DocuSeal Community o OpenSign self-hosted, **sin**
pagar el tier Pro que habilita API/embedding (es decir, el escenario donde
igual haría falta pagar para resolver el gating, no solo el de AGPL):

| Partida | Estimado mensual |
|---|---|
| VPS pequeño (2 vCPU / 2-4GB RAM, Docker) — Hetzner/DigitalOcean/Fly.io | US$10–24/mes |
| Postgres (incluido en el mismo VPS o gestionado tipo Neon pequeño) | US$0–20/mes (si se reutiliza infraestructura ya presupuestada en STACK.md, marginal) |
| Almacenamiento S3-compatible para PDFs firmados (Cloudflare R2, ya en el stack de Genzia) | ~US$0–5/mes a este volumen |
| SMTP transaccional (notificaciones de firma) | US$0–10/mes (tier gratis de Resend/Postmark cubre volumen inicial) |
| Tiempo de un dev para mantener el self-host (parches, backups, uptime) — no es cero, es carga operativa real, no reflejada en el precio | intangible, pero no despreciable para un equipo sin DevOps dedicado |
| **Total infra directa** | **~US$15–45/mes** |
| **+ licencia Pro necesaria para habilitar API/embedding** (DocuSeal: $20/usuario/mes; OpenSign: plan Professional/Teams) | **+US$20–80/mes según asientos** |
| **Total realista para igualar lo que Documenso Platform ya incluye** | **~US$35–125/mes**, más la carga operativa de mantener el propio Postgres/backups/uptime que Documenso Cloud absorbe |

Este total (35–125/mes) sí es más barato en el papel que los US$250/mes de
Documenso — pero no es "gratis", y **no incluye la carga operativa** de
mantener uptime, backups, certificados y parches de seguridad con un equipo
sin DevOps dedicado (el mismo argumento que ya usa `STACK.md` para justificar
pagar por servicios gestionados en el resto del stack: Vercel/Neon/R2 en vez
de infraestructura propia). También sigue existiendo la obligación de AGPL
de fondo — la licencia Pro de DocuSeal resuelve el gating de features, pero
la obligación de copyleft de red de AGPL en sí (divulgar el código fuente
modificado a quien interactúe con el servicio por red) es un tema legal
aparte que no queda automáticamente resuelto solo por comprar Pro, salvo que
los términos de licencia Pro de DocuSeal la sustituyan explícitamente por una
licencia comercial (habría que confirmar con su equipo de ventas/legal antes
de asumirlo, igual que se hizo con Documenso).

## Recomendación

**No hay una alternativa open-source genuinamente gratis y permisiva.**
DocuSeal, OpenSign y LibreSign son AGPL-3.0 — el mismo problema de fondo que
Documenso, y en el caso de DocuSeal/OpenSign, con la trampa adicional de que
ni siquiera la propia edición auto-hospedada incluye la funcionalidad de
API/embedding sin pagar. No se recomienda perseguir ninguna de estas tres
como sustituto "gratis" de Documenso — la promesa de gratuidad no se sostiene
al llegar al requisito real de CTR-01 (incrustar el flujo de firma en la UI
propia de Genzia).

**La decisión ya tomada en `STACK.md` se mantiene sin cambios**: firma
electrónica sigue fuera de v1 por el mismo motivo (costo fijo desde el primer
contrato), y cuando se retome en v2, **Documenso Platform en la nube
(US$250/mes) sigue siendo la opción más simple y predecible** — no porque
sea la única con AGPL (todas lo son), sino porque es la única que ya incluye
API completa + embedding + white-label sin licencia adicional ni carga
operativa de auto-hosting. Un self-host de DocuSeal u OpenSign con su
respectiva licencia Pro (~US$35–125/mes) es técnicamente más barato en el
papel, pero suma carga operativa no trivial para un equipo sin DevOps
dedicado, y merece evaluarse recién si en v2 el volumen de contratos
justifica el ahorro frente al tiempo de ingeniería que consume mantenerlo.
