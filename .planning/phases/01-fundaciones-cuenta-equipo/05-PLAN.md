---
phase: 01-fundaciones-cuenta-equipo
plan: 05
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/phases/01-fundaciones-cuenta-equipo/META-BUSINESS-VERIFICATION-CHECKLIST.md
  - .planning/phases/01-fundaciones-cuenta-equipo/CORPORATE-STRUCTURE-LEGAL-QUESTIONS.md
autonomous: false
must_haves:
  truths:
    - "By the end of this plan, there exists a concrete, actionable document listing exactly what Meta Business Verification requires — no ambiguity left for whoever executes the trámite."
    - "By the end of this plan, there exists a concrete list of the specific legal questions a corporate/tech lawyer must answer before Genzia commits to an entity for the Meta Tech Provider relationship."
    - "The human owner has actually started both external tracks (engaged counsel, begun Meta verification) — not just received documents to start them someday."
  artifacts:
    - "META-BUSINESS-VERIFICATION-CHECKLIST.md — document list, account/domain prerequisites, Tech Provider Program application steps, and the explicit dependency on the corporate-structure decision"
    - "CORPORATE-STRUCTURE-LEGAL-QUESTIONS.md — the exact question set derived from PROJECT.md's 'Consideraciones legales' section, ready to hand to counsel as-is"
  key_links:
    - "Corporate structure decision -> which entity's documents go into the Meta verification checklist — starting Meta verification under the wrong entity before the legal question is resolved is exactly the costly-to-undo mistake ROADMAP.md flags ('la verificación ante Meta quede atada a la entidad equivocada'); the checklist must make this ordering dependency explicit, not just list documents in isolation."
---

<objective>
Produce the two concrete documents Kodevon needs to kick off Fase 1's non-blocking
critical-path tracks — Meta Business Verification and the corporate-structure
legal consultation — and get the human to actually start both. Neither is
something Claude can execute (a government/Meta verification process, hiring and
consulting a lawyer), but the research and drafting work that makes those
processes fast and unambiguous once started is exactly what Claude can and should
do.

Purpose: PROJECT.md and ROADMAP.md are explicit that these two tracks are the real
bottleneck risk for launch — they must start in Fase 1, in parallel with
development, not be discovered as blockers later. This plan exists so "start
Meta verification" and "get legal advice" are not vague to-dos but a checklist
and a question list ready to act on immediately.

Output: two reference documents in this phase's directory, and a checkpoint
confirming the human has actually begun both processes using them.
</objective>

<execution_context>
@./.claude/get-shit-done/workflows/execute-plan.md
@./.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/PROJECT.md
@.planning/REQUIREMENTS.md
@.planning/ROADMAP.md
@.planning/research/STACK-AGENT.md
</context>

<tasks>

<task type="auto">
  <name>Task 1: Draft the Meta Business Verification checklist</name>
  <files>.planning/phases/01-fundaciones-cuenta-equipo/META-BUSINESS-VERIFICATION-CHECKLIST.md</files>
  <action>
    Write a concrete, actionable checklist covering everything PROJECT.md
    ("Integración directa con Meta") and STACK-AGENT.md §5 describe as
    prerequisites for Genzia/Kodevon becoming a Meta Tech Provider, organized
    so a non-technical person can execute it step by step:
    - **Entity decision gate**: the very first line must state that this
      checklist cannot be finalized (specifically: whose legal documents get
      submitted) until the corporate-structure question in Task 2's document is
      resolved — link the two documents explicitly, don't let this checklist
      imply it can run fully independently.
    - **Meta Business Manager setup**: creating/verifying the Meta Business
      Manager account for the chosen entity.
    - **Business verification documents**: the standard Meta Business
      Verification document set (legal business registration/incorporation
      documents, proof of business address, business phone number verification,
      and — critically, per PROJECT.md — proof of domain ownership for a
      domain the business controls). List these as concrete document types,
      not "relevant paperwork."
    - **Domain verification**: what's needed to verify a domain Kodevon/Genzia
      owns (DNS TXT record or HTML file method) and why it matters for the
      Tech Provider application specifically.
    - **Tech Provider Program (formerly Solution Provider) application**: the
      registration step itself, noting (per STACK-AGENT.md) this is
      historically slow — set the expectation of weeks, not days, and that it
      should be submitted as early as possible once the entity question is
      settled.
    - **Embedded Signup / app review prerequisites**: note that building
      against Embedded Signup v4 (not v2, which is deprecated Oct 15 2026) is
      a development-side dependency (Fase 3), separate from this
      business-verification track, so it's clear this checklist doesn't block
      Fase 3's coding work, only real-agency usage of it.
    - **Timeline/ownership note**: who at Kodevon should own driving this
      forward, and that it should be tracked outside this repo (this is a
      one-time checklist, not a live tracker).
  </action>
  <verify>Document exists, is organized as an actionable checklist (not prose), and explicitly states its dependency on the corporate-structure decision from Task 2.</verify>
  <done>A person with no prior context on Meta's Tech Provider process could execute this checklist top to bottom without needing to go re-derive requirements from PROJECT.md themselves.</done>
