# Integrations & document vault (Sprint 4)

## Document vault

- Metadata in D1 (`documents`, `document_extractions`, `record_links`)
- Bytes in private object storage via `UPLOADS` R2 binding
- Local Miniflare R2 (no remote paid bucket required)
- Memory fallback only when the binding is absent (tests)
- Server-side magic-byte validation · 8 MiB limit
- Processing: upload → store → extract → interpret → review items
- OCR: abstracted as `needs_ocr` status — **not configured** until approved

## Unified inbox

`/inbox` reviews suggestions from captures and documents (email/calendar ready).

Accept / dismiss / snooze. Mutations require confirmation (and dates when uncertain).

## Voice capture

Browser Speech Recognition when available (Chrome/Edge/Safari variants).

- Explicit mic control · on-device transcription · edit before send
- Falls back to typing when unsupported
- Audio is not retained by Pocket Goblin

## Email & calendar OAuth

Providers: Gmail, Outlook Mail, Google Calendar, Outlook Calendar.

- Read-only scopes only
- Secure `oauth_states` + `oauth_tokens` tables
- Honest `not_connected` until client ID/secret exist
- Token exchange / live sync **not claimed** until configured and tested

### Activate later (Worker secrets — never commit)

```
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
MICROSOFT_OAUTH_CLIENT_ID=
MICROSOFT_OAUTH_CLIENT_SECRET=
```

Remote R2 provisioning is a separate approval (local R2 is enough for development).
