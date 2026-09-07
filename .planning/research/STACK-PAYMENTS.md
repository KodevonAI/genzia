# STACK-PAYMENTS.md — Pagos, firma electrónica y bóveda de credenciales

Investigación de stack para COB-01..06, PAG-01, CTR-01, BOV-01. No define
implementación detallada — resuelve **qué proveedor/enfoque** usar y por qué.

## 1. Pagos a clientes finales (COB-01..06): MercadoPago como procesador primario

**Recomendación: MercadoPago, con su API de Split Payments (marketplace), como
procesador único para todo Hispanoamérica; Stripe como fallback exclusivo para
clientes que solo aceptan tarjeta en mercados donde MercadoPago no opera
(EE.UU./resto de habla inglesa) — no una capa de routing multi-procesador
completa.**

Genzia no es el comerciante: cada agencia cobra a **sus propios clientes**, y el
dinero debe llegar a la cuenta de la agencia, no a la de Kodevon. Esto es un
problema de "marketplace/platform payments", no solo de generar un link de pago.
Las tres opciones reales:

- **Stripe.** Cobertura fuerte en México (transferencias, meses sin intereses,
  métodos en efectivo) pero **débil en el resto de LatAm** — no tiene presencia
  local nativa en Colombia, Perú, Ecuador, etc., y no soporta PSE directamente.
  Stripe Connect sí permite pagos tipo marketplace y payouts a 118+ países, pero
  eso resuelve el "a dónde va el dinero", no el "qué métodos de pago locales
  puede usar el cliente final" — que es el problema real dado que muchos clientes
  de agencias LatAm pagan con transferencia bancaria/PSE, no tarjeta.
- **Wompi (Bancolombia/EVERTEC).** Excelente cobertura local en Colombia
  específicamente: PSE (23 bancos), Nequi, Bancolombia Transfer, tarjetas, con
  Payment Links nativos y una API de "pagos a terceros" pensada justo para el
  caso marketplace (split de fondos hacia el comercio destino). Pero su alcance
  geográfico es esencialmente Colombia (con expansión incipiente a Panamá) — no
  sirve como procesador único para una base multi-país.
- **dLocal.** Cobertura amplísima (40+ países, 1000+ métodos) pero está diseñado
  para empresas que venden **hacia** LatAm desde afuera (un solo merchant
  cobrando en muchos países), con proceso de ventas enterprise y pricing
  custom/premium — no encaja con el modelo "cada agencia es su propio merchant
  recibiendo directo a su cuenta", y es sobre-ingeniería para un equipo pequeño.
- **MercadoPago.** Cubre Argentina, Brasil, Chile, Colombia, México, Uruguay y
  Perú con métodos locales reales por país (en Colombia: PSE, Nequi, Daviplata,
  Efecty en efectivo, tarjetas). Tiene **Split Payments** (`application_fee` +
  OAuth por vendedor) diseñado exactamente para el caso marketplace: cada
  agencia conecta su propia cuenta de MercadoPago vía OAuth, el pago del cliente
  final liquida directo en la cuenta de la agencia, y Genzia puede tomar una
  comisión de plataforma si algún día lo necesita. Es la única opción que
  resuelve simultáneamente cobertura de métodos locales + modelo marketplace en
  un solo proveedor.

**Por qué no una capa de routing multi-procesador desde el día uno**: correcta
en teoría (Wompi para Colombia, algo más para México, etc.) pero multiplica la
superficie de integración, certificación KYC y reconciliación de webhooks para
un equipo pequeño construyendo con Claude Code. MercadoPago ya cubre los
mercados hispanohablantes principales con un solo contrato de API y un solo
modelo de eventos. Reservar Stripe únicamente para el caso "cliente de la
agencia está en EE.UU./mercado de habla inglesa sin cobertura de MercadoPago" —
ahí sí como procesador secundario aislado, no como parte de un router genérico.
Si en el futuro aparece demanda real y sostenida en Brasil o México con
necesidades muy específicas no cubiertas por MercadoPago, se evalúa sumar un
segundo procesador puntual — no antes.

