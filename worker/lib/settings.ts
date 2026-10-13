import type {
  CapacityMode,
  GoblinFrequency,
  NudgeFrequency,
  PlanningApproach,
  ThemePreference,
  UserSettings,
} from '../../shared/types'

export type SettingsRow = {
  capacityMode: CapacityMode
  theme: ThemePreference
  gamificationEnabled: number
  quietHoursEnabled: number
  quietHoursStart: string
  quietHoursEnd: string
  nudgeFrequency: NudgeFrequency
  dailyBriefingEnabled: number
  eveningCheckinEnabled: number
  reducedMotion: number
  planningApproach: PlanningApproach
  goblinFrequency: GoblinFrequency
  completedQuestCount: number
}

export const SETTINGS_SELECT = `capacity_mode as capacityMode, theme,
  gamification_enabled as gamificationEnabled,
  quiet_hours_enabled as quietHoursEnabled,
  quiet_hours_start as quietHoursStart,
  quiet_hours_end as quietHoursEnd,
  nudge_frequency as nudgeFrequency,
  daily_briefing_enabled as dailyBriefingEnabled,
  evening_checkin_enabled as eveningCheckinEnabled,
  reduced_motion as reducedMotion,
  planning_approach as planningApproach,
  goblin_frequency as goblinFrequency,
  completed_quest_count as completedQuestCount`

export function mapSettings(row: SettingsRow | null): UserSettings {
  return {
    capacityMode: row?.capacityMode ?? 'steady',
    theme: row?.theme ?? 'system',
    gamificationEnabled: Boolean(row?.gamificationEnabled ?? 1),
    quietHoursEnabled: Boolean(row?.quietHoursEnabled ?? 0),
    quietHoursStart: row?.quietHoursStart ?? '21:00',
    quietHoursEnd: row?.quietHoursEnd ?? '08:00',
    nudgeFrequency: row?.nudgeFrequency ?? 'normal',
    dailyBriefingEnabled: Boolean(row?.dailyBriefingEnabled ?? 1),
    eveningCheckinEnabled: Boolean(row?.eveningCheckinEnabled ?? 0),
    reducedMotion: Boolean(row?.reducedMotion ?? 0),
    planningApproach: row?.planningApproach ?? 'balanced',
    goblinFrequency: row?.goblinFrequency ?? 'normal',
    completedQuestCount: row?.completedQuestCount ?? 0,
  }
}

export async function loadSettings(
  db: D1Database,
  userId: string,
): Promise<UserSettings> {
  const row = await db
    .prepare(`SELECT ${SETTINGS_SELECT} FROM user_settings WHERE user_id = ?`)
    .bind(userId)
    .first<SettingsRow>()
  return mapSettings(row)
}
