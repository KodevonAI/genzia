-- First seed-data migration in this repo — 0000 through 0007 are pure DDL
-- (schema + RLS + triggers), never rows.
--
-- This is the static catalog half of SEG-10 (D-01): there is no
-- classification engine, no approval queue and no UI in Phase 2; a Phase 4
-- plan reads these rows to decide auto-execute vs. human approval. Seeds
-- exactly the three action types D-02 fixes, no more (Phase 4 adds types as
-- the agent needs them; inventing extras now would be scope creep into
-- Phase 4's engine). Do NOT add a `risk_level` for any action type the agent
-- cannot yet perform.

INSERT INTO agent_action_catalog (code, label, risk_level) VALUES
      ('payment_reminder',       'Recordatorio de pago al cliente',            'low'),
      ('reschedule_appointment', 'Reagendar una cita del cliente',             'high'),
      ('new_client_content',     'Enviar contenido nuevo hacia el cliente',    'high')
ON CONFLICT (code) DO NOTHING;
