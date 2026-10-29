-- Opt-in health tracking: weigh-ins, meals and drinks (with optional macros), saved recipes, activity,
-- daily habits and supplements.
-- Additive only. Nothing exists for a person until they turn Health on (health_profiles holds their
-- consent). Every row belongs to one account and is erased with it (ON DELETE CASCADE). Health entries
-- are never sent to an AI model; the Goblin logs them with its own rules.
PRAGMA foreign_keys = ON;

CREATE TABLE health_profiles (
  user_id TEXT PRIMARY KEY NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consented_at TEXT NOT NULL,
  consent_version INTEGER NOT NULL DEFAULT 1,
  units TEXT NOT NULL DEFAULT 'metric' CHECK (units IN ('metric', 'imperial')),
  goal_weight_kg REAL CHECK (goal_weight_kg IS NULL OR goal_weight_kg BETWEEN 30 AND 300),
  weekly_activity_minutes INTEGER NOT NULL DEFAULT 150 CHECK (weekly_activity_minutes BETWEEN 0 AND 2000),
  daily_calorie_goal INTEGER CHECK (daily_calorie_goal IS NULL OR daily_calorie_goal BETWEEN 1200 AND 6000),
  protein_goal_g INTEGER CHECK (protein_goal_g IS NULL OR protein_goal_g BETWEEN 0 AND 600),
  carbs_goal_g INTEGER CHECK (carbs_goal_g IS NULL OR carbs_goal_g BETWEEN 0 AND 1000),
  fat_goal_g INTEGER CHECK (fat_goal_g IS NULL OR fat_goal_g BETWEEN 0 AND 500),
  water_glasses INTEGER NOT NULL DEFAULT 8 CHECK (water_glasses BETWEEN 0 AND 30),
  veg_serves INTEGER NOT NULL DEFAULT 5 CHECK (veg_serves BETWEEN 0 AND 20),
  fruit_serves INTEGER NOT NULL DEFAULT 2 CHECK (fruit_serves BETWEEN 0 AND 20),
  sleep_hours REAL NOT NULL DEFAULT 7 CHECK (sleep_hours BETWEEN 0 AND 14),
  hide_numbers INTEGER NOT NULL DEFAULT 0 CHECK (hide_numbers IN (0, 1)),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

-- One weigh-in per local day (a second one that day replaces it). Weight is always stored in kg.
CREATE TABLE health_weigh_ins (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  weight_kg REAL CHECK (weight_kg IS NULL OR weight_kg BETWEEN 20 AND 400),
  waist_cm REAL CHECK (waist_cm IS NULL OR waist_cm BETWEEN 30 AND 300),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (weight_kg IS NOT NULL OR waist_cm IS NOT NULL),
  UNIQUE (user_id, day)
);

-- A person's own recipes and regular meals, with nutrition PER SERVING (from a recipe link's published
-- data, a nutrition panel, or typed in). Logging one copies the numbers, so editing or removing a recipe
-- never changes what was already eaten.
CREATE TABLE health_recipes (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  source_url TEXT,
  servings INTEGER CHECK (servings IS NULL OR servings BETWEEN 1 AND 100),
  calories INTEGER CHECK (calories IS NULL OR calories BETWEEN 0 AND 10000),
  protein_g REAL CHECK (protein_g IS NULL OR protein_g BETWEEN 0 AND 1000),
  carbs_g REAL CHECK (carbs_g IS NULL OR carbs_g BETWEEN 0 AND 1000),
  fat_g REAL CHECK (fat_g IS NULL OR fat_g BETWEEN 0 AND 1000),
  sat_fat_g REAL CHECK (sat_fat_g IS NULL OR sat_fat_g BETWEEN 0 AND 1000),
  sugars_g REAL CHECK (sugars_g IS NULL OR sugars_g BETWEEN 0 AND 1000),
  fibre_g REAL CHECK (fibre_g IS NULL OR fibre_g BETWEEN 0 AND 1000),
  sodium_mg INTEGER CHECK (sodium_mg IS NULL OR sodium_mg BETWEEN 0 AND 50000),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_health_recipes_user ON health_recipes(user_id);

-- What was eaten: the numbers are totals for the servings eaten (all optional).
CREATE TABLE health_meals (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  meal TEXT NOT NULL CHECK (meal IN ('breakfast', 'lunch', 'dinner', 'snack', 'drink')),
  description TEXT NOT NULL,
  recipe_id TEXT REFERENCES health_recipes(id) ON DELETE SET NULL,
  servings REAL NOT NULL DEFAULT 1 CHECK (servings > 0 AND servings <= 20),
  calories INTEGER CHECK (calories IS NULL OR calories BETWEEN 0 AND 10000),
  protein_g REAL CHECK (protein_g IS NULL OR protein_g BETWEEN 0 AND 1000),
  carbs_g REAL CHECK (carbs_g IS NULL OR carbs_g BETWEEN 0 AND 1000),
  fat_g REAL CHECK (fat_g IS NULL OR fat_g BETWEEN 0 AND 1000),
  sat_fat_g REAL CHECK (sat_fat_g IS NULL OR sat_fat_g BETWEEN 0 AND 1000),
  sugars_g REAL CHECK (sugars_g IS NULL OR sugars_g BETWEEN 0 AND 1000),
  fibre_g REAL CHECK (fibre_g IS NULL OR fibre_g BETWEEN 0 AND 1000),
  sodium_mg INTEGER CHECK (sodium_mg IS NULL OR sodium_mg BETWEEN 0 AND 50000),
  caffeine_mg INTEGER CHECK (caffeine_mg IS NULL OR caffeine_mg BETWEEN 0 AND 2000),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_health_meals_user_day ON health_meals(user_id, day);

CREATE TABLE health_activities (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  kind TEXT NOT NULL,
  minutes INTEGER CHECK (minutes IS NULL OR minutes BETWEEN 1 AND 1440),
  steps INTEGER CHECK (steps IS NULL OR steps BETWEEN 1 AND 200000),
  intensity TEXT NOT NULL DEFAULT 'moderate' CHECK (intensity IN ('light', 'moderate', 'vigorous')),
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  CHECK (minutes IS NOT NULL OR steps IS NOT NULL)
);
CREATE INDEX idx_health_activities_user_day ON health_activities(user_id, day);

-- Running daily totals for the four habits (water in glasses, veg and fruit in serves, sleep in hours).
CREATE TABLE health_habit_days (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  habit TEXT NOT NULL CHECK (habit IN ('water', 'veg', 'fruit', 'sleep')),
  amount REAL NOT NULL CHECK (amount BETWEEN 0 AND 100),
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  PRIMARY KEY (user_id, day, habit)
);

-- The person's own supplements, as they describe them (no product database, no dosing advice).
CREATE TABLE health_supplements (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  dose TEXT,
  doses_per_day INTEGER NOT NULL DEFAULT 1 CHECK (doses_per_day BETWEEN 1 AND 6),
  caffeine_mg INTEGER CHECK (caffeine_mg IS NULL OR caffeine_mg BETWEEN 0 AND 1000),
  archived_at TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_health_supplements_user ON health_supplements(user_id);

CREATE TABLE health_supplement_doses (
  id TEXT PRIMARY KEY NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  supplement_id TEXT NOT NULL REFERENCES health_supplements(id) ON DELETE CASCADE,
  day TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
CREATE INDEX idx_health_doses_user_day ON health_supplement_doses(user_id, day);
