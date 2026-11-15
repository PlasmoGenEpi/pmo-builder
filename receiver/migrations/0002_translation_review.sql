-- Translation review. A link lets whoever holds it suggest changes to one
-- language's translation. Only a hash of the link's key is kept.
CREATE TABLE IF NOT EXISTS review_links (
  key_hash TEXT PRIMARY KEY,
  locale TEXT NOT NULL,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);

-- One reviewer's verdict on one message: the translation looks right
-- ('ok'), or should read as `text` ('edit'). `seen` is the translation the
-- reviewer was shown. `pulled_at` is set once the suggestion has been taken
-- into the catalogs with `pnpm translations pull`.
CREATE TABLE IF NOT EXISTS review_suggestions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  link TEXT NOT NULL REFERENCES review_links (key_hash),
  locale TEXT NOT NULL,
  reviewer TEXT NOT NULL,
  context TEXT NOT NULL,
  msgid TEXT NOT NULL,
  seen TEXT NOT NULL,
  verdict TEXT NOT NULL CHECK (verdict IN ('ok', 'edit')),
  text TEXT NOT NULL,
  created_at TEXT NOT NULL,
  pulled_at TEXT
);

CREATE INDEX IF NOT EXISTS review_suggestions_by_locale ON review_suggestions (locale, id);
CREATE INDEX IF NOT EXISTS review_suggestions_by_link ON review_suggestions (link);
