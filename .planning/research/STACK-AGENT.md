# STACK-AGENT.md — Genzia

Research into the AI-agent layer of Genzia's stack: LLM provider, orchestration,
voice/image understanding, WhatsApp Cloud API integration, and the audit/approval
pattern. Grounded in `PROJECT.md`, `REQUIREMENTS.md` (SEG, WA sections) and
`ROADMAP.md` Fases 2–4. Does not cover the rest of the stack (DB, backend
framework, hosting) — that's a separate research file.

## 1. LLM provider: Claude (Anthropic), specifically Sonnet 5

**Recommendation: Anthropic's API, primary model `claude-sonnet-5`, with
`claude-haiku-4-5` for cheap sub-tasks.** Not GPT-5.1, not a multi-provider
abstraction layer.

Why, against this specific use case:

- **Tool-calling reliability over benchmark chasing.** Genzia's core risk isn't
  "does the model write good copy," it's "does the model call `reschedule_appointment`
  with the right client ID and not the wrong one, every time, and does it correctly
  classify that call as needing approval." Claude's tool-use format (forced/auto
  `tool_choice`, `strict: true` schema validation, parallel tool calls returned
  as a single batch) is mature and this is the dimension Anthropic tunes hardest
  for agentic products — it's literally what Claude Code and the Agent SDK are
  built on. GPT-5.1 tool-calling is competitive but the ecosystem and docs lean
  toward its Assistants/Realtime surfaces rather than a plain server-side
  tool-calling loop, which is what Genzia needs for a backend-driven WhatsApp bot.
- **Vision is comparable; extended reasoning + adaptive thinking is a better fit
  for judgment calls.** Deciding whether client feedback on a content draft
  warrants auto-regeneration or a human approval gate (CON-03), or whether a
  reschedule request is routine vs. needs the account owner's sign-off, is a
  judgment task, not a retrieval task. Claude Sonnet 5 with `thinking: {type:
  "adaptive"}` handles this without hand-tuned chain-of-thought prompting.
- **No native audio input on either provider's plain chat/completions API.**
  This matters because it removes "native audio" as a differentiator: OpenAI's
  audio path is the separate Realtime API (`gpt-realtime`), priced per-audio-token
  ($32/1M in, $64/1M out) and designed for live voice conversations, not for
  ingesting a static WhatsApp voice note. Claude's Messages API has no audio
  input mode at all (only Claude Code's own product UI got a `/voice` dictation
  feature in 2026, which is not exposed via the API). **Conclusion: for both
  providers, voice notes go through a dedicated speech-to-text step before
  reaching the LLM** — see §3. This neutralizes what looked like an OpenAI
  advantage and simplifies the pipeline to one shape regardless of provider.
- **Cost.** Sonnet 5: $2/$10 per MTok in/out. GPT-5.1: $1.25/$10. Close enough
  that cost is not the deciding factor — reliability of tool-call structure and
  risk classification is.
- **Ecosystem fit for a small team using Claude Code.** Building with Claude
  Code as the dev tool while shipping on the Anthropic API keeps one mental
  model, one SDK, one prompt-caching mechanism, one set of docs for the team to
  internalize. This is a real, non-trivial productivity argument for a small
  team and tips the decision even where GPT-5.1 is roughly at parity.

**Model split:**
- **Main conversational/agentic reasoning**: `claude-sonnet-5` — every turn
  that resolves identity, decides risk level, or calls a tool.
