CREATE TABLE IF NOT EXISTS observation_studies (
  id TEXT PRIMARY KEY, plan_id TEXT NOT NULL UNIQUE REFERENCES plans(id),
  question TEXT NOT NULL CHECK(length(trim(question)) BETWEEN 1 AND 2000),
  first_rule TEXT NOT NULL CHECK(length(trim(first_rule)) BETWEEN 1 AND 2000),
  rules_json TEXT NOT NULL CHECK(json_valid(rules_json)),
  record_origin TEXT NOT NULL CHECK(record_origin IN ('user','synthetic')), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS observation_days (
  id TEXT PRIMARY KEY, study_id TEXT NOT NULL REFERENCES observation_studies(id),
  ordinal INTEGER NOT NULL CHECK(ordinal BETWEEN 1 AND 5), date TEXT NOT NULL,
  count INTEGER NOT NULL CHECK(count >= 0),
  contribution_json TEXT NOT NULL CHECK(json_valid(contribution_json)),
  note TEXT NOT NULL CHECK(length(note)<=4000), created_at TEXT NOT NULL,
  UNIQUE(study_id,ordinal), UNIQUE(study_id,date)
) STRICT;
CREATE TABLE IF NOT EXISTS observation_changes (
  id TEXT PRIMARY KEY, study_id TEXT NOT NULL UNIQUE REFERENCES observation_studies(id),
  day_one_id TEXT NOT NULL REFERENCES observation_days(id), day_two_id TEXT NOT NULL REFERENCES observation_days(id),
  previous_rule TEXT NOT NULL, next_rule TEXT NOT NULL CHECK(length(trim(next_rule)) BETWEEN 1 AND 2000),
  reason TEXT NOT NULL CHECK(length(trim(reason)) BETWEEN 1 AND 4000), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS migration_receipts (
  id TEXT PRIMARY KEY, source_digest TEXT NOT NULL UNIQUE, source_exported_at TEXT,
  counts_json TEXT NOT NULL CHECK(json_valid(counts_json)), created_at TEXT NOT NULL
) STRICT;
CREATE TABLE IF NOT EXISTS observation_checks (
  id TEXT PRIMARY KEY, study_id TEXT NOT NULL UNIQUE REFERENCES observation_studies(id),
  hand_sum INTEGER NOT NULL CHECK(hand_sum>=0), hand_mean TEXT NOT NULL,
  note TEXT NOT NULL CHECK(length(trim(note)) BETWEEN 1 AND 4000), created_at TEXT NOT NULL
) STRICT;
