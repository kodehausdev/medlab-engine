# Partner briefing — Ekaabo / Kesa

Internal only. Not for prospects, not shipped in any app build. This is
Amanda's ammunition: what we actually are, what the two named competitors
actually are, and where to be careful.

**⚠️ Compliance-language discipline (do not skip this):** Railway
production is not yet confirmed running on the BAA-eligible Vertex AI
path — see `CLAUDE.md`'s HIPAA posture section. Until that's cleared,
say **"built for HIPAA-grade handling"**, never **"HIPAA compliant"**
or **"we sign a BAA."** This applies to every document in this folder
and to anything Amanda says live. When the gate closes, this note (and
the language it governs) gets upgraded in the same change.

## What we actually are

Kesa answers a lab or clinic's phone, SMS, and WhatsApp line, books real
appointments against live chair capacity, and is architecturally
incapable of storing a symptom, diagnosis, or medical history — not by
policy, by what the write path accepts.

The four things worth saying out loud, because they're true and checkable,
not marketing copy:

1. **The 911 gate never asks the model.** Distress language is caught
   before any AI model sees the conversation; a scripted redirect fires
   immediately. Most competitors route everything through the LLM and
   hope it handles a crisis correctly.
2. **PHI has nowhere to land.** Appointment records store exactly four
   fields — name, phone, test type, time. Health history a caller
   volunteers is rejected at the point of write.
3. **Built for a real BAA path.** Authenticates through Google Cloud's
   Vertex AI, not a thin wrapper on a consumer API key. (Say "built
   for" — see the compliance-language note above.)
4. **Opt-outs are law, not a suggestion.** TCPA/CTIA STOP keywords are
   honored deterministically on every text channel — never left to an
   AI model's judgment.

## Where we're honestly thin — know this, don't volunteer it

- **No EHR integration.** If a prospect's real workflow lives in Epic,
  Athena, eClinicalWorks — we don't sync to it yet. DeepCura does.
- **No clinical scribe / ambient documentation.** We don't touch the
  visit itself, only booking. If that's what they actually want, we're
  the wrong tool.
- **Single flat price, not tiers.** $297/mo per location is what's
  live in Stripe today. Tiered pricing ($199/$349/$599+) is an internal
  recommendation under discussion, not decided, not wired up — don't
  quote tiers as real.
- **`sunrise-demo` (the public try-it-yourself line) isn't built yet.**
  Don't promise a prospect a number to call and test drive until it
  exists.

## Competitor teardown: DeepCura

The strongest player in the space, not a strawman — treat it that way.

- **What it is**: an "agent-operated clinical AI platform" — AI medical
  scribe, ambient clinical note generation, ICD-10/CPT coding, EHR
  integration (Epic, eClinicalWorks, OptiMantra, Athena, Veradigm), fax
  summarization, AND a receptionist/scheduling layer, all in one
  subscription.
- **Compliance**: genuinely HIPAA compliant, provides a BAA to covered
  entities. Don't contest this — it's real.
- **Pricing**: $129/mo **per provider**, volume discounts at 3–5
  ($116), 6–10 ($110), 11+ ($101) seats. Annual: $999/yr/seat flat.
- **Flagship differentiator**: mid-call SMS fallback — if voice capture
  fails, it texts the patient and injects their typed reply back into
  the live call. Genuinely clever, worth acknowledging if asked.
- **The honest angle**: DeepCura is a clinical documentation platform
  that happens to also answer phones. A solo lab or diagnostic center
  that just wants calls answered and slots booked is paying for a scribe
  and EHR sync they'll never touch. And their pricing scales with
  headcount — a 4-provider practice is $460–516/mo before anything else;
  we're $297/mo flat regardless of how many people work there. Lead with
  scope-fit and pricing predictability, not compliance one-upmanship.

## Competitor teardown: Sona (Quo)

Not a healthcare product — a general SMB phone-agent feature.

- **What it is**: Quo (formerly OpenPhone, a business phone system)'s
  built-in AI agent. Answers calls, does knowledge-base Q&A ("learns
  your services, hours, pricing, policies" from a URL/PDF/doc you
  upload), takes messages, books generic appointments, escalates to a
  human.
- **Pricing**: starts at $15/user/month, 10 free calls/month included on
  every plan, then usage-based.
- **Compliance**: nothing found — no HIPAA/BAA claim anywhere in their
  own materials. It's a phone-system feature, not a vertical healthcare
  product.
- **The honest angle**: if a prospect brings this up, it's almost always
  because they're price-anchoring against $15/user/month, not because
  they've actually evaluated it for a medical front desk. Ask directly:
  "does it have a BAA, or a hard gate that stops the AI itself from
  ever hearing a symptom and triaging it?" It doesn't. That's the whole
  conversation — don't over-argue it.

## Quick battlecard

| They say | Say this |
|---|---|
| "We already use Quo/Sona for our phones." | "That's a phone system with a generic AI bolted on — it wasn't built to keep a caller's medical history out of an AI's hands. Ours was, from the ground up." |
| "DeepCura does more than you do." | "It does — it's a full clinical documentation platform. If you need EHR sync and ambient scribing, that's the right tool. If you just need your phones answered and your chairs booked without paying per provider, that's us." |
| "How do I know it's actually HIPAA compliant?" | **Do not overclaim.** "It's built for HIPAA-grade handling — architecturally PHI-minimized, no transcripts stored, ever. We'll walk you through exactly what's stored and what isn't." (Full BAA language only after the gate above closes.) |
| "What if the AI mishandles an emergency?" | "It can't — the emergency check runs before the AI model ever sees the message. It's a hard rule, not something the AI decides." |
| "What's this cost?" | "$297 a month, flat, per location. No per-provider math, no setup fee, card on file with nothing charged until your line is live." |

Sources: [DeepCura Pricing](https://www.deepcura.com/plans-pricing) ·
[DeepCura AI Medical Receptionist](https://www.deepcura.com/resources/best-ai-medical-receptionist) ·
[Sona AI agent — Quo](https://support.quo.com/core-concepts/ai-automations/sona-ai-agent) ·
[Quo Sona product page](https://www.quo.com/sona)
