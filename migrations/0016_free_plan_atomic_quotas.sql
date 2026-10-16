-- Atomic Free plan quota enforcement: triggers fire within each D1 write.
-- Do not delete or archive existing records when an account downgrades.
-- Owner and active Premium entitlements are exempt.

CREATE TRIGGER free_tasks_insert BEFORE INSERT ON tasks
WHEN NEW.status = 'open' AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = NEW.user_id AND r.role = 'owner' AND r.revoked_at IS NULL) AND NOT EXISTS (SELECT 1 FROM user_entitlements e WHERE e.user_id = NEW.user_id AND e.ended_at IS NULL AND ( (e.entitlement = 'owner_premium' AND e.source = 'admin' AND e.status = 'active') OR (e.entitlement = 'premium' AND e.status IN ('active','trialing','past_due') AND (e.current_period_end IS NULL OR e.current_period_end > strftime('%Y-%m-%dT%H:%M:%fZ','now'))))) AND
 (SELECT COUNT(*) FROM tasks WHERE user_id = NEW.user_id AND status = 'open') >= 10
BEGIN
 SELECT RAISE(ABORT, 'FREE_PLAN_LIMIT:tasks');
END;

CREATE TRIGGER free_tasks_reactivate BEFORE UPDATE OF status, user_id ON tasks
WHEN NEW.status = 'open' AND (OLD.status != 'open' OR NEW.user_id != OLD.user_id) AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = NEW.user_id AND r.role = 'owner' AND r.revoked_at IS NULL) AND NOT EXISTS (SELECT 1 FROM user_entitlements e WHERE e.user_id = NEW.user_id AND e.ended_at IS NULL AND ( (e.entitlement = 'owner_premium' AND e.source = 'admin' AND e.status = 'active') OR (e.entitlement = 'premium' AND e.status IN ('active','trialing','past_due') AND (e.current_period_end IS NULL OR e.current_period_end > strftime('%Y-%m-%dT%H:%M:%fZ','now'))))) AND
 (SELECT COUNT(*) FROM tasks WHERE user_id = NEW.user_id AND status = 'open') >= 10
BEGIN
 SELECT RAISE(ABORT, 'FREE_PLAN_LIMIT:tasks');
END;

CREATE TRIGGER free_notes_insert BEFORE INSERT ON notes
WHEN 1 = 1 AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = NEW.user_id AND r.role = 'owner' AND r.revoked_at IS NULL) AND NOT EXISTS (SELECT 1 FROM user_entitlements e WHERE e.user_id = NEW.user_id AND e.ended_at IS NULL AND ( (e.entitlement = 'owner_premium' AND e.source = 'admin' AND e.status = 'active') OR (e.entitlement = 'premium' AND e.status IN ('active','trialing','past_due') AND (e.current_period_end IS NULL OR e.current_period_end > strftime('%Y-%m-%dT%H:%M:%fZ','now'))))) AND
 (SELECT COUNT(*) FROM notes WHERE user_id = NEW.user_id AND 1 = 1) >= 5
BEGIN
 SELECT RAISE(ABORT, 'FREE_PLAN_LIMIT:notes');
END;

CREATE TRIGGER free_reminders_insert BEFORE INSERT ON reminders
WHEN NEW.status IN ('pending','snoozed') AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = NEW.user_id AND r.role = 'owner' AND r.revoked_at IS NULL) AND NOT EXISTS (SELECT 1 FROM user_entitlements e WHERE e.user_id = NEW.user_id AND e.ended_at IS NULL AND ( (e.entitlement = 'owner_premium' AND e.source = 'admin' AND e.status = 'active') OR (e.entitlement = 'premium' AND e.status IN ('active','trialing','past_due') AND (e.current_period_end IS NULL OR e.current_period_end > strftime('%Y-%m-%dT%H:%M:%fZ','now'))))) AND
 (SELECT COUNT(*) FROM reminders WHERE user_id = NEW.user_id AND status IN ('pending','snoozed')) >= 3
BEGIN
 SELECT RAISE(ABORT, 'FREE_PLAN_LIMIT:reminders');
END;

CREATE TRIGGER free_reminders_reactivate BEFORE UPDATE OF status, user_id ON reminders
WHEN NEW.status IN ('pending','snoozed') AND (OLD.status NOT IN ('pending','snoozed') OR NEW.user_id != OLD.user_id) AND NOT EXISTS (SELECT 1 FROM user_roles r WHERE r.user_id = NEW.user_id AND r.role = 'owner' AND r.revoked_at IS NULL) AND NOT EXISTS (SELECT 1 FROM user_entitlements e WHERE e.user_id = NEW.user_id AND e.ended_at IS NULL AND ( (e.entitlement = 'owner_premium' AND e.source = 'admin' AND e.status = 'active') OR (e.entitlement = 'premium' AND e.status IN ('active','trialing','past_due') AND (e.current_period_end IS NULL OR e.current_period_end > strftime('%Y-%m-%dT%H:%M:%fZ','now'))))) AND
 (SELECT COUNT(*) FROM reminders WHERE user_id = NEW.user_id AND status IN ('pending','snoozed')) >= 3
BEGIN
 SELECT RAISE(ABORT, 'FREE_PLAN_LIMIT:reminders');
END;
