-- Consolidate Lisa Montgomery's order history into her original customer record (cust-lisa).
-- * Folds in the duplicate card created by the Customer Portal (same phone, "Lisa Machell Montgomery" / "Lisa Montgomery").
-- * Restores her deleted order ORD-2026-1022 to the order list and her history.
-- Safe to run repeatedly: nothing changes once everything is merged.
DO $$
DECLARE
  d jsonb;
  primary_cust jsonb;
  dups jsonb;
  restored jsonb;
  hist jsonb;
  new_customers jsonb;
  new_orders jsonb;
BEGIN
  SELECT data INTO d FROM suite_state WHERE id = 1;
  IF d IS NULL THEN RETURN; END IF;

  SELECT c INTO primary_cust FROM jsonb_array_elements(COALESCE(d->'customers', '[]')) c WHERE c->>'id' = 'cust-lisa';
  IF primary_cust IS NULL THEN RETURN; END IF;

  -- Other customer cards for the same person.
  SELECT COALESCE(jsonb_agg(c), '[]') INTO dups
  FROM jsonb_array_elements(COALESCE(d->'customers', '[]')) c
  WHERE c->>'id' <> 'cust-lisa'
    AND regexp_replace(regexp_replace(COALESCE(c->>'phone', ''), '\D', '', 'g'), '^1(?=\d{10}$)', '') = '2032746726'
    AND lower(c->>'name') ~ '^\s*lisa\s+(.*\s+)?montgomery\s*$';

  -- Her deleted / hidden order.
  SELECT e->'data' INTO restored
  FROM (SELECT jsonb_array_elements(COALESCE(d->'deletedItemsStack', '[]')) e
        UNION ALL SELECT jsonb_array_elements(COALESCE(d->'hiddenItems', '[]'))) x
  WHERE e->>'kind' = 'order' AND e->'data'->>'id' = 'ORD-2026-1022'
  LIMIT 1;

  -- Combined history, one entry per order, newest first.
  WITH entries AS (
    SELECT h, 0 AS src FROM jsonb_array_elements(COALESCE(primary_cust->'history', '[]')) h
    UNION ALL
    SELECT h, 1 FROM jsonb_array_elements(dups) c, jsonb_array_elements(COALESCE(c->'history', '[]')) h
    UNION ALL
    SELECT jsonb_build_object(
      'orderId', restored->>'id',
      'date', restored->>'deliveryDate',
      'itemsSummary', (SELECT string_agg((i->>'name') || ' (x' || (i->>'qty') || ')', ', ') FROM jsonb_array_elements(restored->'items') i),
      'fulfillment', (restored->>'fulfillmentType') || ' — ' || (restored->>'destination'),
      'total', restored->'total',
      'paid', COALESCE(restored->'paid', 'false'::jsonb),
      'paymentMethod', restored->>'paymentMethod',
      'status', COALESCE(restored->>'status', 'Pending')
    ), 2 WHERE restored IS NOT NULL
  ), uniq AS (
    SELECT DISTINCT ON (h->>'orderId') h FROM entries ORDER BY h->>'orderId', src
  )
  SELECT COALESCE(jsonb_agg(h ORDER BY h->>'date' DESC, h->>'orderId' DESC), '[]') INTO hist FROM uniq;

  IF jsonb_array_length(dups) = 0 AND restored IS NULL AND hist = COALESCE(primary_cust->'history', '[]') THEN RETURN; END IF;

  primary_cust := jsonb_set(primary_cust, '{history}', hist);
  -- Keep the saved delivery profile from the portal card so her details still fill in automatically.
  IF primary_cust->'profile' IS NULL THEN
    SELECT primary_cust || jsonb_build_object('profile', c->'profile') INTO primary_cust
    FROM jsonb_array_elements(dups) c WHERE c->'profile' IS NOT NULL LIMIT 1;
  END IF;

  SELECT COALESCE(jsonb_agg(CASE WHEN c->>'id' = 'cust-lisa' THEN primary_cust ELSE c END ORDER BY ord), '[]') INTO new_customers
  FROM jsonb_array_elements(d->'customers') WITH ORDINALITY t(c, ord)
  WHERE NOT (dups @> jsonb_build_array(c));

  new_orders := COALESCE(d->'orders', '[]');
  IF restored IS NOT NULL AND NOT EXISTS (SELECT 1 FROM jsonb_array_elements(new_orders) o WHERE o->>'id' = 'ORD-2026-1022') THEN
    new_orders := new_orders || jsonb_build_array(restored);
  END IF;

  d := d || jsonb_build_object(
    'customers', new_customers,
    'orders', new_orders,
    'deletedItemsStack', (SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]') FROM jsonb_array_elements(COALESCE(d->'deletedItemsStack', '[]')) WITH ORDINALITY t(e, ord)
                          WHERE NOT (e->>'kind' = 'order' AND e->'data'->>'id' = 'ORD-2026-1022')),
    'hiddenItems', (SELECT COALESCE(jsonb_agg(e ORDER BY ord), '[]') FROM jsonb_array_elements(COALESCE(d->'hiddenItems', '[]')) WITH ORDINALITY t(e, ord)
                    WHERE NOT (e->>'kind' = 'order' AND e->'data'->>'id' = 'ORD-2026-1022'))
  );

  UPDATE suite_state SET data = d, revision = revision + 1 WHERE id = 1;
END $$;
