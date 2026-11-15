-- The usage counts. The table was made by hand before migrations were used,
-- so this only makes it where it is missing.
CREATE TABLE IF NOT EXISTS counts (
  day TEXT,
  metric TEXT,
  value TEXT,
  n INTEGER NOT NULL,
  PRIMARY KEY (day, metric, value)
);