</task>

<task type="auto">
  <name>Task 2: Draft the corporate-structure legal question list</name>
  <files>.planning/phases/01-fundaciones-cuenta-equipo/CORPORATE-STRUCTURE-LEGAL-QUESTIONS.md</files>
  <action>
    Write the specific question set for a corporate/tech lawyer, derived
    directly from PROJECT.md's "Consideraciones legales / estructura
    corporativa" section — do not invent new legal theories, translate that
    section's concerns into direct, answerable questions counsel can respond to
    in one sitting:
    1. **Liability contamination**: given Kodevon SAS would sign the Meta Tech
       Provider agreement, what is Kodevon's actual exposure if a Genzia-client
       agency misuses WhatsApp messaging or a Genzia end-client disputes
       something — and does that exposure reach Kodevon's other business lines
       that also depend on the same verified Meta Business Manager account?
    2. **Cost/risk of separating later**: concretely, how difficult/costly
       would it be to move the Tech Provider relationship and already-connected
       agencies' WhatsApp Business Accounts to a new legal entity after the
       fact, versus registering the correct entity from the start? (This is
       the crux question — PROJECT.md's stated hypothesis is that undoing this
       later is harder than doing it right now; ask counsel to confirm or
       correct that hypothesis, don't just assume it.)
    3. **Accounting/fiscal mixing**: implications of Genzia's SaaS revenue
       sitting inside the same entity that invoices Kodevon's agency/consulting
       services — tax, audit, or investor-readiness concerns.
    4. **Direct recommendation**: given Colombian SAS formation is comparatively
       fast/cheap, should Genzia be incorporated as its own SAS *before* Meta
       verification starts, or is there a valid reason to proceed under Kodevon
       SAS first?
    5. **Minimum viable interim step**: if incorporating a new SAS isn't
       feasible before verification must start, what is the minimum legal
       safeguard (e.g. specific Terms of Service language naming the operating
       entity, an internal agreement between Kodevon and a future Genzia
       entity) that keeps the door open to separate later without disrupting
       already-onboarded agencies?
    6. **Terms of Service disclosure**: confirm the minimum required language
       to disclose which entity operates Genzia, regardless of which entity is
       chosen (PROJECT.md already commits to this regardless of outcome — this
       question is about getting the exact required wording/placement right).
    Format as a numbered list a lawyer can respond to point by point, with a
    one-line context sentence under each question so counsel doesn't need to
    read PROJECT.md first.
  </action>
  <verify>Document exists as a self-contained question list; each question includes enough context to be answerable without the lawyer reading any other Genzia document first.</verify>
  <done>The question list is ready to send to counsel as-is, and directly traces back to every concern raised in PROJECT.md's legal section — nothing invented, nothing missing.</done>
</task>

<task type="checkpoint:human-action">
  <name>Task 3: Kick off both external tracks</name>
  <action>
    Human action (cannot be automated by Claude): (1) send
    CORPORATE-STRUCTURE-LEGAL-QUESTIONS.md to a corporate/tech lawyer and get
    the consultation scheduled or completed; (2) using
    META-BUSINESS-VERIFICATION-CHECKLIST.md, begin the Meta Business
    Verification process for whichever entity the legal consultation confirms
    (or, if the consultation is still pending, begin only the parts of the
    checklist that don't depend on the entity decision — e.g. domain
    verification prep — and hold the entity-specific document submission until
    the legal question resolves).
  </action>
  <verify>User confirms: legal consultation is scheduled/underway, and Meta Business Verification prep has actually started (not just "will start").</verify>
  <done>Both critical-path external tracks are demonstrably in motion, not merely documented.</done>
</task>

</tasks>

<verification>
Both markdown documents exist in this phase's directory and are internally
consistent with PROJECT.md's stated concerns (no invented requirements). The
human confirms both external processes have actually been initiated.
</verification>

<success_criteria>
- Meta Business Verification checklist and corporate-structure legal question
  list both exist, are concrete and immediately actionable, and correctly
  reflect their interdependency.
- Both external, non-dev critical-path tracks from ROADMAP.md are confirmed
  started — satisfying "iniciar el trámite... debe quedar marcada explícitamente
  como tarea temprana" without blocking any of Plans 01-04's development work.
</success_criteria>

<output>
After completion, create `.planning/phases/01-fundaciones-cuenta-equipo/01-fundaciones-cuenta-equipo-05-SUMMARY.md`
covering: the two documents produced, and the human-confirmed status of both
external tracks as of plan completion (in motion / blocked / needs follow-up).
</output>
