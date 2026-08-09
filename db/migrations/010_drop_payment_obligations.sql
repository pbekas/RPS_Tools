-- Routine payments stay on the contract cost fields, not the obligation calendar.
DELETE FROM contract_obligations WHERE kind = 'payment';
