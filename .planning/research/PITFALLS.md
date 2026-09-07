# PITFALLS.md — Domain Risk Research for Genzia

Research into failure modes for agency-ops SaaS, autonomous customer-messaging
agents, multi-tenant WhatsApp Business API platforms, and chat-based payment
collection — filtered to what's actually relevant to Genzia's specific design
(risk classification, audit log, phone-number identity resolution, white-label
agent persona, dual-number architecture). Generic "test your AI" advice is
excluded.

## 1. Risk classification is a judgment call the agent itself makes — and it can misjudge it

The Air Canada case (BC Civil Resolution Tribunal, 2024) and a German court
ruling against a medical-chatbot operator (2026) both establish the same
principle: courts treat a company's chatbot as an authoritative company
statement, full stop — "the AI made it up" is not a defense. The dangerous
failure mode for Genzia isn't the absence of a low/high-risk split (that
already exists) — it's an action getting **misclassified** as low-risk. A
payment reminder with a wrong amount, a "confirmed" appointment time the agent
inferred rather than verified, or a status update that overstates progress are
all currently bucketed as auto-executing, low-risk actions, yet each is a
statement the agency now owns.

**Warning signs**: audit log entries where an auto-executed message required a
correction afterward; clients replying "that's not what we agreed"; team
members editing/retracting agent messages after the fact.
**Prevention strategy**: the audit trail lets these be caught in retrospect,
but v1 has no described mechanism to *reclassify* an action type after a
near-miss, or to require confidence thresholds (e.g., an inferred fact vs. a
directly-confirmed one) as an input to the risk tier. **Gap**: risk
classification is described as a static per-action-type rule, not something
that also accounts for the agent's certainty about the specific message content.

## 2. WhatsApp opt-in consent isn't satisfied by "the agency added them as a contact"

Meta's Business Messaging Policy requires an *affirmative, WhatsApp-aware*
opt-in naming the specific business before any proactive message — not just
"the business has their number." Pulling numbers from an invoice or a contact
list and messaging them is explicitly called out as a policy violation.
Genzia's authorized-contacts model lets agency staff add a client contact's
WhatsApp number directly to a client card, after which the agent can message
them proactively (payment reminders, content approvals) — with no described
capture of consent at the moment of adding that contact.

**Warning signs**: template rejections or a quality-rating drop on a specific
agency's number shortly after bulk-importing existing clients; clients
reporting the agent's messages as spam.
**Prevention strategy**: none currently — this is a real gap. Since each
agency's ban risk is isolated to its own number (a benefit of the
per-agency-number design), a violation doesn't cascade across tenants, but it
can still kill an individual agency's onboarding on day one if their first
action is bulk-importing a client list without consent. **Not addressed in
v1**: no opt-in capture step is described anywhere in the client/contact
onboarding flow.

## 3. Undisclosed AI persona reads as deception, not service

Research is consistent: customers are far angrier about being *deceived* about
talking to a bot than about talking to a bot itself (the Amex "David" incident
is the canonical recent example — a chatbot insisting it was human). The
white-label design intentionally hides that a shared platform is behind the
agent, which is the right choice for brand consistency, but nothing in
PROJECT.md says whether the agent discloses it is AI when asked, and multiple
jurisdictions (EU) are moving toward mandatory AI-disclosure rules for
consumer-facing bots.

**Warning signs**: clients asking "am I talking to a bot?" and audit log
showing evasive or false answers; complaints referencing feeling "tricked."
**Prevention strategy**: the audit log at least makes this auditable after the
fact. **Not addressed in v1**: white-labeling is specified, but there's no
stated policy for what the agent says when a client directly asks if it's
AI — this needs a decision before launch, not after a complaint.

## 4. Payment-in-chat is a phishing look-alike and a "who authorized this" dispute risk

Invoice/payment-link fraud over WhatsApp (fake suppliers, changed bank
details) is one of the most common WhatsApp scam patterns today, which means
Genzia's legitimate payment links will visually resemble what clients have
been trained to distrust. Separately, the agent's "mark as paid automatically"
feature creates a dispute surface: if it auto-confirms based on an ambiguous
signal (a client saying "sent!" before the money clears), the agency believes
it's paid when it isn't.

**Warning signs**: clients asking the agency to verify a payment link through
a separate channel before paying; disputes about "marked paid" status that
didn't match the actual transaction.
**Prevention strategy**: routing payment-link generation and amount changes
through the high-risk approval gate would cover the "wrong link/amount" case
but is not explicitly stated in scope. **Gap**: auto-marking-paid is listed as
a low-risk, auto-executing action in PROJECT.md; it should probably require a
payment-processor webhook confirmation rather than agent inference from chat
text, and this distinction isn't made yet.

