DELETE older
FROM courier_locations older
JOIN courier_locations newer
  ON newer.courier_id = older.courier_id
  AND (newer.created_at > older.created_at OR (newer.created_at = older.created_at AND newer.id > older.id));

ALTER TABLE courier_locations ADD UNIQUE KEY uq_courier_locations_courier (courier_id);
