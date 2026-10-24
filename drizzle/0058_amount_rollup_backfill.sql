-- S1-5 backfill: an opportunity with product lines in its own org stores
-- Amount = sum of quantity × unit price (integer cents). Idempotent. A sum
-- beyond the safe-integer range is left unchanged, as the app refuses it.
UPDATE `opportunities` SET `amount_cents` = CAST(`t`.`total` AS INTEGER)
FROM (
	SELECT `org_id`, `opportunity_id`, TOTAL(`quantity` * `unit_price_cents`) AS `total`
	FROM `opportunity_line_items`
	GROUP BY `org_id`, `opportunity_id`
) AS `t`
WHERE `t`.`org_id` = `opportunities`.`org_id`
	AND `t`.`opportunity_id` = `opportunities`.`id`
	AND `t`.`total` <= 9007199254740991
	AND `opportunities`.`amount_cents` IS NOT CAST(`t`.`total` AS INTEGER);
