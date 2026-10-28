ALTER TABLE cloudkit_chat_relay_leases
  ADD COLUMN fencing_token INTEGER NOT NULL DEFAULT 0;

UPDATE cloudkit_chat_relay_leases
SET fencing_token = CASE WHEN fencing_token < 1 THEN 1 ELSE fencing_token END;
