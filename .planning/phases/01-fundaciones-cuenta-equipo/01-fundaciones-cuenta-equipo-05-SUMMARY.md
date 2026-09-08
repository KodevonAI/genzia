---
phase: 01-fundaciones-cuenta-equipo
plan: 05
subsystem: legal-compliance
tags: [meta-tech-provider, business-verification, corporate-structure, non-code, external-tracks]
requires:
  - PROJECT.md ("Integración directa con Meta" y "Consideraciones legales / estructura corporativa")
  - ROADMAP.md (Fase 1, "Dependencias críticas fuera del desarrollo")
provides:
  - META-BUSINESS-VERIFICATION-CHECKLIST.md
  - CORPORATE-STRUCTURE-LEGAL-QUESTIONS.md
  - Confirmation that both external critical-path tracks (Meta Business
    Verification, corporate-structure legal consultation) are in motion
affects:
  - "Fase 3 (Integración con WhatsApp / Meta) — real agency onboarding depends
    on Meta Business Verification progressing on this track"
  - "Any future plan that finalizes Terms of Service — depends on the legal
    consultation's answer to question 6"
tech-stack:
  added: []
  patterns: []
key-files:
  created:
    - .planning/phases/01-fundaciones-cuenta-equipo/META-BUSINESS-VERIFICATION-CHECKLIST.md
    - .planning/phases/01-fundaciones-cuenta-equipo/CORPORATE-STRUCTURE-LEGAL-QUESTIONS.md
    - .planning/phases/01-fundaciones-cuenta-equipo/01-fundaciones-cuenta-equipo-05-SUMMARY.md
  modified:
    - .planning/STATE.md
decisions: []
metrics:
  duration: "single session"
  completed: "2026-09-08"
---

# Phase 01 Plan 05: Meta Business Verification checklist + corporate-structure legal questions Summary

Produced the two reference documents Kodevon needs to drive Fase 1's non-code
critical-path tracks, and confirmed the human has actually started both.

## What was done

This plan is entirely non-code: it exists to turn two vague external to-dos
("start Meta verification", "get legal advice") flagged as launch-blocking
risks in `PROJECT.md` and `ROADMAP.md` into concrete, actionable artifacts —
then confirm the human actually acted on them.

### 1. `META-BUSINESS-VERIFICATION-CHECKLIST.md`

A step-by-step checklist for Genzia/Kodevon becoming a Meta WhatsApp Tech
Provider, covering: Meta Business Manager setup, the concrete Business
Verification document set (legal registration, proof of address, phone
verification, domain ownership), domain verification mechanics (DNS TXT vs.
HTML file), the Tech Provider Program application itself (with an explicit
"weeks, not days" timeline expectation per `research/STACK-AGENT.md` §5), and
a note that Embedded Signup v4 (Fase 3, development work) is a separate
dependency this checklist does not block. Opens with an explicit gate: steps
that submit entity-specific documents (legal docs, program application) cannot
run until the corporate-structure question is resolved; entity-independent
prep (Business Manager basics, domain access) can proceed in parallel.

### 2. `CORPORATE-STRUCTURE-LEGAL-QUESTIONS.md`

A six-question set for a corporate/tech lawyer, translated directly from
`PROJECT.md`'s "Consideraciones legales" section — liability contamination
between Kodevon's business lines, the cost/risk of separating the Tech
Provider relationship into a new entity later (the crux question, asked as a
hypothesis to confirm/correct rather than assumed true), accounting/fiscal
mixing, a direct recommendation on incorporating Genzia as its own SAS before
verification starts, a minimum-viable interim safeguard if that's not
feasible in time, and the required Terms of Service disclosure language.
Self-contained with inline context per question so counsel can answer without
reading any other Genzia document.

### 3. External tracks confirmed started (Task 3 — checkpoint:human-action)

The human confirmed directly: **"Ya arranqué la verificación ante Meta y le
escribí al abogado."** Both tracks are in motion:

- **Meta Business Verification**: started, using
  `META-BUSINESS-VERIFICATION-CHECKLIST.md` as the guide.
- **Corporate-structure legal consultation**: counsel has been contacted using
  `CORPORATE-STRUCTURE-LEGAL-QUESTIONS.md`.

Per this plan's own design (`must_haves.truths`), this checkpoint required
confirmation that both tracks were **started**, not completed — ongoing
progress and the eventual legal answer are follow-up work outside this plan's
scope, tracked in `STATE.md`'s pending list, not in this repo as a live
tracker.

## Deviations from Plan

None — plan executed exactly as written. No bugs, missing functionality, or
blockers encountered; both documents were produced as specified and the
checkpoint resolved as designed.

## Checkpoints

**Task 3 (`checkpoint:human-action`)**: Claude cannot itself execute Meta's
Business Verification process or hire/consult a lawyer — both require direct
human action. The checkpoint asked the human to start both processes using
the two documents produced in Tasks 1–2. Human confirmed both started; no
further verification was required per the plan's own `<verify>` criterion
("Meta Business Verification prep has actually started (not just 'will
start')") and `must_haves.truths` ("actually started ... not just received
documents to start them someday").

## Next Phase Readiness

- Fase 3 (Integración con WhatsApp / Meta) can proceed with development
  against a test/sandbox Meta account regardless of verification status, per
  `ROADMAP.md` — real agency onboarding is what's gated on Meta's approval,
  not the coding work.
- The corporate-structure legal answer is still pending (consultation just
  started, not completed) — this must resolve before Meta Business
  Verification's entity-specific steps (document submission, Tech Provider
  Program application) are actually submitted, per the gate stated at the top
  of `META-BUSINESS-VERIFICATION-CHECKLIST.md`. Tracked as an open item in
  `STATE.md`.
- No blockers for other Fase 1 plans (01-04), which are independent of this
  plan's external-track work.
