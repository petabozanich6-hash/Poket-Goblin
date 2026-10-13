import styles from './GoblinMascot.module.css'

type GoblinMascotProps = {
  size?: number
  mood?: 'idle' | 'happy' | 'think'
  title?: string
}

export function GoblinMascot({
  size = 72,
  mood = 'idle',
  title = 'Pocket Goblin',
}: GoblinMascotProps) {
  const mouth =
    mood === 'happy' ? 'M12 18c1.5 2 3.5 3 6 3s4.5-1 6-3' : 'M13 19h6'

  return (
    <svg
      className={styles.mascot}
      width={size}
      height={size}
      viewBox="0 0 64 64"
      role="img"
      aria-label={title}
    >
      <title>{title}</title>
      <ellipse cx="32" cy="56" rx="18" ry="4" className={styles.shadow} />
      <path
        d="M18 20c0-10 6-16 14-16s14 6 14 16v18c0 8-6 14-14 14s-14-6-14-14V20z"
        className={styles.body}
      />
      <path d="M16 14l-8-10 12 6" className={styles.ear} />
      <path d="M48 14l8-10-12 6" className={styles.ear} />
      <circle cx="24" cy="28" r="3" className={styles.eye} />
      <circle cx="40" cy="28" r="3" className={styles.eye} />
      <circle cx="25" cy="27.5" r="1" className={styles.pupil} />
      <circle cx="41" cy="27.5" r="1" className={styles.pupil} />
      <path d={mouth} className={styles.mouth} transform="translate(8 8)" />
      <circle cx="20" cy="34" r="2.5" className={styles.blush} />
      <circle cx="44" cy="34" r="2.5" className={styles.blush} />
      {mood === 'think' ? (
        <circle cx="50" cy="12" r="3" className={styles.thought} />
      ) : null}
    </svg>
  )
}
