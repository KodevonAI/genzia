# FEATURES.md — Domain Research (Agency Client Ops / AI-Agent-as-a-Service)

Research grounded in 2025/2026 products: HoneyBook, Dubsado, SuiteDash, Agiled, Bonsai,
ManyRequests, Agency Handy, Content Snare, Planable, Sprout Social, Agorapulse, Sked
Social, ClickUp, Taskip (AI-first client portal), plus the WhatsApp-AI-agent vendor
landscape (BotPenguin, Wati, Zoko, AgenticWhatsup, YourGPT).

## 1. Table stakes

Features users of "agency ops" tools now expect as baseline, regardless of vendor:

- **Branded/white-label client portal** — a login where the client sees their own
  project, files, and invoices under the agency's brand, not the vendor's (SuiteDash,
  Agiled, ManyRequests, Agency Handy all lead with this).
- **Proposals, contracts, e-signature** — send a proposal, get it signed, convert to
  a project (HoneyBook, Dubsado, Bonsai's core loop).
- **Invoicing + online payment collection** — Stripe/PayPal/Square-connected invoices,
  recurring/retainer billing, payment reminders (every product in this set has this;
  it's the #1 revenue-critical feature).
- **File sharing / asset storage** per client, with folders and permissions.
- **Content/editorial calendar with client approval** — drag-and-drop calendar,
  comment/annotate on drafts, approve-without-login shareable links (Planable, Sked
  Social, SocialPilot, Agorapulse).
- **Scheduling/booking** — calendar links for meetings or recording sessions, with
  automated reminders (Dubsado, HoneyBook, Taskip's meeting scheduler).
- **Team roles & permissions**, assigning clients/projects to specific team members.
- **Automations/workflows** — trigger emails, task creation, status changes on events
  (Dubsado's biggest selling point, also Agiled).
- **Basic reporting** — who owes money, project status, overdue items.
- **Multi-channel notifications** (email at minimum; WhatsApp/SMS increasingly expected
  since 2024-2025, per Taskip and the WhatsApp-CRM integration category).

## 2. Differentiators — is "agent as primary interface" actually new?

**Partially, but the specific combination Genzia proposes is not yet shipped by anyone
found in this research.** Two adjacent categories exist today and neither fully
overlaps:

- **Generic WhatsApp AI agent platforms** (BotPenguin, Wati, YourGPT, AgenticWhatsup,
  Zoko) build the *infrastructure* to run an AI agent on WhatsApp — intake, FAQ,
  booking, checkout — but they are horizontal tools an agency would have to configure
  itself for its own business logic (client CRM, content approval semantics, contract
  alerts). They are not agency-domain-specific products.
- **Taskip** is the closest direct competitor found: an "AI-first client portal" for
  agencies with a native WhatsApp inbox and an AI assistant. Critically, its AI
  **drafts replies for a human to review and send, and summarizes chats** — it is a
  co-pilot embedded in a dashboard-first product, not an agent that autonomously
  *is* the interface and *acts* (rescheduling, sending payment links, marking paid)
  without a human opening a dashboard. This is the real gap: today's tools bolt AI
  onto a dashboard; Genzia inverts that (dashboard is the support view, agent is
  primary).
- No product found combines: (a) agency's own white-labeled WhatsApp number talking
  directly to the end client, (b) risk-tiered autonomous actions (auto-send payment
  reminders, auto-mark-paid, auto-regenerate content on feedback) vs. human-approval
  gates, and (c) one continuous audit log of agent actions across web+WhatsApp. That
  triad — not "having AI" — is the defensible differentiator, and it should be the
  headline in positioning, not "we have an AI chatbot" (table stakes by 2026; Meta
  itself now routes ~10M business conversations/week through AI on WhatsApp).
- Risk is that this differentiator is easy to describe but hard to demonstrate in a
  demo/trial — competitors' dashboards are visually "provable" in a screenshot, an
  agent's judgment is not. Onboarding needs to make the agent *visibly* do something
  autonomous fast (e.g., first payment reminder sent unprompted) or the differentiation
  won't land with a skeptical buyer used to Dubsado-style dashboards.
- Multi-tenant shared internal WhatsApp number + per-agency client-facing number is
  also not something the reviewed vendors do — most either give every customer a
  single shared bot number or require full business verification per customer
  (friction Genzia is explicitly avoiding). This is a legitimate onboarding-friction
  differentiator worth keeping.

## 3. Anti-features — what hurts these products, and what to avoid

- **Automation complexity as a wall.** Dubsado reviews consistently cite "a weekend to
  map workflows" before the tool is useful — power users love the flexibility, most
  freelancers/small agencies never configure it. Genzia's agent-first pitch is
  specifically an antidote to this; don't undermine it by shipping a rules/workflow
  builder as the primary configuration surface.
- **Feature-gating core value behind expensive tiers.** ManyRequests locking
  white-labeling behind a ~$399/mo tier, and time-tracking/annotations behind
  mid-tier plans, is a recurring complaint — it makes the free/entry plan feel like a
  trap. Whatever payment/approval/portal features ship in v1 should work at the entry
  price point, not be teased.
- **No native support/ticketing, forcing a bolt-on tool.** ManyRequests' lack of a
  ticketing layer forces agencies to run a second tool for client questions — directly
  the fragmentation Genzia's WhatsApp+agent model is meant to eliminate. Worth
  validating the agent genuinely closes this gap rather than becoming "yet another
  portal to check."
- **Single-step or brand-locked approval flows.** Planable gates multi-step approval
  behind Enterprise and charges per brand workspace — punishing agencies exactly at
  the point where they have more clients (their whole customer base). Don't repeat a
  pricing model that taxes growth in client count when clients-under-management is
  the core unit of this product.
- **AI as a bolted-on assistant panel nobody opens.** Several 2025/2026 "AI-powered"
  CRM entrants add a chat sidebar that duplicates dashboard functionality instead of
  replacing the workflow — usage data across the category suggests these go unused.
  If the agent isn't strictly necessary to get the job done, it becomes a novelty.
- **Over-broad channel promises.** Products that promise deep integration across every
  social network's comments/DMs, ad platforms, and analytics tend to ship shallow,
  brittle integrations that break with API changes (Meta/Google policy churn was
  called out repeatedly in this research). Genzia's own backlog already defers this —
  correctly.
- **WhatsApp platform-policy risk.** Meta's updated Business Solution Terms (effective
  Jan 2026) restrict AI providers where a "general-purpose AI assistant" is the
  primary product functionality on WhatsApp, while still allowing AI for "ancillary
  business functions" like support. Genzia's scoped, business-logic-bound agent
  (scheduling/payments/content approval tied to real records, not open-ended chat)
  fits the allowed pattern, but this is worth validating with Meta's current terms
  before v1 ships, not treated as settled.

## 4. Gap check against Genzia v1 scope

**Table-stakes items missing from the v1 list, worth a deliberate decision (add or
explicitly defer):**
- **E-signature on contracts.** V1 has "contract expiration alerts" but nothing about
  creating/signing the contract itself — every competitor here (HoneyBook, Dubsado,
  Bonsai, Agiled) treats send-and-sign as core, not an add-on. If agencies are meant
  to track contract expiration in Genzia, they'll likely also want the contract
  created and signed there — otherwise it's a second tool in the loop.
  Deferring signature entirely is reasonable but should be a *named* decision, not a
  silent gap.
- **Recurring/retainer billing structures**, not just "plan de pago" + reminders.
  Agencies overwhelmingly bill retainers monthly; v1's "cobros" language should be
  checked to confirm it covers recurring auto-charges, not only one-off payment links.
- **Basic support/ticket thread outside a specific approval or payment context** —
  v1 covers content approval and payment Q&A but a general "client has a question that
  isn't content or payment" catch-all is implicitly covered by the agent chat itself,
  which is likely fine, but worth confirming isn't assumed away.

**V1 items that look like scope bloat relative to what competitors actually ship in
a first release:**
- **Ads visibility panel and profitability-per-client** are real agency needs but
  no reviewed competitor (even mature ones like SuiteDash/Agiled) bundles ads-campaign
  visibility into their core CRM — it's typically a separate reporting tool
  (AgencyAnalytics, etc.) specifically because ad-platform APIs are high-maintenance
  and churn often. V1 already scopes this down to "visibility only, no management,"
  which is the right instinct — but it's still the single feature most likely to slip
  or feel thin given it depends on Meta/Google Ads API integration work that has
  nothing to do with the agent/WhatsApp core value prop.
- **Prospect pipeline + proposal/quote generation** is more sales-CRM territory
  (HubSpot-shaped) than the "agency ops for existing clients" pain point the PROJECT.md
  problem statement centers on (WhatsApp + Excel chaos managing *current* clients).
  It's a legitimate feature (Dubsado/HoneyBook both lead with proposals), but it's
  arguably a distinct workflow from the agent-manages-my-clients core loop, and could
  ship in a fast-follow rather than v1 without weakening the core value prop.
- **External collaborator directory** (influencers/freelancers with contact + deal
  terms) is a nice-to-have layer on top of "outgoing payments to freelancers" — none
  of the reviewed competitors treat a freelancer/influencer directory as core; it's
  closer to a lightweight CRM-within-a-CRM. Could be trimmed to "just enough fields to
  make an outgoing payment" for v1 rather than a full directory experience.
- Net effect: the client-facing loop (CRM, calendar, approval, payments, portal,
  credentials, tasks) matches what incumbents ship as v1; the two features that add
  the most non-core engineering surface for the least differentiation value are the
  **ads visibility panel** and the **prospect/proposal pipeline** — both worth a
  scope conversation, not necessarily a cut.
