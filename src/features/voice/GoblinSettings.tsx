import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import {
  DEFAULT_PROFILE,
  SPEECH_LANGUAGES,
  STYLE_LABELS,
  type GoblinExpression,
  type GoblinProfile,
  type GoblinStyle,
} from '@shared/goblin/profile'

import { Button } from '@/components/ui/Button'
import { ApiError } from '@/lib/api'
import styles from '@/pages/Page.module.css'

import local from './GoblinSettings.module.css'

import { getRecognitionCtor } from './speech'
import { listVoices, onVoicesChanged, speak, ttsSupported } from './tts'
import {
  addExpression,
  deleteExpression,
  fetchGoblinProfile,
  GOBLIN_PROFILE_KEY,
  resetGoblinProfile,
  saveGoblinProfile,
  updateExpression,
} from './voiceApi'

function ExpressionRow({ expression }: { expression: GoblinExpression }) {
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [phrase, setPhrase] = useState(expression.phrase)
  const [meaning, setMeaning] = useState(expression.meaning)
  const [error, setError] = useState<string | null>(null)
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: GOBLIN_PROFILE_KEY })

  if (!editing) {
    return (
      <li>
        When I say <strong>“{expression.phrase}”</strong>, I mean{' '}
        <em>{expression.meaning}</em>{' '}
        <Button variant="ghost" size="sm" onClick={() => setEditing(true)}>
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void deleteExpression(expression.id).then(refresh)}
        >
          Delete
        </Button>
      </li>
    )
  }
  return (
    <li>
      <ExpressionFields
        phrase={phrase}
        meaning={meaning}
        onPhrase={setPhrase}
        onMeaning={setMeaning}
      />
      <Button
        size="sm"
        onClick={() =>
          void updateExpression(expression.id, phrase, meaning)
            .then(() => {
              setEditing(false)
              return refresh()
            })
            .catch((e) =>
              setError(e instanceof ApiError ? e.message : 'Could not save.'),
            )
        }
      >
        Save
      </Button>
      <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      {error ? <p className={styles.sub}>{error}</p> : null}
    </li>
  )
}

function ExpressionFields(props: {
  phrase: string
  meaning: string
  onPhrase: (v: string) => void
  onMeaning: (v: string) => void
}) {
  return (
    <div className={styles.stackTight}>
      <label>
        When I say{' '}
        <input
          value={props.phrase}
          maxLength={80}
          onChange={(e) => props.onPhrase(e.target.value)}
          placeholder="what’s the damage"
        />
      </label>
      <label>
        I mean{' '}
        <input
          value={props.meaning}
          maxLength={240}
          onChange={(e) => props.onMeaning(e.target.value)}
          placeholder="show me today’s schedule"
        />
      </label>
    </div>
  )
}

/**
 * "Get to Know Your Goblin": optional. Voice works with the defaults; this
 * is for people who want to change how they talk to it and how it talks back.
 */
