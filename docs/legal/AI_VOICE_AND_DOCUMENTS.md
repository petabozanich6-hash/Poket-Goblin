# AI, Voice and Document Processing Guide

**Effective date:** 17 October 2026

Pocket Goblin helps sort everyday life, without pretending that the Goblin is infallible. This guide explains the optional technology behind the organisation features. It forms part of our transparency information alongside the [Privacy Policy](/privacy) and [Terms of Service](/terms).

## AI-assisted help

Pocket Goblin uses its own rules and, where available within plan limits, **Cloudflare Workers AI** to interpret written requests, help organise ideas and read relevant parts of uploaded documents. In production, customer requests are not sent to an independently configured OpenAI or Anthropic API for these features. AI may receive the text needed to understand a request or, for scans and photos, image content needed to extract text.

Cloudflare states it does not use Workers AI customer content to train the models available on its service without explicit consent. Cloudflare operates the infrastructure and processes information according to its service terms. Some processing may take place outside Australia.

AI-generated interpretations may be wrong. Never rely on them alone for financial amounts, medical instructions, legal deadlines, enrolments, travel reservations or other consequential details. Check the source and decide what action to take.

## Changes the Goblin can make

When your instruction is clear, the Goblin may create or update an ordinary record straight away and offer **Undo**. Some confident suggestions from documents can be added automatically, with Undo available; other changes wait for your confirmation. Changes to appointments and complex or uncertain actions may require confirmation. You can enable **Ask me before the Goblin changes anything** in Settings for additional control.

Pocket Goblin does not independently transfer money, send correspondence to someone else, lodge forms or make legal commitments on your behalf.

## Two choices for documents

- **Just sort it:** the uploaded original is held privately while it is processed. It is deleted when you finish or cancel, or within **24 hours**. Its temporary suggestions and extracted facts are removed; any task, reminder or calendar item you chose to keep remains as your own record.
- **Keep this document:** the original and relevant extracted information remain in your private vault for later use until you delete them or close your account. Storage allowances apply.

A document-reading attempt may count toward your plan's processing allowance even if the content cannot be fully read. Only upload material you have permission to use. Download and check the original before relying on interpreted details.

## Microphone and spoken replies

Pocket Goblin does not record or save microphone audio. When you speak, the browser's built-in recognition system may send audio to the browser or device provider, depending on its implementation and permissions. Pocket Goblin receives recognised text to handle your request. You can always choose to type instead.

If enabled, spoken Goblin replies are generated using the voices available on your device or browser. Voice preferences and phrases you intentionally teach the Goblin can be saved in your account.

## Offline thoughts

When you type while offline, unsent thoughts can remain in your device's browser storage and are transmitted when a connection returns. Protect devices you share with others. Clearing app/browser data may erase thoughts that were never synchronised.

## Usage and assistance

The current plan allowances appear in **Settings → Plan**. Reaching an AI allowance does not erase existing content; built-in rule-based assistance may still be available.

For a question about a particular file, account or action, use **Messages to Goblin HQ** while signed in, or email support@pocketgoblin.org if you cannot reach the app.
