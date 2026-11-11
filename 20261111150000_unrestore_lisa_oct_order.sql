-- Lisa Montgomery has 3 orders (2 completed, 1 pending). Order ORD-2026-1022 was deleted on purpose,
-- so take it back out of her history and the order list and return it to Recently Deleted.
-- Safe to run repeatedly.
DO $$
DECLARE
  d jsonb;
  ord jsonb;
  pos int;
BEGIN
  SELECT data INTO d FROM suite_state WHERE id = 1;
  IF d IS NULL THEN RETURN; END IF;

  SELECT o, (n - 1)::int INTO ord, pos
  FROM jsonb_array_elements(COALESCE(d->'orders', '[]')) WITH ORDINALITY t(o, n)
  WHERE o->>'id' = 'ORD-2026-1022' LIMIT 1;

  IF ord IS NULL AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(d->'customers', '[]')) c, jsonb_array_elements(COALESCE(c->'history', '[]')) h
    WHERE h->>'orderId' = 'ORD-2026-1022'
  ) THEN RETURN; END IF;

  d := d || jsonb_build_object(
    'orders', (SELECT COALESCE(jsonb_agg(o ORDER BY n), '[]') FROM jsonb_array_elements(COALESCE(d->'orders', '[]')) WITH ORDINALITY t(o, n)
               WHERE o->>'id' <> 'ORD-2026-1022'),
    'customers', (SELECT COALESCE(jsonb_agg(
                    CASE WHEN jsonb_typeof(c->'history') = 'array' THEN jsonb_set(c, '{history}',
                      (SELECT COALESCE(jsonb_agg(h ORDER BY m), '[]') FROM jsonb_array_elements(c->'history') WITH ORDINALITY u(h, m)
                       WHERE h->>'orderId' <> 'ORD-2026-1022'))
                    ELSE c END ORDER BY n), '[]')
                  FROM jsonb_array_elements(COALESCE(d->'customers', '[]')) WITH ORDINALITY t(c, n))
  );

  IF ord IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(COALESCE(d->'deletedItemsStack', '[]')) e WHERE e->'data'->>'id' = 'ORD-2026-1022'
  ) THEN
    d := jsonb_set(d, '{deletedItemsStack}', jsonb_build_array(jsonb_build_object(
      'kind', 'order', 'label', 'Order ORD-2026-1022 (Lisa Montgomery)', 'data', ord, 'index', pos
    )) || COALESCE(d->'deletedItemsStack', '[]'));
  END IF;

  UPDATE suite_state SET data = d, revision = revision + 1 WHERE id = 1;
END $$;