export function GoblinSettings() {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: GOBLIN_PROFILE_KEY,
    queryFn: fetchGoblinProfile,
  })
  const profile = query.data?.profile ?? DEFAULT_PROFILE
  const expressions = query.data?.expressions ?? []
  const [message, setMessage] = useState<string | null>(null)
  const [nameDraft, setNameDraft] = useState<string | null>(null)
  const [aliasDraft, setAliasDraft] = useState<string | null>(null)
  const [phrase, setPhrase] = useState('')
  const [meaning, setMeaning] = useState('')
  const [voices, setVoices] = useState(() => listVoices())

  useEffect(() => onVoicesChanged(() => setVoices(listVoices())), [])

  const save = useMutation({
    mutationFn: (patch: Partial<GoblinProfile>) => saveGoblinProfile(patch),
    onSuccess: async () => {
      setMessage('Saved.')
      await queryClient.invalidateQueries({ queryKey: GOBLIN_PROFILE_KEY })
    },
    onError: (e) =>
      setMessage(
        e instanceof ApiError ? e.message : 'Could not save — try again.',
      ),
  })

  const patch = (p: Partial<GoblinProfile>) => save.mutate(p)
  const recognition = Boolean(getRecognitionCtor())

  return (
    <div className={local.wrap}>
      <p className={styles.sub}>
        All optional. Call your Goblin whatever you like — you never have to say
        its name, and there’s no magic phrase.
      </p>
      <form
        className={styles.stackTight}
        onSubmit={(e) => {
          e.preventDefault()
          const aliases = (aliasDraft ?? profile.aliases.join(', '))
            .split(',')
            .map((a) => a.trim())
            .filter(Boolean)
          patch({
            name: (nameDraft ?? profile.name).trim() || 'Goblin',
            aliases,
          })
        }}
      >
        <label>
          Its name{' '}
          <input
            value={nameDraft ?? profile.name}
            maxLength={40}
            onChange={(e) => setNameDraft(e.target.value)}
          />
        </label>
        <label>
          Nicknames (comma separated){' '}
          <input
            value={aliasDraft ?? profile.aliases.join(', ')}
            onChange={(e) => setAliasDraft(e.target.value)}
            placeholder="Gobbo, Mr Goblin, Gerald"
          />
        </label>
        <div>
          <Button type="submit" size="sm" disabled={save.isPending}>
            Save names
          </Button>
        </div>
        <p className={styles.sub}>
          “Goblin” always works too. Names help hands-free mode tell when you’re
          talking to it.
        </p>
      </form>
      <h3>How it talks</h3>
      <div className={local.styles}>
        {(Object.keys(STYLE_LABELS) as GoblinStyle[]).map((style) => (
          <button
            key={style}
            type="button"
            className={profile.style === style ? styles.tabActive : styles.tab}
            aria-pressed={profile.style === style}
            onClick={() => patch({ style })}
          >
            {STYLE_LABELS[style].label}
          </button>
        ))}
      </div>
      <p className={styles.sub}>“{STYLE_LABELS[profile.style].sample}”</p>
      <label className={styles.sub}>
        Humour{' '}
        <select
          value={profile.humour}
          onChange={(e) =>
            patch({ humour: e.target.value as GoblinProfile['humour'] })
          }
        >
          <option value="none">None, thanks</option>
          <option value="some">A little</option>
          <option value="lots">Plenty</option>
        </select>
      </label>{' '}
      <label className={styles.sub}>
        Replies{' '}
        <select
          value={profile.replyLength}
          onChange={(e) =>
            patch({
              replyLength: e.target.value as GoblinProfile['replyLength'],
            })
          }
        >
          <option value="short">Short</option>
          <option value="detailed">Detailed</option>
        </select>
      </label>
      <h3>Voice</h3>
      {ttsSupported() ? (
        <>
          <label className={styles.checkField}>
            <input
              type="checkbox"
              checked={profile.speakReplies}
              onChange={(e) => patch({ speakReplies: e.target.checked })}
            />
            Read replies aloud
          </label>
          {profile.speakReplies ? (
            <div className={styles.stackTight}>
              <label>
                Voice{' '}
                <select
                  value={profile.voiceName}
                  onChange={(e) => patch({ voiceName: e.target.value })}
                >
                  <option value="">This device’s default</option>
                  {voices.map((v) => (
                    <option key={v.name} value={v.name}>
                      {v.name} ({v.lang})
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Speed{' '}
                <input
                  type="range"
                  min={0.5}
                  max={2}
                  step={0.1}
                  value={profile.speechRate}
                  onChange={(e) =>
                    patch({ speechRate: Number(e.target.value) })
                  }
                />
              </label>
              <label>
                Volume{' '}
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.1}
                  value={profile.speechVolume}
                  onChange={(e) =>
                    patch({ speechVolume: Number(e.target.value) })
                  }
                />
              </label>
              <div>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() =>
                    speak(`Hello, I'm ${profile.name}.`, {
                      voiceName: profile.voiceName,
                      language: profile.language,
                      rate: profile.speechRate,
                      volume: profile.speechVolume,
                    })
                  }
                >
                  Try it
                </Button>
              </div>
              <p className={styles.sub}>
                Voices come from your device, so they differ between phones and
                computers. If a chosen voice isn’t on this device, the default
                is used.
              </p>
            </div>
          ) : null}
        </>
      ) : (
        <p className={styles.sub}>This browser can’t read replies aloud.</p>
      )}
      <label className={styles.sub}>
        Speech language{' '}
        <select
          value={profile.language}
          onChange={(e) => patch({ language: e.target.value })}
        >
          {SPEECH_LANGUAGES.map((l) => (
            <option key={l.tag} value={l.tag}>
              {l.label}
            </option>
          ))}
        </select>
      </label>
      <h3>Listening</h3>
      <label className={styles.checkField}>
        <input
          type="checkbox"
          checked={profile.listenMode === 'handsfree'}
          disabled={!recognition}
          onChange={(e) =>
            patch({ listenMode: e.target.checked ? 'handsfree' : 'push' })
          }
        />
        Offer hands-free mode
      </label>
      <p className={styles.sub}>
        Tap-to-talk is the default and the most reliable. Hands-free only runs
        while Pocket Goblin is open on screen and you’ve started it: it listens
        for “{profile.name}…” (or your nicknames), stops after 5 minutes or a
        quiet spell, and stops as soon as the app goes into the background. It
        can’t listen when the app is closed or the phone is locked — no website
        can.
        {!recognition
          ? ' This browser has no speech recognition, so it’s unavailable here.'
          : ''}
      </p>
      <h3>Your expressions</h3>
      <p className={styles.sub}>
        Teach the Goblin your own phrases. It treats them as what you mean — the
        usual checks and Undo still apply. For example: “the usual” → “add milk,
        bread and eggs to my shopping list”.
      </p>
      {expressions.length ? (
        <ul className={[styles.sub, local.expressions].join(' ')}>
          {expressions.map((e) => (
            <ExpressionRow
              key={`${e.id}:${e.phrase}:${e.meaning}`}
              expression={e}
            />
          ))}
        </ul>
      ) : null}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void addExpression(phrase, meaning)
            .then(async () => {
              setPhrase('')
              setMeaning('')
              setMessage('Learned.')
              await queryClient.invalidateQueries({
                queryKey: GOBLIN_PROFILE_KEY,
              })
            })
            .catch((err) =>
              setMessage(
                err instanceof ApiError ? err.message : 'Could not save.',
              ),
            )
        }}
      >
        <ExpressionFields
          phrase={phrase}
          meaning={meaning}
          onPhrase={setPhrase}
          onMeaning={setMeaning}
        />
        <Button
          type="submit"
          size="sm"
          disabled={!phrase.trim() || !meaning.trim()}
        >
          Teach it
        </Button>
      </form>
      <div style={{ marginTop: '1rem' }}>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            if (
              !window.confirm(
                'Forget your Goblin’s name, style and every taught phrase?',
              )
            )
              return
            void resetGoblinProfile().then(async () => {
              setNameDraft(null)
              setAliasDraft(null)
              setMessage('Back to defaults.')
              await queryClient.invalidateQueries({
                queryKey: GOBLIN_PROFILE_KEY,
              })
            })
          }}
        >
          Reset personalisation
        </Button>
      </div>
      {message ? (
        <p className={styles.sub} role="status">
          {message}
        </p>
      ) : null}
    </div>
  )
}
