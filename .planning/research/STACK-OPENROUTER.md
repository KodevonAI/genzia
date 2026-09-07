# STACK-OPENROUTER.md — Genzia

Follow-up to `STACK-AGENT.md`, triggered by a product-owner requirement: the LLM
provider must not be hardcoded to Anthropic — consume models via **OpenRouter**
so the underlying model can be swapped over time. This document keeps
`STACK-AGENT.md`'s model and orchestration recommendations largely intact and
specifies *how* to route them through OpenRouter without giving up the
architectural properties that recommendation was built on (SEG-05, SEG-10,
SEG-11).

## 1. How OpenRouter actually works (verified, 2026)

OpenRouter is a proxy in front of ~dozens of providers, exposed **two ways**:

- **OpenAI-compatible `chat/completions`** — the default, widely-documented
  surface. Tools use OpenAI's `{type:"function", function:{...}}` schema,
  system prompt is a `{"role":"system"}` message inside `messages[]`, tool
  results are `{"role":"tool", tool_call_id}` messages, streaming is OpenAI-shaped
  SSE (`choices[0].delta.tool_calls[].function.arguments` as partial JSON).
- **An Anthropic-Messages-API-compatible endpoint** (OpenRouter calls this the
  "Anthropic Skin" — `base_url: https://openrouter.ai/api` used with the
  Anthropic SDK/`ANTHROPIC_BASE_URL`). This accepts the *native* Anthropic
  wire format — top-level `system`, `tool_use`/`tool_result` content blocks,
  `cache_control` blocks — and OpenRouter does model mapping underneath it.

Verified specifics:

- **Pricing**: no per-token markup on model usage — OpenRouter passes through
  provider list price. The real cost is a **~5.5% fee on credit-card credit
  purchases** ($0.80 minimum), 5% on crypto, and 5% on BYOK traffic only past
  $25K/month of list-price usage. Budget ~5% total overhead, not a 20%+ tax.
- **Tool calling**: OpenRouter normalizes the *interface* so the same request
  shape works across providers, but does **not** normalize *reliability* —
  it publishes a per-model "Tool Call Error Rate" precisely because that
  varies by underlying model. OpenRouter doesn't make a weaker model's
  tool-calling as trustworthy as Claude's; it only removes SDK friction to
  swap.
- **Prompt caching**: supported for Anthropic models, but **only through the
  Anthropic-native passthrough**. Through the OpenAI-compatible endpoint, the
  system prompt is sent as an in-`messages[]` message rather than a top-level
  block, so Anthropic's cache infrastructure never sees a `cache_control`
  marker to hang a cache entry on — this is a documented, currently-live gap
  (multiple open issues against agent tools that hit this in practice), not a
  hypothetical. This is decisive for Genzia: per-message context reload is
  exactly what caching was chosen to make cheap.
- **Streaming**: works, matches the declared wire format (OpenAI SSE shape on
  the compat endpoint, Anthropic SSE event shape on the passthrough) — no gap
  vs. calling either provider directly.

## 2. Architecture impact: adopt the Anthropic-passthrough endpoint, not the OpenAI-compatible one

**Recommendation: keep the Anthropic Messages API shape everywhere. Point the
existing Anthropic SDK client at OpenRouter's Anthropic-compatible base URL
instead of Anthropic's own, and change nothing else in `STACK-AGENT.md` §2/§6.**

Concretely, what changes and what doesn't:

- **Unchanged**: the hand-rolled loop (`while stop_reason === "tool_use"`),
  tool definitions (`{name, description, input_schema}`), `tool_use`/
  `tool_result` content blocks, the `buildContext(conversationId)` function,
  the tool-execution interceptor that classifies risk and writes to
  `audit_log`/`approval_queue` before executing, and — critically —
  `cache_control` breakpoints, since the passthrough preserves Anthropic's
  native caching semantics. This is the entire point of choosing this
  endpoint: OpenRouter becomes a routing layer *behind* the SDK client, not a
  reason to rewrite the security-critical context-building function.
- **Changed**: only the client construction (`baseURL` + OpenRouter API key
  instead of Anthropic's), and the `model` string passed per call, which now
  needs to resolve through a small model-selection table instead of being a
  literal constant.
- **Do not** build the interceptor/loop against the OpenAI-compatible
  endpoint as the default path. That format is a genuinely different shape —
  different tool schema, different message accumulation for tool results,
  different streaming delta events — and it is also the format that silently
  drops prompt caching for Claude. Reserve it only as an escape hatch for a
  specific non-Claude model that the Anthropic-skin mapping doesn't handle
  well (verify per-model before promoting it into production use).

## 3. Model recommendation: keep Sonnet 5 + Haiku 4.5 as defaults, but make the choice a config value, not a constant

OpenRouter doesn't change *which* model is safest for Genzia's core loop — it
changes how cheap it is to change that choice later. Two things point the
same direction:

- OpenRouter's pass-through pricing means routing Sonnet 5 through OpenRouter
  costs materially the same as calling Anthropic directly (plus the ~5%
  credit-purchase fee) — there's no cost argument for defaulting to a
  different model.
- Tool-calling reliability, not raw benchmark score, is still Genzia's
  binding constraint (SEG-10), and OpenRouter explicitly does not equalize
  that across models.

**Recommendation: no change to the default model split** — `claude-sonnet-5`
for every turn that resolves identity, classifies risk, or calls a tool;
`claude-haiku-4-5` for cheap sub-tasks (summarization, draft generation,
intent routing) that never reach a client-facing tool call. What *should*
change is structural: replace the hardcoded model string with a one-file
`MODEL_FOR_TASK` map (`{main: "anthropic/claude-sonnet-5", cheap:
"anthropic/claude-haiku-4-5"}`) read at call time. That map is where
OpenRouter's value actually shows up — a place to trial a cheaper or newer
model for the low-stakes `cheap` slot without touching the agent loop, and to
swap `main` later if a future model clearly surpasses Sonnet on tool-call
reliability, without an SDK migration.

## 4. Trade-offs to flag honestly

- **Reliability**: OpenRouter publishes no SLA and offers no downtime
  credits. 2026 has seen a handful of documented outages (~35–50 minutes
  each, one caused by a bug in *their own caching layer* — notable given
  caching is why Genzia needs the passthrough path in the first place).
  Treat OpenRouter as a real added dependency, not a transparent wrapper.
- **Mitigation is nearly free here**: because the passthrough keeps Genzia's
  request shape identical to native Anthropic, a direct-to-Anthropic fallback
  is a `baseURL`/API-key swap, not a second implementation. **Recommendation:
  call through OpenRouter by default, with direct Anthropic API access kept
  live as a coded fallback** the request loop switches to on sustained
  OpenRouter failure (a few consecutive 5xx/timeouts) — cheap insurance for a
  WhatsApp-facing product where "the agent is down" is client-visible.
- **Rate limits** are per underlying provider, not a single OpenRouter
  ceiling — configure OpenRouter's `models: [...]` priority fallback list for
  the `cheap` slot (where model quality varies less), but keep the `main`
  Sonnet slot pinned rather than letting it silently fail over to a weaker
  model mid-conversation, which would undermine the tool-calling reliability
  guarantee the whole architecture depends on.
- **Net recommendation**: default 100% through OpenRouter (Anthropic-passthrough
  shape) for the product requirement's sake, with a coded direct-Anthropic
  fallback for resilience — not a permanent split traffic architecture, which
  would double the operational surface for marginal benefit today.
