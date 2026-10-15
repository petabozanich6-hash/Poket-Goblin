import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import {
  DevourReview,
  DocumentDevourer,
} from '@/features/documents/DocumentDevourer'
import {
  deleteDocument,
  downloadDocumentUrl,
  fetchDocument,
  fetchDocuments,
  fetchSortingDocuments,
  renameDocument,
  reprocessDocument,
  type DevourResponse,
} from '@/features/explore/exploreApi'

import styles from './Page.module.css'

export function DocumentsPage() {
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const docsQuery = useQuery({
    queryKey: ['documents', q],
    queryFn: () => fetchDocuments({ q: q || undefined }),
  })

  const deleteMutation = useMutation({
    mutationFn: deleteDocument,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['documents'] })
      await queryClient.invalidateQueries({ queryKey: ['review'] })
    },
  })

  const renameMutation = useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      renameDocument(id, name),
    onSuccess: async () => {
      setRenameId(null)
      await queryClient.invalidateQueries({ queryKey: ['documents'] })
    },
  })

  const reprocessMutation = useMutation({
    mutationFn: reprocessDocument,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['documents'] })
      await queryClient.invalidateQueries({ queryKey: ['review'] })
    },
  })

  const sortingQuery = useQuery({
    queryKey: ['sorting-documents'],
    queryFn: fetchSortingDocuments,
  })
  const [resumed, setResumed] = useState<DevourResponse | null>(null)
  const resume = useMutation({
    mutationFn: fetchDocument,
    onSuccess: (data) => setResumed(data),
  })
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const sorting = (sortingQuery.data?.documents ?? []).filter(
    (doc) => doc.id !== reviewingId,
  )
  const maxMb = docsQuery.data
    ? Math.round(docsQuery.data.maxUploadBytes / (1024 * 1024))
    : 10
  const usedMb = (docsQuery.data?.keptBytes ?? 0) / (1024 * 1024)
  const allowanceMb = (docsQuery.data?.keptAllowanceBytes ?? 0) / (1024 * 1024)

  const docs = docsQuery.data?.documents ?? []

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Documents</h1>
          <p className={styles.sub}>
            Hand the goblin a bill, letter or form. It pulls out what matters,
            suggests what to do, and — unless you ask it to keep the file —
            deletes the original when you’re done.
          </p>
        </div>
      </header>

      <Card>
        <h2>Feed the Document Devourer</h2>
        <DocumentDevourer maxMb={maxMb} onReviewing={setReviewingId} />
      </Card>

      {resumed ? (
        <Card>
          <h2>Finish sorting</h2>
          <DevourReview result={resumed} onClose={() => setResumed(null)} />
        </Card>
      ) : sorting.length > 0 ? (
        <Card>
          <h2>Still being sorted</h2>
          <p className={styles.sub}>
            These aren’t kept. Anything you don’t finish is deleted
            automatically within 24 hours.
          </p>
          <ul className={styles.stack}>
            {sorting.map((doc) => (
              <li key={doc.id} className={styles.listRow}>
                <div>
                  <strong>{doc.displayName}</strong>
                  <p className={styles.sub}>
                    {doc.goblinSummary ?? doc.status}
                  </p>
                </div>
                <div className={styles.rowActions}>
                  <Button size="sm" onClick={() => resume.mutate(doc.id)}>
                    Review
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteMutation.mutate(doc.id)}
                  >
                    Cancel
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      ) : null}

      <Card>
        <Input
          label="Search vault"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="electricity, school, receipt…"
        />
      </Card>

      <Card>
        <h2>Kept documents</h2>
        {allowanceMb > 0 ? (
          <p className={styles.sub}>
            {usedMb < 1
              ? `${Math.round(usedMb * 1024)} KB`
              : `${usedMb.toFixed(1)} MB`}{' '}
            of{' '}
            {allowanceMb >= 1024
              ? `${allowanceMb / 1024} GB`
              : `${allowanceMb} MB`}{' '}
            used. Only documents you choose to keep count.
          </p>
        ) : null}
        {docs.length === 0 ? (
          <p className={styles.sub}>
            Nothing kept yet. Choose “Keep this document” when you want the file
            itself saved.
          </p>
        ) : (
          <ul className={styles.stack}>
            {docs.map((doc) => (
              <li key={doc.id} className={styles.listRow}>
                <div>
                  {renameId === doc.id ? (
                    <form
                      className={styles.stackTight}
                      onSubmit={(e) => {
                        e.preventDefault()
                        renameMutation.mutate({
                          id: doc.id,
                          name: renameValue,
                        })
                      }}
                    >
                      <Input
                        label="Name"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                      />
                      <Button type="submit" size="sm">
                        Save name
                      </Button>
                    </form>
                  ) : (
                    <strong>{doc.displayName}</strong>
                  )}
                  <p className={styles.sub}>
                    {doc.goblinSummary ? `${doc.goblinSummary} · ` : ''}
                    {Math.round(doc.byteSize / 1024)} KB
                    {doc.processingError ? ` · ${doc.processingError}` : ''}
                  </p>
                </div>
                <div className={styles.rowActions}>
                  <a
                    className={styles.tab}
                    href={downloadDocumentUrl(doc.id)}
                    download
                  >
                    Download
                  </a>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setRenameId(doc.id)
                      setRenameValue(doc.displayName)
                    }}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => reprocessMutation.mutate(doc.id)}
                  >
                    Re-process
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => deleteMutation.mutate(doc.id)}
                  >
                    Delete
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
        <p className={styles.sub} style={{ marginTop: '1rem' }}>
          Suggestions from kept documents also wait under{' '}
          <Link to="/life/review">Suggestions</Link>.
        </p>
      </Card>
    </div>
  )
}
