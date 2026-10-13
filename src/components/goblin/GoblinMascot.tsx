import styles from './GoblinMascot.module.css'

/** Official Pocket Goblin mascot — use only in the Den welcome area. */
const MASCOT_SRC = '/assets/branding/goblin-mascot.webp'
const MASCOT_FALLBACK = '/assets/branding/goblin-mascot.png'

type GoblinMascotProps = {
  /** Rendered height in CSS pixels; width follows aspect ratio. */
  size?: number
  alt?: string
  className?: string
  loading?: 'eager' | 'lazy'
}

export function GoblinMascot({
  size = 140,
  alt = 'Pocket Goblin waving hello',
  className,
  loading = 'eager',
}: GoblinMascotProps) {
  return (
    <picture>
      <source srcSet={MASCOT_SRC} type="image/webp" />
      <img
        className={[styles.mascot, className].filter(Boolean).join(' ')}
        src={MASCOT_FALLBACK}
        alt={alt}
        height={size}
        width={Math.round(size * (424 / 512))}
        loading={loading}
        decoding="async"
        draggable={false}
        style={{ height: size, width: 'auto', maxWidth: '100%' }}
      />
    </picture>
  )
}
