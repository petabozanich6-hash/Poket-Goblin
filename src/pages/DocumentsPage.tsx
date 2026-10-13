import { useState, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router'

import { Button } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import {
  deleteDocument,
  downloadDocumentUrl,
  fetchDocuments,
  renameDocument,
  reprocessDocument,
  uploadDocument,
} from '@/features/explore/exploreApi'
import { ApiError } from '@/lib/api'

import styles from './Page.module.css'

export function DocumentsPage() {
  const queryClient = useQueryClient()
  const [q, setQ] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [renameId, setRenameId] = useState<string | null>(null)
  const [renameValue, setRenameValue] = useState('')

  const docsQuery = useQuery({
    queryKey: ['documents', q],
    queryFn: () => fetchDocuments({ q: q || undefined }),
  })

  const uploadMutation = useMutation({
    mutationFn: uploadDocument,
    onSuccess: async () => {
      setError(null)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['documents'] }),
        queryClient.invalidateQueries({ queryKey: ['review'] }),
        queryClient.invalidateQueries({ queryKey: ['den-summary'] }),
      ])
    },
    onError: (err) => {
      setError(err instanceof ApiError ? err.message : 'Upload failed')
    },
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

  function onUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const form = event.currentTarget
    const input = form.elements.namedItem('file') as HTMLInputElement
    const file = input.files?.[0]
    if (!file) {
      setError('Choose a file first')
      return
    }
    uploadMutation.mutate(file)
    form.reset()
  }

  const docs = docsQuery.data?.documents ?? []

  return (
    <div className={styles.page}>
      <header className={styles.header}>
        <div>
          <h1>Document vault</h1>
          <p className={styles.sub}>
            Private shelves for bills, letters and notices. The goblin suggests
            actions — you decide what becomes a commitment.
          </p>
        </div>
      </header>

      <Card>
        <p className={styles.sub}>
          Storage: {docsQuery.data?.storage ?? '…'} · Max{' '}
          {docsQuery.data
            ? Math.round(docsQuery.data.maxUploadBytes / (1024 * 1024))
            : 8}
          MiB · PDF, Word, text, common images
        </p>
        <form className={styles.stackTight} onSubmit={onUpload}>
          <Input label="Upload file" name="file" type="file" required />
          <Button type="submit" disabled={uploadMutation.isPending}>
            {uploadMutation.isPending ? 'Uploading…' : 'Upload to the vault'}
          </Button>
        </form>
        {error ? <p className={styles.sub}>{error}</p> : null}
        {uploadMutation.data?.processing.warnings?.length ? (
          <p className={styles.sub}>
            {uploadMutation.data.processing.warnings.join(' ')}
          </p>
        ) : null}
      </Card>

      <Card>
        <Input
          label="Search vault"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="electricity, school, receipt…"
        />
      </Card>

      <Card>
        <h2>Your documents</h2>
        {docs.length === 0 ? (
          <p className={styles.sub}>
            Nothing in the vault yet. Upload a bill or letter when you are
            ready.
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
                    {doc.mimeType} · {Math.round(doc.byteSize / 1024)} KB ·{' '}
                    {doc.status}
                    {doc.categorySlug ? ` · ${doc.categorySlug}` : ''}
                    {doc.processingError ? ` · ${doc.processingError}` : ''}
                  </p>
                </div>
                <div className={styles.tabs}>
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
          Suggestions land in the <Link to="/inbox">Inbox</Link> for review.
        </p>
      </Card>
    </div>
  )
}