- **Cheaper/faster for simple sub-tasks**: `claude-haiku-4-5` for: summarizing
  a long client history into the system context before it's injected, drafting
  first-pass content proposals before a Sonnet-level polish/regeneration pass,
  classifying trivial in-bound intents (e.g. "is this a payment question or a
  scheduling question") to route without spending a full Sonnet turn. Don't use
  Haiku for anything that makes a tool call reaching a client — keep the
  risk-classification-adjacent reasoning on Sonnet.
- Do **not** build a multi-provider abstraction (LangChain's `ChatModel`
  interface, LiteLLM, etc.) "just in case." It buys optionality Genzia doesn't
  need yet and adds an indirection layer between the team and Anthropic's actual
  tool-use semantics, which is exactly the layer that needs to be gotten right.

## 2. Agent orchestration: Anthropic TypeScript/Python SDK directly, no LangGraph/CrewAI

**Recommendation: hand-roll the agent loop against the Anthropic Messages API**
(either the raw `while (stop_reason === "tool_use")` loop, or the SDK's beta Tool
Runner as a thin convenience over the same loop) — **not** a general-purpose
agent framework like LangGraph, CrewAI, or AutoGen.

Why this, given SEG-05–SEG-08 and SEG-10:

- **Context isolation must be structural, not prompted.** SEG-05 is explicit:
  the system must not load another client's data into context — full stop, not
  "the agent chooses not to mention it." That means the code that builds the
  `system` prompt and the `messages` array for a given conversation is the
  single most security-critical function in the codebase. A framework like
  LangGraph adds a graph/state abstraction between "conversation resolved to
  client X" and "what actually goes into the API call" — more surface for a
  scoping bug to hide in, and harder for a small team to audit line-by-line.
  A plain function — `buildContext(conversationId) -> {system, tools, messages}`
  called fresh on every inbound message, backed by a query that is *incapable*
  of returning cross-client rows — is auditable in one sitting and is the right
  shape for a hard security invariant.
- **The approval gate is a tool-execution interceptor, and that's simplest to
  own directly.** SEG-10 requires every tool call to pass through a
  risk-classification step before it executes, and high-risk calls must queue
  for human approval rather than run immediately. In a hand-rolled loop this is
  one `if` before you execute a tool. In LangGraph it means the agent's
  `interrupt()` primitive: on `interrupt()`, execution halts and the resume
  problem — persist the pending state, know what run is waiting on which
  approval, re-enter the graph at the right node once approved — lands on you
  anyway. You'd be paying for the framework's abstraction and still building
  the same approval-queue plumbing yourself. Skip the middleman.
- **Temporal (or the LangGraph-on-Temporal combo some teams reach for) is the
  right idea for a different problem.** Temporal earns its keep for
  long-running, crash-recoverable workflows with complex replay/retry
  semantics. Genzia's approval waits are "sits in a Postgres table until a
  human clicks approve," which can be minutes or days — that's a queue with a
  status column, not a durable-execution engine. Reaching for Temporal now
  would be exactly the "bleeding-edge/exotic tooling" the team should avoid;
  revisit only if Genzia later needs cross-service saga orchestration (e.g.
  payment webhook → calendar update → notification, all-or-nothing) at a scale
  where ad hoc retry logic starts breaking down.
- **Multi-agent frameworks solve a problem Genzia doesn't have.** CrewAI/AutoGen
  are built for coordinating several LLM "roles" collaborating on one task.
  Genzia has one agent per conversation with a bounded tool surface — there's no
  multi-agent handoff requirement in the requirements docs. Don't add the
  complexity of a multi-agent framework's supervisor/worker pattern to solve
  single-agent tool-calling.

**Concretely:** one Node/TypeScript (or Python) service function per inbound
message that (1) resolves identity + conversation scope (Fase 2 logic), (2)
builds a fresh `messages`/`system`/`tools` payload scoped to that context only,
(3) calls `client.messages.create(...)` (or the beta tool runner) in a loop,
routing each `tool_use` block through the risk-classification interceptor
described in §6 before executing it, and (4) writes every message and tool call
to the audit log as it happens, not after the fact.

## 3. Voice note transcription: Deepgram (Nova-3) primary, Whisper as fallback

WhatsApp voice notes arrive as `.ogg`/Opus audio via the media API. Recommend
**Deepgram Nova-3** for production transcription (Spanish + English, both
needed per CTA-03) — fastest (sub-300ms achievable, though Genzia's use case is
async so latency is less critical than for live voice agents), strong accented-
speech performance, and cheap at roughly $0.0043–0.0077/minute depending on
batch vs. streaming. Deepgram supports automatic language detection, which
matters here since an agency's Spanish- and English-speaking clients will send
notes to the same number without indicating language up front.

Use **OpenAI Whisper (`whisper-1` or a hosted equivalent)** as a secondary/
fallback option, not primary: cheap ($0.006/min), broad 57+ language coverage,
well-documented, trivial to swap to if Deepgram has an outage — but Deepgram's
edge on multilingual accented accuracy fits Genzia's Spanish/English mix better
as the default path. Don't reach for ElevenLabs Scribe here: it leads on raw
multilingual accuracy in some benchmarks but is priced and positioned for
higher-fidelity conversational/dubbing use cases; the marginal accuracy gain
doesn't justify the added integration for straightforward voice-note transcription.

**Pipeline shape:** webhook receives voice note → download media via Graph API
media endpoint → send audio to Deepgram → transcript text is what actually
enters the Claude conversation as a normal text turn (prefixed internally with
something like "[voice note transcript]" so the agent's response can acknowledge
it came from audio). Store the transcript (not just a reference) in the audit
log per SEG-11 — the original audio file should also be retained/linked for
dispute resolution, but the agent only ever reasons over text.

## 4. Image understanding: Claude Sonnet 5 vision, with OCR as an explicit gap to watch

Claude Sonnet 5's native vision handles the described cases well: a client
sharing a logo, a screenshot of a payment confirmation, a photo of a signed
document, a mockup for content feedback. Feed the image directly as a base64
or URL content block in the same `messages.create` call — no separate vision
pipeline needed for the general case.

**Known gap to design around, not ignore:** dense-text screenshots (long chat
threads, tabular invoices, small-font error messages) are where general-purpose
LLM vision degrades compared to a dedicated OCR pass. Given that COB (cobros)
flows may involve a client photographing a bank transfer receipt as "proof of
payment," and PROJECT.md is explicit that **payment status must never be
inferred** from what the client says or shows in chat — it's confirmed only by
the payment processor's own webhook (COB-04) — this is actually low-stakes: a
misread receipt image can't incorrectly mark something paid, because the system
doesn't trust image content for that decision at all. Where it *does* matter is
readability for the human team reviewing an approval-queue item that includes
an attached image (e.g. a proposed content asset) — Claude's vision is more
than adequate there. No dedicated OCR service (e.g. Google Cloud Vision, AWS
Textract) is needed for v1; revisit only if a specific feature emerges that
depends on precise text extraction from images (e.g. auto-parsing a formal
invoice PDF a client uploads).

## 5. WhatsApp Cloud API integration (WA-01–WA-07)

**Surface:** Meta's Graph API, WhatsApp Business Platform ("Cloud API"), used
directly as a **Tech Provider** — no BSP. Core pieces:

- **Becoming a Tech Provider**: Genzia/Kodevon must complete Meta Business
  Verification (legal business docs, domain ownership) and register under the
  Tech Provider Program (formerly "Solution Provider"). This is the slow,
  external dependency ROADMAP.md already flags for Fase 1 — confirmed correct
  by current Meta docs; budget weeks, not days, and note that **Embedded
  Signup v2 is being deprecated October 15, 2026** — build directly against
  **Embedded Signup v4** so there's no near-term forced migration.
- **Embedded Signup flow (WA-02)**: a Meta-hosted JS SDK flow embedded in
  Genzia's onboarding UI. The agency logs into Facebook Business, selects/
  creates a WhatsApp Business Account (WABA), and picks their existing phone
  number (or migrates it in). Technically this means: Genzia registers a Meta
  App, implements the Facebook Login for Business + Embedded Signup JS SDK on
  the frontend, and on completion receives an authorization code that the
  backend exchanges for a long-lived access token scoped to that agency's WABA
  and phone number ID. Each agency's WABA becomes a row in Genzia's tenant
  table, keyed by `waba_id` + `phone_number_id`.
- **Inbound messages / webhooks**: Genzia configures one webhook endpoint
  (per Meta App, shared across all onboarded agencies — the payload includes
  the `phone_number_id` that received the message, which is how you route to
  the right agency). Meta POSTs to this endpoint for every inbound message,
  status update (delivered/read), and template status change. This must
  respond 200 fast (<a few seconds) and do actual processing (identity
  resolution, agent invocation) asynchronously off a queue — a slow webhook
  handler causes Meta to consider the endpoint unhealthy.
- **24-hour customer service window & templates**: this directly determines
  which of Genzia's proactive messages need pre-approved templates. Any
  message sent within 24 hours of the client's last inbound message is a free-
  form "session message" — no template required. Once that window closes, only
  a pre-approved **template message** may be sent to re-open contact. This is
  the exact mechanic behind COB-03 (payment reminders) and CAL-03 (appointment
  reminders): both are proactive and cannot assume an open window, so **both
  need Meta-approved message templates from day one** (category: "Utility" —
  covers appointment reminders and payment/billing notices; keep marketing-
  flavored copy out of them or Meta reclassifies as "Marketing," which is
  priced and throttled differently). Design the reminder system to always have
  an approved template fallback ready, and treat "session window open" as an
  optimization (send free-form, cheaper/richer) rather than the default path.
  Note also: free-form session messages are billed starting Oct 1, 2026 (free
  before that) — budget WA-07's "pass-through cost to agency" logic accordingly.
- **Groups (WA-06) — important recent development to design around:** Meta
  shipped an **official Groups API** on the Cloud API (opened to all Official
  Business Accounts as of mid-2026). This changes what's technically possible
  and imposes constraints PROJECT.md's phrasing ("un grupo de WhatsApp") doesn't
  anticipate: **groups are invite-only and must be created via the API**
  (`POST /{phone_number_id}/groups`) — a business cannot be added into an
  arbitrary pre-existing WhatsApp group the way a personal account can, there's
  no endpoint to add a participant directly (people join via an invite link
  the business sends), each group is capped at **8 participants**, and Official
  Business Account status is a prerequisite (itself gated on WABA verification,
  Tier 1+ messaging history, and Meta's discretionary approval — plan for this
  as a second verification hurdle stacked on top of the Tech Provider one, not
  a checkbox). **Recommendation: for v1, treat WhatsApp groups as
  Genzia-created** (the agency/agent creates the group for a client via the
  API and invites the relevant people) rather than assuming agencies' existing
  ad hoc groups can be turned into agent-aware channels — the API does not
  support the latter. Flag this explicitly to product/design: it may mean
  groups launch as an opt-in feature agencies set up per-client rather than a
  drop-in replacement for however they already use WhatsApp groups today.
  Distinguishing a group message from a 1:1 in the webhook: the Cloud API's
  `messages` webhook payload carries the message under a value object whose
  `to` context / recipient type indicates group vs. individual (the API adds
  `recipient_type: "group"` and the group ID instead of a phone number for the
  `to` field), so routing to "this conversation is tied to client X's group"
  is a lookup on that group ID, structurally identical to the phone-number
  lookup already required for SEG-01–SEG-02 — one more identifier type in the
  same resolution table, not a different code path.
- **Two-number model (WA-03/WA-04)**: no special API mechanism needed — the
  "internal platform number" is just one more WABA/phone number, connected
  once by Genzia itself (not per-agency), with routing to the correct agency
  done application-side by looking up the sender's registered team-member
  phone number, exactly as PROJECT.md specifies.

## 6. Audit log / approval queue pattern

Recommend a **tool-call interceptor + append-only event log**, both backed by
Postgres (or whatever the primary datastore ends up being — this pattern is
storage-agnostic), composing directly with the hand-rolled loop from §2:

1. **Classify before execute.** Every tool definition carries a static risk
   tag (`low` / `high`) in code — e.g. `send_payment_reminder: low`,
   `reschedule_appointment: high`, `send_content_proposal: high` — reviewed
   in code review like any other business rule, not decided by the LLM at
   runtime. This directly satisfies SEG-10's intent that risk classification
   is a system property, not the agent's judgment call.
2. **Low-risk**: interceptor executes immediately, writes one row to an
   `audit_log` table (actor = agent, conversation ID, tool name, input,
   output, timestamp, risk tag) synchronously before returning the result to
   the model.
3. **High-risk**: interceptor does **not** execute. It writes a row to an
   `approval_queue` table (status `pending`, full tool call payload, the
   conversation context needed to show a human what's being proposed) and
   returns a `tool_result` to Claude stating the action is pending approval —
   the model should tell the (internal) team member or wrap up gracefully,
   never claim the action already happened. A human approves/rejects via the
   web dashboard (SIS-01's bitácora view); on approval, a worker executes the
   original tool call and appends the result to both `approval_queue` and
   `audit_log`; on rejection, only the log entry (rejected, with reason) is
   written.
4. **Audit log is append-only and complete** (SEG-11): log every inbound
   message, every outbound message, every tool call and its classification
   and outcome, and every identity-resolution decision (which client/scope a
   conversation was resolved to) — the last one matters specifically for
   proving SEG-05–SEG-07 compliance after the fact, not just for debugging.
5. This pattern needs no framework — it's two tables and one `if` in the tool-
   execution step of the loop in §2. It composes cleanly with whatever queue/
   worker mechanism the rest of Genzia's backend already uses for async jobs
   (e.g. a Postgres-backed job queue is enough; don't add Kafka/SQS/Redis
   Streams for this specific need unless the broader stack already has one).
