# MedLab AI Receptionist

HIPAA-conscious voice + WhatsApp appointment receptionist for US medical
labs. B2B SaaS, $297/mo per location. Repurposed from the TCD logistics ops
engine (`Abuja-Ops-Project/tollyclassic-ops-TCD-`).

## Structure

This is a monorepo with three independently deployed apps:

| | What | Stack | Deploy |
|---|---|---|---|
| [`medlab-engine/`](medlab-engine/README.md) | The receptionist itself — Twilio voice/WhatsApp webhooks, Gemini function-calling conversation engine, HIPAA guardrails | Node/Express | Railway |
| [`medlab-web/`](medlab-web/README.md) | Front-desk console (live call feed, scheduling, compliance) + self-serve lab signup and billing | Next.js 16, Supabase, Stripe | Vercel |
| `mission-control/` | Agency ops console — portfolio dashboard across all tenants: clients, leads, trials, billing, support, conversations, AI health, analytics | Next.js 16, Supabase, Stripe | not yet deployed (`:3002` locally) |

Root-level `*.dc.html` files + `support.js` are static design mockups (open
directly in a browser) — not part of the running product.

## Current state (2026-07-19)

`main` is fully current and deployed to production (Vercel). As of
2026-07-18 it merged in everything that used to live on separate branches:
the terracotta onboarding redesign, four US-market compliance guardrails
(emergency 911 gate, TCPA STOP opt-out, AI disclosure, caller-scoped
cancel/reschedule), the SMS text-to-book channel, Twilio send-reliability
and per-tenant WhatsApp-sender fixes, and a full console dashboard
buildout — Scheduling grid with walk-in holds and blocked windows, a
per-tenant test catalog, emergency email/SMS paging, dark mode, cmd-K
search, team/role management, and more. `legacy-main` (pushed to origin)
preserves the pre-merge state if the original demo copy is ever needed
again. See `CLAUDE.md` → *Branching* for the full history and → *US-market
guardrails* / *Console dashboard-buildout* for what actually shipped.

**Not yet cleared for real patient traffic**: Railway production was last
confirmed running the AI-Studio-key Gemini auth path, not the
BAA-eligible Vertex AI path local dev uses — see `CLAUDE.md`'s HIPAA
posture section. The owner wants every compliance box ticked before this
goes live with real patients, and that's the one still open.

## Quick start

```bash
# engine
cd medlab-engine
npm install
cp .env.example .env      # fill in GEMINI_API_KEY + Twilio creds
npm run dev                # :3000

# console (separate terminal)
cd medlab-web
npm install
cp .env.example .env.local
npm run dev                # :3001
```

Both run fine without external keys for local dev: the engine falls back to
an in-memory store (no Supabase), and the console falls back to the
engine's live SSE feed (no Supabase) or its own scripted demo data (engine
down too).

See each service's README for full setup, environment variables, and
deployment details. See `CLAUDE.md` for architecture notes (auth model,
multi-tenancy, the onboarding/billing state machine) that span both
services.
