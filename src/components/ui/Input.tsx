import type { InputHTMLAttributes, TextareaHTMLAttributes } from 'react'

import styles from './Field.module.css'

type InputProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string
}

export function Input({ label, id, className, ...props }: InputProps) {
  const inputId = id ?? props.name
  return (
    <label className={styles.field} htmlFor={inputId}>
      <span className={styles.label}>{label}</span>
      <input
        id={inputId}
        className={[styles.control, className].filter(Boolean).join(' ')}
        {...props}
      />
    </label>
  )
}

type TextAreaProps = TextareaHTMLAttributes<HTMLTextAreaElement> & {
  label: string
}

export function TextArea({ label, id, className, ...props }: TextAreaProps) {
  const inputId = id ?? props.name
  return (
    <label className={styles.field} htmlFor={inputId}>
      <span className={styles.label}>{label}</span>
      <textarea
        id={inputId}
        className={[styles.control, styles.textarea, className]
          .filter(Boolean)
          .join(' ')}
        {...props}
      />
    </label>
  )
}
