# STACK-VERIFY.md — Verificación de cifras (Documenso + hosting a escala)

Verificación puntual, vía búsqueda web (sept. 2026), de dos afirmaciones de
`STACK.md`/`STACK-PAYMENTS.md`/`STACK-WEB.md` que el usuario cuestionó
directamente. No repite el resto de la investigación — solo corrige y precisa
cifras.

## 1. Documenso: qué es, el plan Platform, y si "auto-hospedado" es realmente gratis

**Qué es**: Documenso es un producto de firma electrónica (envío de
documentos a firmar, tracking de firmantes, audit trail, certificado de
finalización) — no es un servicio de terceros que "tercerice" la firma en el
sentido de outsourcing de proceso; es una plataforma que Genzia integra vía
API/SDK y embebe en su propia UI, igual que se haría con DocuSign.

**El plan Platform a $250/mes SÍ es correcto** — la cifra en `STACK-PAYMENTS.md`
se confirma, no era un error. Precisado: son **$250/mes facturado
anualmente ($3,000/año)**, e incluye **usuarios y documentos ilimitados**
(no hay cobro por envelope ni overage por volumen), **1 "team" incluido**
(equipos adicionales requieren hablar con ventas — no hay precio de lista
público), acceso completo a la API, y el **widget de firma embebido +
white-label** (dominio, colores, correos con marca de Genzia, no de
Documenso) — exactamente lo que CTR-01 necesita. Por debajo del Platform
existen Free (5 documentos/mes), Individual (~$25/mes anual) y Teams
(~$40/mes anual, 5 usuarios + $8/usuario adicional) — todos con límites de
volumen o asiento que no sirven para un producto que revende esto a N
agencias.

**Auto-hospedado NO es simplemente "gratis" para el caso de uso de Genzia** —
esta es la corrección real a `STACK-PAYMENTS.md`, que lo presentaba como
alternativa equivalente sin costo. Los hechos:

- El código es **AGPL-3.0**, gratis de correr (Docker Compose incluye
  Postgres; hay Helm chart). "Gratis" ahí sí es cierto en el sentido de
  licencia — cero costo de licencia — pero el equipo asume infraestructura
  (Postgres, backups, SMTP, certificado de firma que hay que generar uno
  mismo, uptime) sin costo de licencia.
- El problema es el **AGPL en sí**: Documenso es explícito en que embeber su
  flujo de firma/widget dentro de un producto comercial de código cerrado
  (exactamente el plan de Genzia — "incrustar en la UI de Genzia") activa la
  obligación de copyleft de red del AGPL, y su propia posición comercial es
  que **eso requiere licencia paga** — Platform en la nube ($250/mes) o, si
  se insiste en auto-hospedar, una **licencia comercial Enterprise
  auto-hospedada que arranca en $30,000 USD/año**. Es decir: el self-host
  "gratis" solo es gratis si Genzia *no* embebe el flujo en su propio
  producto cerrado (rompe el requisito de UX de CTR-01) o si Genzia mismo
  libera su código bajo AGPL (inviable para un SaaS propietario).
- Conclusión práctica: **$250/mes en la nube de Documenso es, de hecho, la
  opción más barata que cumple el requisito** — más barata que auto-hospedar
  con licencia Enterprise ($2,500/mes equivalente) y sin la carga operativa
  de mantener Postgres/backups/certificados propios. La recomendación de
  `STACK-PAYMENTS.md` de usar Documenso queda confirmada; lo que hay que
  corregir es no presentar el self-host como alternativa gratuita real dado
  que Genzia necesita embedding en producto cerrado.

