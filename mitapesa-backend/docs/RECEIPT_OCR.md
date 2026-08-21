# Receipt OCR

## What this replaced

Receipt scanning previously had no real image analysis at all — it waited
1.6 seconds to simulate processing, then returned a random entry from a
hardcoded list of 8 fake merchants with a random amount, regardless of
what was actually in the photo. This document covers the real
implementation that replaced it.

## Architecture

Same provider-abstraction pattern as every other external integration in
this project (CMS, CBS, KYC, email, SMS, TIPS) — `OCR_PROVIDER` selects
the implementation, the route and frontend never need to know which one
is active.

| `OCR_PROVIDER` value | Provider | Cost | Requires |
|---|---|---|---|
| `mock` (default) | `MockOcrProvider` | Free | Nothing — local dev/testing only |
| `openai_vision` | `OpenAiVisionOcrProvider` | ~$0.01-0.02/scan | `OPENAI_API_KEY` |
| `gemini_vision` | `GeminiVisionOcrProvider` | Free (rate-limited) | `GEMINI_API_KEY` |

Both real providers use a vision-capable LLM rather than a plain OCR
engine (e.g. Tesseract, Cloud Vision's text-detection) - a plain OCR
engine returns raw text that still needs separate parsing logic to find
"which line is the total" or "which line is the merchant name." A vision
LLM handles that understanding natively in one call, and can pick from
the customer's own category list directly (passed into the prompt)
rather than needing a second fuzzy-matching step against a generic
category set.

## Setting up Gemini (recommended free option)

1. Get a free API key from Google AI Studio (aistudio.google.com) - no
   credit card required.
2. Set on Render: `OCR_PROVIDER=gemini_vision`, `GEMINI_API_KEY=<your key>`.
3. Optional: `GEMINI_OCR_MODEL` (defaults to `gemini-3.5-flash-lite`) -
   see the note below on why this is worth knowing about.

**Free tier caveat, disclosed to the person setting this up, not just
buried here**: on Gemini's free tier specifically, prompts and responses
(receipt photos, in this case) may be used by Google to improve their
models. On a paid tier, they don't train on your data. For a pilot/demo
stage this is a reasonable tradeoff, but worth an explicit decision for a
fintech app handling receipts, not an assumption.

**Model naming churn**: Gemini model names and free-tier availability
changed more than once in 2026 (e.g. Gemini 2.0 Flash was retired June 1,
2026; `gemini-2.5-flash-lite` stopped being available to new users
sometime before August 2026, discovered when this exact deployment hit a
404 from Google with the message "This model models/gemini-2.5-flash-lite
is no longer available to new users"). The current default,
`gemini-3.5-flash-lite`, is Google's own officially-recommended migration
target as of this writing. `GEMINI_OCR_MODEL` exists specifically so the
model can be updated without a code change if this happens again - check
ai.google.dev's current model list if extraction starts failing with a
"model not found"/404-style error in the logs.

## Setting up OpenAI (paid alternative)

1. Get an API key from platform.openai.com - requires billing to be set up.
2. Set on Render: `OCR_PROVIDER=openai_vision`, `OPENAI_API_KEY=<your key>`.

Worth switching to this (or a paid Gemini tier) once volume outgrows the
free tier's daily quota, or if the data-training caveat above is a
dealbreaker.

## The admin kill switch - a separate control from the provider choice

`receipt_ocr_enabled` (Admin Portal -> Settings) is a **runtime** toggle,
independent of which provider is configured. When off, receipt scanning
is unavailable to customers - they're directed to add expenses manually
- rather than silently falling back to any kind of placeholder data
(that silent-fallback behavior is exactly the bug this feature was
rebuilt to fix, so it's deliberately not an option here).

Two separate controls, two separate purposes:
- `OCR_PROVIDER` (env var) - **which implementation runs**. Requires a
  redeploy to change.
- `receipt_ocr_enabled` (admin setting) - **whether the feature is
  available right now**, regardless of provider. Changes instantly, no
  redeploy, from the Admin Portal.

## Disclosed limitation - this was never tested against a live API call

Both `OpenAiVisionOcrProvider` and `GeminiVisionOcrProvider` were built
and reviewed without network access to make a live test call against
either provider's real API - the request/response shapes match each
provider's documented API as of when this was written, and the JSON
validation/rejection logic (malformed dates, hallucinated categories,
out-of-bounds confidence, negative amounts) was verified with real test
cases run locally. But the actual live API call itself is untested.
Treat the first real deploy as the first real test of this exact code
path - check Render logs for the raw provider error if a scan fails,
rather than assuming the whole feature is broken.

## What a scan result looks like when things go wrong

The route (`POST /receipts/scan`) never returns fabricated data on
failure. Three distinct outcomes reach the customer:

1. **Feature disabled** (`receipt_ocr_enabled=false`) -> 403, frontend
   shows "Receipt scanning is currently unavailable - please add this
   expense manually."
2. **Provider call failed** (bad API key, network error, rate limit,
   image genuinely unreadable) -> 400, frontend shows "Couldn't read this
   receipt" with a retry option and a manual-entry option.
3. **Partial extraction** (e.g. merchant read but amount wasn't legible)
   -> succeeds, but the frontend flags "some details weren't fully
   legible - please fill in or correct anything missing" rather than
   presenting an incomplete guess as a confident, verified result.
