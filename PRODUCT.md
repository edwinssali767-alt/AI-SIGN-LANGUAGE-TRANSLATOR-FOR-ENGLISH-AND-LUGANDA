# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users
Two-way audience, equal weight: Deaf signers who want to be understood by hearing people, and hearing people who want to talk with Deaf signers. Students and teachers of Uganda Sign Language (USL) are a third group. Typical situation: a phone in an everyday conversation (school, clinic, shop, home), often a low-end device on a weak connection.

## Product Purpose
AI Sign Language Translator for English and Luganda. Turns signs seen by the camera into English and Luganda text (and speech), and turns typed or spoken sentences into signs, so signers and hearing people can understand each other. Success means a conversation completes without an interpreter and without the signer being misunderstood.

## Positioning
Built for Uganda Sign Language and Luganda, which mainstream translators do not cover; recognition runs in the browser so it works offline and keeps video on the device.

## Operating Context
Phones and laptops in the browser, often offline or on weak connections. The signer confirms or edits a sentence before it is spoken. Recognition and the sign-to-sentence logic run locally; no paid or cloud AI services.

## Capabilities and Constraints
- Pages: welcome, translator, letters (fingerspelling), gestures library, auth, profile, admin, pricing.
- Free offline tools only. No paid APIs, keys or cloud AI. Pricing/payment pages are out of scope and must not be modified.
- Camera video is never stored; only hand-landmark numbers are recorded, and only with consent.
- Sign vocabulary and Luganda wording are unverified until a Deaf USL signer reviews them (`status: "needs verification by a deaf USL signer"`).
- Both languages (English, Luganda) must be offered everywhere text appears.

## Evidence on Hand
Existing site in `frontend/`, README and ABOUT WEBSITE.md, AUDIT.md (technical audit), 1,000 pixel-based sample frames of 5 signs with no signer metadata (not usable for landmark training). No testimonials, user statistics or verified Luganda audio exist; none may be invented.

## Product Principles
1. Deaf-first: nothing is audio-only; every spoken output has a visible caption.
2. The signer is in control: results are shown and editable before they are spoken.
3. Honest uncertainty: show "unknown, please repeat" rather than a confident wrong answer.
4. Light and offline: works on low-end phones without heavy downloads or effects.
5. Bilingual by default: English and Luganda have equal standing.

## Accessibility & Inclusion
Target WCAG AA: 4.5:1 text contrast, visible keyboard focus, full keyboard operation, captions for all speech, large touch targets, high-contrast option, reduced-motion respected.
