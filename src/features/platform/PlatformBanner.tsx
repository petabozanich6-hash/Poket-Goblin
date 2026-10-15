import { Info, TriangleAlert, Wrench } from 'lucide-react'

import styles from './PlatformBanner.module.css'
import { usePlatformStatus } from './platformStatus'

/** Owner-managed announcement and maintenance notices (plain text only). */
export function PlatformBanner() {
  const { data } = usePlatformStatus()
  if (!data?.announcement && !data?.maintenance) return null
  return (
    <div className={styles.stack}>
      {data.maintenance ? (
        <p className={[styles.banner, styles.warning].join(' ')} role="status">
          <Wrench size={16} aria-hidden />
          {data.maintenance.message}
        </p>
      ) : null}
      {data.announcement ? (
        <p
          className={[
            styles.banner,
            data.announcement.tone === 'warning' ? styles.warning : '',
          ].join(' ')}
          role="status"
        >
          {data.announcement.tone === 'warning' ? (
            <TriangleAlert size={16} aria-hidden />
          ) : (
            <Info size={16} aria-hidden />
          )}
          {data.announcement.message}
        </p>
      ) : null}
    </div>
  )
}