## 2. Confirmación de pago: webhooks + reconciliación activa (nunca inferencia de chat)

COB-04 exige que un pago se marque como pagado **solo** con confirmación real
del procesador. Implementación concreta con MercadoPago:

- **Webhook como fuente primaria.** MercadoPago notifica cambios de estado vía
  webhook (`payment` topic) a una URL configurada por Genzia. El webhook trae
  solo el `id` del recurso — el patrón correcto es no confiar en el payload en
  sí, sino usar ese id para **llamar de vuelta a `GET /v1/payments/{id}`** y leer
  el estado real desde la API (evita spoofing de webhooks falsos). El estado
  del pago en Genzia solo cambia a "pagado" cuando esa consulta confirma
  `status: approved`.
- **Idempotencia.** Cada evento entrante se procesa contra una tabla de eventos
  procesados (por `payment_id` + `status`) antes de aplicar el cambio — un
  webhook duplicado (MercadoPago reintenta si no responde 200 rápido) no debe
  generar notificaciones duplicadas ni romper el estado.
- **Reconciliación activa como red de seguridad.** Un webhook perdido (caída de
  red, cambio de URL, etc.) no debe dejar un cliente marcado como impago para
  siempre: un job periódico (p. ej. cada hora) consulta el estado de todo pago
  "pendiente" con más de X tiempo directamente contra la API de MercadoPago
  (`search` por `external_reference`) y corrige cualquier discrepancia. Esto es
  el mecanismo que cierra el caso "webhook silenciosamente perdido" mencionado
  en el requisito.
- **Override manual (COB-05)** es un campo separado (`marked_paid_manually_by`,
  `marked_paid_manually_at`) — nunca sobreescribe ni se confunde con el estado
  que viene del procesador; la UI debe distinguir visualmente "confirmado por
  MercadoPago" vs. "marcado manual por el equipo".

Este mismo patrón (webhook dispara → confirmar contra la API → job de
reconciliación de respaldo) es estándar de la industria y aplica igual si más
adelante se suma Stripe (Stripe recomienda exactamente lo mismo: verificar
firma del webhook, no confiar ciegamente en el payload, y tener reconciliación
periódica contra la Payments API).

## 3. Cobros recurrentes (mensualidad)

MercadoPago resuelve esto con su **API de Preapproval/Subscriptions**
(`auto_recurring` con `frequency` + `frequency_type`), confirmada activa y
soportada para cuentas en Colombia (endpoint
`mercadopago.com.co/developers/.../preapproval`) además de Argentina, Brasil,
Chile, México y Uruguay. Dos modalidades relevantes para Genzia:

- **Suscripción con plan asociado**: el cliente autoriza una vez (tarjeta
  tokenizada) y MercadoPago cobra automáticamente cada mes — ideal para
  mensualidades fijas donde el cliente da consentimiento explícito de cobro
  recurrente.
- **Suscripción sin plan asociado / cobros autorizados**: útil si el monto
  mensual varía por cliente sin crear un plan por cada uno.

Nota importante: la recurrencia automática vía MercadoPago requiere que el
cliente autorice el cobro con tarjeta (no cubre débito recurrente por PSE, que
es un pago único por transacción). Para clientes que solo pagan por PSE/Nequi
mes a mes, el flujo v1 realista es: el agente detecta vencimiento próximo →
envía link de pago puntual cada mes (ya cubierto por COB-02/03) en vez de
depender de auto-cobro. Esto es coherente con cómo ya está planteado el
requisito (recordatorio + link, no auto-débito silencioso) y evita sorprender
al cliente con un cargo no confirmado en el momento — más alineado también con
el espíritu de "nunca inferir, siempre confirmar".

## 4. Compatibilidad con la futura facturación SaaS de Genzia a las agencias