Fuentes: [Documenso pricing](https://documenso.com/pricing) ·
[Platform Plan Launch](https://documenso.com/blog/platform-plan-launch-signing-worth-embedding) ·
[Self-Hosting docs](https://docs.documenso.com/docs/self-hosting) ·
[Licenses docs](https://docs.documenso.com/docs/policies/licenses) ·
[Self-hosted Enterprise infra announcement](https://documenso.com/blog/introducing-self-hosted-signing-infrastructure-for-enterprise) ·
[GitHub discussion sobre AGPL + paquete "ee"](https://github.com/documenso/documenso/discussions/1415) ·
[Documenso Pricing Teardown 2026 (dev.to)](https://dev.to/beton/documenso-pricing-teardown-2026-3ic6)

## 2. Costo de hosting: 250 → 10,000 usuarios, ¿misma arquitectura o rediseño?

**Supuesto de "usuario" (explícito)**: se modela como **total de cuentas
individuales** — admins/miembros de agencia + contactos de cliente final —
no "agencias como tenant". Con eso: **250 usuarios ≈ 25 agencias** (~3
staff + ~7 contactos de cliente c/u) al arranque, y **10,000 usuarios ≈
500–1,000 agencias** al año. Esto importa porque, por diseño de
`STACK-WEB.md`, **Clerk solo autentica staff de agencia** — los contactos de
cliente usan magic-link propio, no Clerk — así que el conteo de Clerk (MRU)
es mucho menor al total de "usuarios".

**Veredicto directo a la pregunta más importante: NO hace falta
re-arquitecturar entre 250 y 10,000 usuarios.** Los cinco servicios son
todos de pricing basado en consumo/uso, no de "tier de arquitectura" — el
salto es de facturación, no de rediseño: Neon autoescala cómputo (mismo
Postgres, solo se sube el techo de CU), Vercel factura funciones/ancho de
banda por uso sobre el mismo modelo serverless, Clerk cobra por MRU (mismo
producto), Inngest por ejecuciones (mismo producto), R2 por GB (mismo
bucket). El único "cambio" real es de plan Neon Launch→Scale e Inngest
Hobby→Pro — ambos son upgrades de cuenta, no migraciones técnicas.

**A ~250 usuarios (~25 agencias)**:
- **Vercel Pro**: $20/asiento/mes (2 devs ≈ $40) + uso incluido en crédito a
  este volumen → **~$40–60/mes**.
- **Neon Launch**: sin mínimo mensual desde dic. 2025 (100% consumo) —
  $0.106/CU-hora + $0.35/GB-mes storage → **~$20–40/mes**.
- **Clerk**: Hobby/free hasta 50,000 MRU — muy por debajo → **$0/mes**.
- **Inngest**: Hobby free hasta 50K ejecuciones/mes; sube a Pro ($75/mes,
  1M ejecuciones) si el equipo interno pasa de 3 asientos (límite de Hobby)
  → **$0–75/mes**.
- **Cloudflare R2**: free tier cubre 10GB + 1M ops clase A → **~$0–5/mes**.
- **Documenso Platform**: **$250/mes fijo** (ver §1).
- **Total estimado: ~$310–430/mes**, dominado por el fijo de Documenso.

**A ~10,000 usuarios (~500–1,000 agencias)**:
- **Vercel Pro**: mismo plan, pero uso (funciones del chat en streaming +
  webhook de WhatsApp + bandwidth) crece bastante → **~$500–1,500/mes**
  pay-as-you-go (Enterprise solo se justificaría por SLA/soporte, no por
  límite técnico).
- **Neon Scale** ($0.222/CU-hora, mismo $0.35/GB-mes storage): más CU-horas
  concurrentes por RLS + más branches de preview → **~$200–450/mes**.
- **Clerk**: aun con 500–1,000 agencias × ~5–10 staff = 2,500–10,000 MRU,
  sigue **bajo el umbral de 50,000 MRU gratis** → **$0/mes** (los contactos
  de cliente, que sí llegan a miles, no cuentan porque no pasan por Clerk).
- **Inngest Pro**: $75/mes base + overage por volumen de recordatorios/jobs
  → **~$75–300/mes**.
- **Cloudflare R2**: más contratos/activos almacenados, sin costo de
  egress → **~$20–100/mes**.
- **Documenso Platform**: **$250/mes — sin cambio**, porque el tier ya es
  usuarios/documentos ilimitados desde el día uno.
- **Total estimado: ~$1,050–2,600/mes**.

**Corrección a `STACK-WEB.md`**: no había cifras concretas ahí (correcto no
asumir sin verificar), pero vale dejar registrado que Neon eliminó los
mínimos mensuales por plan en dic. 2025 — el modelo es 100% consumo desde
Free hasta Scale, lo cual refuerza aún más el argumento "no hay que
re-plataformar", ya que no hay un salto de precio fijo por cruzar un tier.

Fuentes: [Vercel pricing docs](https://vercel.com/docs/pricing) ·
[Vercel Functions limits](https://vercel.com/docs/functions/limitations) ·
[Neon plans](https://neon.com/docs/introduction/plans) ·
[Clerk pricing](https://clerk.com/pricing) ·
[Clerk: Updated Pricing (50K MAU free)](https://clerk.com/blog/new-pricing-plans) ·
[Inngest pricing](https://www.inngest.com/pricing) ·
[Cloudflare R2 pricing](https://developers.cloudflare.com/r2/pricing)
