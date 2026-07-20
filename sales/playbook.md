# Sales playbook — Ekaabo / Kesa

For Amanda. Working scripts, not a rulebook — adapt the wording, keep
the substance. See `partner-briefing.md` for the product facts and
competitor material this leans on, and read its compliance-language
note before using anything below live.

## Cold-call opener

Keep it to two sentences before you ask a question — the goal of the
opener is to earn ten more seconds, not to pitch.

> "Hi, this is Amanda with Ekaabo — we build the AI that answers your
> phone and books lab appointments so your front desk isn't glued to
> it all day. Quick one: right now, when your line's busy or it's after
> hours, what actually happens to that call?"

Whatever they answer, you now have their real pain point instead of a
guessed one. Common answers and where to steer:

- **"It goes to voicemail."** → "So you're probably losing people who
  just hang up and call the next lab. That's the exact call Kesa
  answers instead."
- **"Front desk handles it, they're just slammed."** → "That's the
  4.2-minutes-per-call number — that's what we're taking off their
  plate, not replacing them."
- **"We have an answering service."** → "Human answering services are
  $2,800–4,500/mo territory. We're $297 flat, and it actually books the
  appointment instead of just taking a message."

## Objection handling

**"We already have a receptionist / answering service."**
Not a replacement pitch — a coverage pitch. "Kesa doesn't replace your
front desk, it catches everything they can't get to — after hours,
lunch, three lines ringing at once. Most labs see it as the appointment
that would've gone to voicemail and never got booked."

**"How do I know it's actually HIPAA compliant?"**
Do not overclaim here — see the compliance-language note in
`partner-briefing.md`. Say: "It's built for HIPAA-grade handling —
architecturally, not by policy. It never stores a symptom or diagnosis;
the system rejects that content at the point it would be written, not
after the fact. Happy to walk your compliance person through exactly
what's stored." If pushed on BAA specifically, don't improvise — flag it
and follow up rather than promise something not yet true.

**"What if the AI gets a medical emergency wrong?"**
"It can't triage wrong, because it never tries to. There's a hard check
on the caller's words before the AI model ever sees them — if it looks
like a possible emergency, it gives a scripted 911/ER redirect
immediately, no AI judgment involved. That's on purpose: a booking
assistant should never be making medical calls."

**"We're not ready to switch anything right now."**
Lower the stakes, not the price. "Totally fair — there's nothing to rip
out. It's a $0 setup, card on file, nothing charged until your number's
actually live and answering calls. You can literally try it before
anything costs you a cent."

**"Send me something in writing."**
Give them the one-pager (see `sales/` — or ask if the demo tenant is
live yet, and offer that instead once it exists: "try calling it
yourself" beats any PDF).

## Pricing bridge

**What's actually live right now: $297/mo, flat, per location.** No
per-provider math, no setup fee. Say this number with confidence — it's
real and in Stripe today.

There's an internal recommendation floating around for tiered pricing
($199/$349/$599+) — **that is not decided and not live.** Don't quote
tiers to a prospect. If asked "is there a cheaper plan," the honest
answer is "not yet — right now it's one plan, full features, flat
$297."

Bridge line if price comes up early: "Before we get to a number — what's
it costing you today when a call gets missed? A missed lab booking
isn't just $297, it's a patient who called your competitor next." Then
give the number. Don't dance around it once asked twice.

## Kesa greeting flows (what the caller actually hears)

These aren't scripts Amanda reads — they're what Kesa says on a real
call, useful for demoing what a prospect should expect to hear.

**Voice, first turn:**
> "Thanks for calling [Lab Name]. This is an automated AI assistant —
> I can help you book, check, or change a lab appointment. What can I
> help with?"

**SMS/WhatsApp, first reply of a conversation:**
> "You're chatting with [Lab Name]'s automated AI assistant. [reply to
> whatever they asked]"

Both disclosures are non-negotiable and automatic — not something a
tenant can turn off. If a prospect asks "does it ever pretend to be
human," the answer is a flat no, and you can point at this.

**If a caller volunteers medical history mid-call**, Kesa says, once:
> "You don't need to share any medical details with me — I only need
> your name, number, test, and time." — then continues booking without
> repeating back what they said. Good moment to point out live if
> you're demoing: it doesn't ignore them, it redirects cleanly.