MercadoPago también sirve razonablemente bien para cobrar suscripciones a las
agencias mismas (Preapproval API funciona igual para ese caso, sin necesidad de
Split Payments ya que el dinero es directo hacia Kodevon/Genzia). No es una
plataforma de billing tan madura como Stripe Billing (metered billing, proration
avanzada, dunning sofisticado), pero para un modelo de precios simple
(planes/tiers fijos, que es lo que se espera dado que "precios se definen más
adelante") es suficiente y evita mantener dos stacks de pago separados sin
necesidad. Si el modelo de precios de Genzia termina necesitando facturación por
uso muy granular, evaluar en ese momento si conviene sumar Stripe Billing solo
para el cobro agencia→Genzia (aislado del cobro cliente→agencia, que sigue en
MercadoPago) — decisión a tomar cuando haya pricing definido, no ahora.

## 5. Firma electrónica de contratos (CTR-01): Documenso

**Recomendación: Documenso**, sobre DocuSign, Dropbox Sign (HelloSign) o
PandaDoc, por tres razones alineadas con los criterios del requisito:

- **Costo a escala SaaS.** DocuSign y Dropbox Sign cobran por plan+envelope:
  DocuSign va de ~$600/año (40 envelopes/mes) hasta miles de dólares/año en
  tiers más altos, con overages de $3–5 por envelope adicional; Dropbox Sign
  cobra por usuario ($15–25/usuario/mes) además de límites de envelope; PandaDoc
  es similar (~$19/usuario/mes) y está más orientado a propuestas de venta que a
  firma pura. Multiplicado por "muchas agencias × muchos clientes cada una", ese
  modelo de precio por envelope/asiento escala mal para Genzia como plataforma.
  Documenso tiene un tier **Platform a $250/mes con usuarios ilimitados y sin
  cobro por envelope**, y — clave para un producto que revende esta capacidad a
  N agencias — es **AGPL open-source y autohospedable**: Genzia puede correr su
  propia instancia y el costo marginal por firma adicional es ~cero, en vez de
  crecer linealmente con el número de agencias/clientes.
- **Embebible dentro de la UI de Genzia.** Documenso expone el flujo de firma,
  la API y el audit trail como código abierto, permitiendo incrustar el
  signing embebido dentro de la propia interfaz de Genzia sin mandar al cliente
  final a un sitio de marca DocuSign/PandaDoc — el mismo principio que ya
  llevó a elegir Embedded Signup de Meta en vez de un BSP: el cliente nunca
  percibe que sale a un tercero.
- **Validez legal en Colombia/LatAm.** La Ley 527 de 1999 (Colombia) da a
  cualquier firma electrónica (no solo la "firma digital" certificada por una
  entidad de certificación) plena validez jurídica y equivalencia con firma en
  papel, bajo el principio de neutralidad tecnológica: el requisito legal es que
  el método identifique al firmante, exprese su consentimiento y preserve la
  integridad del documento — no exige un proveedor específico ni una
  certificación de tercero de confianza. Documenso (como cualquier plataforma de
  firma electrónica simple, incluido DocuSign) cumple ese estándar en Colombia y
  en la mayoría de países LatAm con legislación equivalente (basada, como la
  colombiana, en la Ley Modelo de UNCITRAL sobre comercio electrónico). Nota:
  esto cubre "firma electrónica simple", suficiente para contratos comerciales
  de una agencia de marketing con sus clientes — no se requiere el nivel de
  "firma digital" con certificado calificado, que sí exige entidad certificadora
  y aplica más a trámites ante el Estado.
- **Contras a asumir conscientemente**: Documenso es un proyecto más joven que
  DocuSign, con menos historial legal en disputas y menos features avanzados
  (routing complejo, plantillas legales por país). Para v1, donde el volumen de
  contratos es bajo y el caso de uso es "contrato simple agencia-cliente", es un
  trade-off aceptable; si Genzia crece a mercados con requisitos regulatorios
  más estrictos (ej. sector financiero, gobierno) se reevaluaría.

## 6. Bóveda de credenciales (BOV-01): envelope encryption con KMS gestionado

**Recomendación: envelope encryption usando un KMS gestionado (AWS KMS o
equivalente del proveedor cloud elegido) — nunca cifrado custom ni claves
manejadas a mano por la aplicación.**

Patrón concreto:

1. Cada credencial (usuario/contraseña, token, etc.) se cifra con una **data
   key** simétrica única generada por el KMS al momento de guardar.
2. Esa data key cifra el secreto (AES-256-GCM) y luego **la data key misma se
   cifra bajo una master key que nunca sale del KMS** (`GenerateDataKey` /
   `Decrypt` vía API — la master key nunca es visible ni manipulable por la
   aplicación).
3. Se guarda junto al registro: el texto cifrado + la data key cifrada (el
   "envelope"). Para leer, la aplicación pide al KMS descifrar la data key
   (llamada de API, auditable) y descifra el secreto en memoria — nunca en
   disco ni en logs.
4. Ventajas concretas para un equipo pequeño: rotación de la master key sin
   re-cifrar todos los registros; control de acceso vía IAM (quién puede pedir
   descifrado, con logging de cada llamada — importante porque BOV-01 exige que
   la bóveda sea visible solo para equipo, auditable); y evita el riesgo real de
   "rolling your own crypto" (guardar una clave AES fija en variable de entorno,
   sin rotación ni auditoría, es el error más común y más grave en este tipo de
   feature).
5. Alternativa equivalente si el stack no usa AWS: Google Cloud KMS o Azure Key
   Vault ofrecen el mismo patrón; lo importante es "master key nunca sale del
   servicio gestionado", no el proveedor específico. No se recomienda
   HashiCorp Vault self-hosted para v1 — añade una pieza de infraestructura más
   para operar (unsealing, alta disponibilidad) que un KMS gestionado ya resuelve
   por una fracción del esfuerzo operativo, apropiado para un equipo pequeño.

---

Sources: [Wompi payment methods](https://docs.wompi.co/en/docs/colombia/metodos-de-pago/) ·
[Wompi payment links](https://docs.wompi.co/en/docs/colombia/links-de-pago/) ·
[Wompi events/webhooks](https://docs.wompi.co/en/docs/colombia/eventos/) ·
[Wompi third-party payments](https://docs.wompi.co/en/docs/colombia/introduccion-pagos-a-terceros/) ·
[MercadoPago split payments](https://www.mercadopago.com.co/developers/en/docs/split-payments/integration-configuration/create-configuration) ·
[MercadoPago preapproval API (Colombia)](https://www.mercadopago.com.co/developers/en/reference/online-payments/subscriptions/create-preapproval/post) ·
[MercadoPago Colombia payment methods](https://www.mercadopago.com.co/developers/en/reference/online-payments/checkout-pro/payment_methods/get) ·
[Stripe payments in Latin America](https://stripe.com/resources/more/payments-in-latin-america) ·
[dLocal](https://www.dlocal.com/payment-processors-in-latin-america/) ·
[Documenso pricing teardown 2026](https://dev.to/beton/documenso-pricing-teardown-2026-3ic6) ·
[DocuSign pricing 2026](https://verdocs.com/blog/docusign-pricing) ·
[Dropbox Sign / PandaDoc comparison](https://eversign.com/blog/best-docusign-api-alternatives-for-embedded-signing) ·
[Ley 527 de 1999 — Función Pública](https://www.funcionpublica.gov.co/eva/gestornormativo/norma.php?i=4276) ·
[Firma electrónica Colombia 2026](https://signasuite.com/blog/en/electronic-signature-colombia) ·
[AWS KMS envelope encryption](https://docs.aws.amazon.com/kms/latest/developerguide/kms-cryptography.html)
