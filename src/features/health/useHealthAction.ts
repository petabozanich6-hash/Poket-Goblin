import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { ApiError } from '@/lib/api'

/** A health change that refreshes everything health shows (and the Den's reminder), with a plain error. */
export function useHealthAction<A, R>(
  fn: (args: A) => Promise<R>,
  onDone?: (result: R) => void,
) {
  const qc = useQueryClient()
  const [error, setError] = useState('')
  const mutation = useMutation({
    mutationFn: fn,
    onMutate: () => setError(''),
    onSuccess: async (result) => {
      await Promise.all(
        ['health', 'health-history', 'health-recipes', 'den-summary'].map((k) =>
          qc.invalidateQueries({ queryKey: [k] }),
        ),
      )
      onDone?.(result)
    },
    onError: (e) =>
      setError(
        e instanceof ApiError
          ? e.message
          : 'That didn’t save. Please try again.',
      ),
  })
  return {
    run: mutation.mutate,
    runAsync: mutation.mutateAsync,
    busy: mutation.isPending,
    error,
    setError,
  }
}
