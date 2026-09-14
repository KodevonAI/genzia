-- Phase 5 (CRM): seeds `agent_action_catalog` with the 4 new tool codes this
-- phase's agent tools need — one create, one update, one list, one get (see
-- the INSERT below for the exact codes).
--
-- D-08: create/update are internal agency data — no client-facing impact,
-- no money moved — so both get the lowest risk tier, same posture as
-- `payment_reminder` in 0008.
--
-- D-17: list/get are read-only, but `classifyAndExecute` runs unconditionally
-- for every `tool_use`; a read tool with no catalog row would be rejected
-- outright. Seeding all 4 at the lowest risk tier is the simplest consistent
-- choice, per RESEARCH.md's Open Question #1's own recommendation.

INSERT INTO agent_action_catalog (code, label, risk_level) VALUES
      ('create_client', 'Dar de alta un cliente nuevo',   'low'),
      ('update_client', 'Editar los datos de un cliente', 'low'),
      ('list_clients',  'Buscar o listar clientes',       'low'),
      ('get_client',    'Consultar la ficha de un cliente', 'low')
ON CONFLICT (code) DO NOTHING;