## 5. Group-chat authorization is scoped to the *client*, not to *who's speaking in it*

The isolation model is strong on cross-client leakage (a group is hard-bound
to one client, data for other clients is never loaded). But within a client's
own group, PROJECT.md doesn't distinguish an authorized contact from any other
participant who happens to be in that WhatsApp group (an intern, a former
employee still in the thread). Any of them could currently trigger the same
agent actions as the real decision-maker.

**Warning signs**: content "approved" or appointments "cancelled" by someone
the client later says wasn't authorized to do that.
**Prevention strategy**: the authorized-contacts list exists for 1:1 chats but
its role inside groups is unspecified. **Not addressed in v1**: whether
high-risk confirmations (approve content, cancel a session) inside a group
still require the actor to be a listed authorized contact, or whether group
membership alone is treated as implicit authorization.

## 6. Adoption failure isn't feature-gap, it's the switch-the-number problem

HoneyBook/Dubsado-style tools are commonly abandoned not for missing features
but because they don't fit how the relationship evolves after onboarding
(the "month 7" problem — communication gaps precede most client losses per
industry survey data), and because heavy upfront configuration delays
time-to-value. Genzia has a sharper version of this: its core pitch is
replacing WhatsApp-as-the-tool, which means an agency's *existing* clients
have to be moved onto a new WhatsApp Business number with no history, no
existing trust signal in the thread, and (per pitfall #2) a fresh consent
requirement — right at the moment the agency is trying to prove the product
works.

**Warning signs**: agencies signing up for the free trial but never
completing WhatsApp Business number connection; high team-side usage but low
client-side engagement post-onboarding.
**Prevention strategy**: self-serve signup is designed to lower friction on
the agency side, but nothing in v1 scope addresses the migration experience
for the agency's *existing* clients (re-establishing trust/consent on a new
number, or importing/referencing prior WhatsApp history for context). **Not
addressed in v1**: this is an onboarding-flow gap, not a core-product gap, but
it directly threatens the trial-to-paid conversion the whole business model
depends on.

## Sources

- [Germany: Court Rules Chatbot Operators Are Liable for AI Hallucinations — Library of Congress](https://www.loc.gov/item/global-legal-monitor/2026-06-09/germany-court-rules-chatbot-operators-are-liable-for-ai-hallucinations/)
- [Can Someone Sue Your Business Over an AI Hallucination?](https://www.businessattorneychicago.com/can-someone-sue-your-business-over-an-ai-hallucination/)
- [Courts to Companies: You Own What Your Chatbot Says — PYMNTS.com](https://www.pymnts.com/news/artificial-intelligence/chatbot-tracker/2026/courts-tell-companies-they-own-what-their-chatbot-says/)
- [WhatsApp Business Messaging Policy](https://business.whatsapp.com/policy)
- [Get opt-in for WhatsApp — Meta for Developers](https://developers.facebook.com/documentation/business-messaging/whatsapp/getting-opt-in)
- [WhatsApp Opt-In Compliance Requirements — Blueticks](https://blueticks.co/blog/whatsapp-opt-in-compliance-requirements)
- [Full List of WhatsApp Business Policy Violations (2026)](https://wetarseel.ai/whatsapp-business-policy-violations/)
- ['I hate customer-service chatbots': The consumer-AI refund relationship is off to a rocky start — CNBC](https://www.cnbc.com/2026/04/01/ai-chatbot-customer-service-complaints-refunds.html)
- [Should You Tell Customers They Are Talking to AI?](https://chatgpt.ca/blog/disclose-ai-to-customers)
- [12 WhatsApp Scams you need to know and how to avoid them — Bitdefender](https://www.bitdefender.com/en-us/blog/hotforsecurity/whatsapp-scams)
- [Dubsado vs HoneyBook for Marketing Agencies 2026 — USTechAutomations](https://ustechautomations.com/resources/blog/automate-dubsado-vs-honeybook-for-marketing-agencies-2026)
- [We Reviewed The Top 10 SuiteDash Alternatives — ManyRequests](https://manyrequests.com/blog/suitedash-alternatives)
- [Your agent didn't hallucinate; it exceeded its authority — VentureBeat](https://venturebeat.com/technology/your-agent-didnt-hallucinate-it-exceeded-its-authority)
- [WhatsApp Business API Pricing 2026 — Blueticks](https://blueticks.co/blog/whatsapp-business-api-pricing-2026)
