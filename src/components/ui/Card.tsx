import type { ReactNode } from 'react'

import styles from './Card.module.css'

type CardProps = {
  children: ReactNode
  className?: string
  as?: 'section' | 'article' | 'div'
}

export function Card({ children, className, as: Tag = 'section' }: CardProps) {
  return (
    <Tag className={[styles.card, className].filter(Boolean).join(' ')}>
      {children}
    </Tag>
  )
}
