# Voice guide (AI)

A guide you talk to. It hears a question, changes the view, and answers out
loud from the app's own cited data. It drives the same view control as the
recorded guides ([guides.md](guides.md) §2).

Status: design only. Nothing here is built, and nothing in
[guides.md](guides.md) depends on it. The shipped site stays a static,
assets-only Worker until the user decides otherwise. Every cost and latency
figure below is an estimate and says so.

## 1. Goals and non-goals

### Goals

- G1. "Show me where Mars is", "what is that under Africa", "take me to
  Iceland and show the plume": spoken, done, answered.
- G2. Answers about what the view shows come from the app's data and name
  the layer they came from. The AI does not invent figures.
- G3. The view starts to change within about 1.5 s of the user finishing, and
  speech starts within about 2 s.
- G4. The service cannot be used without paying for it, cannot spend more
  than a set amount, and stores no speech and no transcripts.
- G5. The site works exactly as before for anyone who does not use it.

### Non-goals

- No AI in the page's load path. No AI call without the user asking.
- No free anonymous AI. An open endpoint in front of a paid model is a gift
  to whoever finds it.
- No speech model of our own. Hearing is the browser's
  (`app/src/voice/voice-control.ts:41-45`).
- No memory between sessions. No user profiles.
- No AI-written narration in shipped guides without a person checking the
  facts.

## 2. Architecture

```
 microphone
     │  Web Speech API (browser; Chrome sends audio to Google)
     ▼
 text ──► fixed grammar (voice/commands.ts) ── a command? ──► view control ──► spoken reply
     │                                              no
     ▼
 AI client (app/src/ai/)            only if the user has turned the AI on
     │  POST /v1/turn  { history, view state, tool results }      bearer token
     ▼
 Worker `transparent-ai`  ──►  Claude Messages API (streaming, tools)
     │  SSE: text deltas, tool calls
     ▼
 AI client ──► tool calls ──► view control (same ViewAction JSON as a guide cue)
          └──► text ──► speech (browser), sentence by sentence; captions
```

Decisions:

- **The fixed grammar goes first.** A phrase the grammar understands
  (`parseCommand`, `app/src/voice/commands.ts:157`) never reaches the
  network. "Show stars" stays instant, free and offline-capable. Only an
  `unknown` goes to the AI, and only when the AI is on.
- **A second Worker, not Worker code on the site.** `transparent-ai` at
  `ai.transparent.sbdev.io` is its own Worker with its own `wrangler.jsonc`.
  The site's Worker stays assets-only, so AGENTS.md's claim about it stays
  true and the site deploys with no secret. GitHub Pages can use the same
  service.
- **The tools run in the browser.** The view is in the browser, so the
  Worker cannot run a tool. The model asks, the Worker relays, the browser
  acts and sends results back with its next request.
- **The Worker holds nothing between requests** except counters. The browser
  holds the conversation and sends it each turn. The Worker pins the model,
  the system prompt, the tool list and `max_tokens`. The client supplies
  none of those.
- **Plain Messages API, tool use, a loop we own.** Not Managed Agents: there
  is no sandbox to host, the tools are the user's own browser, and the
  budget is a couple of seconds. The loop is two calls at most (§3.3).

## 3. Tools

### 3.1 Doing

The `ViewAction` union from [guides.md](guides.md) §2.3, one tool per
action. The tool input schemas are cut from the same `guide.schema.json`
definitions the guide validator uses, by a script, and checked in. A test
fails when they are stale.

| Tool | Input | Notes |
|---|---|---|
| `apply_preset` | `{ id }` | Enum of preset ids. |
| `set_layers` | `{ on, off }` | Ids from the catalogue in the system prompt. |
| `stand_at` | `{ place }` | `here`, `antipode`, or lat/lon with a name. |
| `set_time` | `{ at, rate, until }` | Same caps as a guide (§7.3 there). |
| `look_at` | `{ target, fovDeg }` | In pose mode the result says `awaitingGaze`; the AI says which way to turn. |
| `set_fov` | `{ fovDeg }` | |
| `mark` | `{ target, text }` | |
| `play_clip` | `{ hotspot }` | Only hotspots `nearby` or `find` returned. |
| `start_guide` | `{ id, step }` | Hands over to a recorded guide. |

Left out on purpose: Cardboard calibration and exit (the fixed grammar has
them), anything that saves to `localStorage`, and layer parameters until
[guides.md](guides.md) phase 5.

The AI's session borrows the view (`ViewControl.borrow`), as a guide does.
What it changes is put back when the user says "back to my view" or turns
the AI off.

### 3.2 Reading

| Tool | Returns |
|---|---|
| `find` | `{ query }` → up to 8 matches: name, kind, the layer that carries it, whether that layer is on, direction (azimuth, altitude), angle from the view's centre. Needs `LabelLayer.find` ([guides.md](guides.md) gap 5) and the ephemeris for bodies. |
| `nearby` | `{ target, radiusDeg }` → names and hotspots within the radius. |
| `layer_info` | `{ id }` → label, caption, legend text, credits (source, licence), whether it is live, and its data note. |
| `guide_step` | → the playing guide's id, chapter, step, and that step's caption text. |

**The view state rides along with every turn** instead of being a tool: the
place, the clock, the aim mode and aim, the field of view, the switches that
are on, and up to 20 names nearest the view's centre. "What's that?" then
needs no extra round trip.

### 3.3 The loop

- A response that calls only doing tools is final. The browser performs
  them, speaks the text, and sends the results with the **next** user turn.
  One model call.
- A response that calls a reading tool needs a second call with the result.
  Two model calls.
- Two calls a turn at most. Six tool calls a response at most. The Worker
  enforces both.

Estimate: 1.3 model calls per user turn.

### 3.4 Schemas

Tools are `strict: true` with `additionalProperties: false`, so a tool input
always parses as a valid `ViewAction`. `tool_choice` is `auto`: forcing a
tool returns a 400 on Sonnet 5.5, Opus 5.5 and Fable 5.2, and the design
should not depend on a choice only one model accepts. The system prompt says
when to act and when to answer.

`Target` is a union of five shapes. If the strict schema subset does not
take that union as written, flatten it to one object with a `kind` enum and
nullable fields, and convert in the adapter (Q1).

The browser validates every tool input against the schema again before
performing it. A streamed tool call can arrive cut short.

## 4. Grounding and safety

### 4.1 What the AI may say

Two registers, and the reply marks which is which:

1. **What the app shows.** Any figure, name, place, date or measurement about
   something in the view comes from a tool result or the view state: a
   label's text, a layer's caption, a credit, a data note, a guide step's
   captions. The reply names the layer. The client turns each named layer
   into a credit chip and drops any id that does not exist.
2. **Background.** Ordinary science a narrator would add ("S waves do not
   travel through liquid"). Allowed, short, and never a figure the app also
   holds. If the app has no layer on a subject, the AI says so instead of
   reciting one.

The system prompt states both rules and gives the catalogue: every switch's
id, label, section and caption, and every preset. `layer_info` gives the
rest.

The data notes in `docs/data-sources/` are about 276 KB, roughly 70,000
tokens (estimate). They do not go in the prompt. A build step, in the manner
of `app/scripts/data-sources.ts`, writes one short note per layer from the
layer's definition and its data-source document, and `layer_info` serves it.

### 4.2 What stops it going wrong

- **An eval before launch.** A set of questions with known answers from the
  app's data, graded on three things: the right action, a figure that
  matches the data, a layer cited. No launch below an agreed score (Q2). The
  eval is also how the choice of model is settled (§6).
- **The licence-bound sources.** Several sources are non-commercial or
  share-alike (`docs/DATA-SOURCES.md`, first table). The AI quotes them with
  their credit like any other. Whether a paid service may show them at all
  is §8.5.
- **Refusals.** The Worker checks `stop_reason` before reading content. A
  refusal becomes "I can't help with that." Haiku 5.5 has no server-side
  fallback model, and none is needed here.
- **Prompt injection.** Everything the model reads besides the user's words
  is ours: the catalogue, labels, captions, notes. Live feeds carry names
  from outside (cyclones, earthquakes, satellites). Tool results wrap them as
  data, and no tool does anything with a consequence beyond the user's own
  screen.
- **Children.** Schools are the main customer (§8). The Worker stores no
  transcript and no audio. The browser's speech recognition already sends
  audio to its vendor (`app/src/voice/voice-control.ts:13-16`). A school
  licence has to say both things plainly (Q6).
- **Off-topic use.** The system prompt keeps it to the Earth, the sky and
  the app. Turn length and daily caps bound what a determined user can get
  out of it (§5).

## 5. Exposure and security

`transparent-ai` is Worker code on a `public` posture. It gets its own row in
AGENTS.md's exposure table in the commit that creates it. These are
requirements, not suggestions.

### 5.1 Routes

| Route | Auth | Purpose |
|---|---|---|
| `POST /v1/session` | Licence code in the body (or, later, a signed-in user) | Returns a bearer token good for 30 min, bound to that licence. |
| `POST /v1/turn` | Bearer token | One turn. Streams SSE. |
| `OPTIONS *` | None. CORS preflight carries no credentials by specification. | Returns CORS headers to the two site origins and nothing else. |

There are no other routes. No health check, no version, no debug. Anything
else is a 404 with an empty body. Every route that does work checks its
credential first, in one function with a test that counts its call sites
against the route table.

### 5.2 Authorisation

- A token is an HMAC over `{ licence id, seat, expiry }`. The Worker checks
  it with no lookup.
- A token allows `POST /v1/turn` for its own licence and nothing else. There
  is nothing to read back, so there is no object another user could reach.
- A licence can be revoked: its record is deleted and new sessions fail.
  Live tokens die within 30 min.
- Licence codes are stored hashed.

### 5.3 Validation at the boundary

The browser is not trusted. `POST /v1/turn` rejects, with a 400 and a fixed
message:

- a body that is not JSON or does not match the request schema, unknown
  properties included
- more than 40 messages of history, or any message over 4,000 characters
- a role other than `user`, `assistant` with our own tool names, or tool
  results that answer a call in the history
- a view state that fails its schema

The client cannot set the model, the system prompt, the tools, `max_tokens`
or the effort. A client can lie about its history. It only fools its own
session, and the caps still count.

### 5.4 Caps

| Cap | Value |
|---|---|
| Request body, `/v1/turn` | 32 KiB, checked on `Content-Length` and again while reading |
| Request body, `/v1/session` | 1 KiB |
| Time to read the request body | 5 s |
| Upstream: time to first byte | 10 s |
| Upstream: whole turn | 30 s, then the stream is closed with an error event |
| Output tokens a model call | 600 |
| Model calls a turn | 2 |
| Tool calls a response | 6 |
| Turns in flight per token | 1 |
| Turns in flight per licence | its seat count |
| Turns in flight, whole service | 50 |
| Turns a minute per token | 10 |
| Turns a day per seat | 200 |
| New sessions a minute per IP address | 10 |

The counters live in a Durable Object per licence and one for the service, so
a count is exact under concurrency.

### 5.5 Spend cap

- Every licence has a monthly token budget set when it is sold.
- The service has a daily dollar cap, a constant in the Worker's config.
  Start at $20 a day (estimate of need: §6.3 puts that at about 1,400
  sessions).
- Before each model call the Worker reserves the worst case: the input it is
  about to send plus `max_tokens`. If the reservation would pass either cap
  the call is not made and the turn ends with 429 and "The AI guide has
  reached its limit for today." After the call it corrects the reservation
  from the response's `usage`.
- Behind that, a spend limit on the API workspace the key belongs to. Two
  locks, the second one not ours to get wrong.

### 5.6 What leaves the Worker

- **Responses** carry model text, tool calls and one of a fixed set of error
  strings. No upstream error text, no upstream request id, no licence id, no
  stack trace, no model name.
- **Logs** carry a time, a salted hash of the licence id, token counts,
  latency, status and which cap fired. No transcript, no tool input, no
  code, no token, no IP address beyond what Cloudflare keeps by itself.
- **The API key** is a Worker secret. It is put there with
  `devkey run <key> -- npx wrangler secret put …`, is registered in
  `dev-setup/config/devkey/registry.kdl`, and is in no file, no log and no
  chat. A deploy is verified by a 401 from `/v1/turn` with no token and a
  200 with one, never by printing anything.
- **CORS** allows `https://transparent.sbdev.io` and
  `https://andylbrummer.github.io` only.

### 5.7 On the site

The site needs `connect-src` to reach the AI origin if a full CSP exists by
then ([guides.md](guides.md) §10.3). The token lives in memory, not in
`localStorage`. A licence code, on a shared classroom phone, lives in
`localStorage` so a teacher types it once. It is a seat on a capped licence,
not a key to anything else.

## 6. Models and cost

Prices per million tokens, input / output, as of 2026-11: Haiku 5.5
$0.10 / $0.50, Sonnet 5.5 $2 / $10, Opus 5.5 $4 / $20, Fable 5.2 $8 / $40.
Cache reads cost about a tenth of input on Haiku 5.5, $0.10 on Sonnet 5.5
and $0.20 on Opus 5.5. A cache write costs 1.25 times input and lasts five
minutes, renewed on each read.

### 6.1 A model for each role

| Role | Model | Why |
|---|---|---|
| Live voice turn | `claude-haiku-5-5`, effort `low` | The turn is bound by latency, and the task is narrow: pick an action from a short list, answer in two sentences from supplied text. It is also 20 times cheaper than the next step up. |
| Live turn, if the eval says Haiku is not good enough | `claude-sonnet-5-5`, effort `low` | The measured step up. Not offered beside Haiku: caches are per model, and two models in one conversation pay for the prefix twice. |
| Drafting guide scripts offline | `claude-fable-5-2` | The most capable model, with long turns that would be useless in a live loop. An author runs it against the data-source documents and gets a draft script and cue list to fact-check, record and caption. This is the author's own workflow, on their machine with their key: nothing in the app or this repo builds or calls it. |
| Checking a draft against the sources offline | `claude-opus-5-5` | Optional second pass before a person reads it. |

Opus 5.5 has no place in the live loop: it costs twice Sonnet for a task
Haiku should do. Thinking is on by default on all four, so effort is the
control, and it must be set: Haiku 5.5 defaults to `medium`.

### 6.2 What a session costs (estimate)

Assumptions, all estimates until measured:

| Quantity | Value |
|---|---|
| Fixed prefix: system prompt 1,500 + tools 2,500 + catalogue 3,500 tokens | 7,500 tokens, cached |
| View state per call | 400 tokens |
| History per call, averaged over a session (250 tokens a turn, 10 turns back on average) | 2,500 tokens |
| Output per call: thinking, speech, tool calls | 250 tokens |
| Turns a session | 20 |
| Model calls a turn | 1.3 → 26 calls |
| Cache: one write, then 25 reads (turns under 5 min apart) | 96% of prefix tokens read from cache |

History is costed as uncached, which overstates it.

Per session:

| | Tokens | Haiku 5.5 | Sonnet 5.5 | Opus 5.5 |
|---|---|---|---|---|
| Cache write | 7,500 | 7,500 × $0.125/M = $0.0009 | × $2.50/M = $0.019 | × $5/M = $0.038 |
| Cache reads | 25 × 7,500 = 187,500 | × $0.01/M = $0.0019 | × $0.10/M = $0.019 | × $0.20/M = $0.038 |
| Uncached input | 26 × 2,900 = 75,400 | × $0.10/M = $0.0075 | × $2/M = $0.151 | × $4/M = $0.302 |
| Output | 26 × 250 = 6,500 | × $0.50/M = $0.0033 | × $10/M = $0.065 | × $20/M = $0.130 |
| **Session** | | **$0.014** | **$0.25** | **$0.51** |

Without caching the Haiku session is 26 × 10,400 = 270,400 input tokens,
$0.027, plus output: $0.030. Caching halves it.

So a 20-turn session is about a cent and a half on Haiku 5.5 and about a
quarter on Sonnet 5.5 (estimates). The model is not the cost that decides
the business. Payment fees, support and making guides are.

### 6.3 Speech out

The browser's own speech is free, starts fast and is already wired
(`speakWithBrowser`, `app/src/voice/voice-control.ts:52-63`). Its voices
vary by device and some are poor.

A speech service sounds better and costs more than the model. A session
speaks about 20 × 350 = 7,000 characters. At $15 per million characters,
which is an assumed price and not a checked one, that is $0.10 a session:
seven times the Haiku cost. It also adds a network hop to every sentence.

Start with the browser's speech. Price a service only if the voice is what
stops people using it (Q3).

### 6.4 Volume (estimate)

| Who | Sessions a month | Haiku 5.5 | Sonnet 5.5 |
|---|---|---|---|
| One person, twice a week | 8 | $0.11 | $2.00 |
| A class set: 30 phones, 3 sessions a school day, 20 days | 1,800 | $25 | $457 |
| A museum floor: 10 viewers, 40 sessions a day each, 30 days | 12,000 | $163 | $3,050 |

## 7. Latency budget

Claude takes text, so the chain is speech to text, model, text to speech.
Targets, to be measured on a Pixel 6 Pro before anything is promised:

| Stage | Target | Notes |
|---|---|---|
| End of speech → final text | 300–800 ms | The browser's recogniser. Push-to-talk ends on release, which is the fast case. The wake word path waits for the recogniser to decide the phrase is over. |
| Fixed grammar check | < 5 ms | Local. A hit stops here. |
| Browser → Worker → API | 50–150 ms | |
| Model: first output the user can use | ≤ 700 ms | Unknown until measured. Thinking comes first, and at effort `low` it should be short. The cached prefix is what keeps this down. |
| First tool call complete → view changes | + 100–300 ms | The prompt asks for actions before words. |
| First sentence complete → speech starts | + 200–400 ms | Speak sentence by sentence as the stream arrives. |
| **End of speech → view moves** | **≤ 1.5 s** | |
| **End of speech → first spoken word** | **≤ 2.0 s** | |

What the design does for it:

- Stream. Act on each tool call as its block closes. Speak each sentence as
  it ends.
- Keep the prefix identical across calls and users so it is always a cache
  read: no time, no session id, no user data before the cache breakpoint.
  The view state and history go after it.
- One model call for most turns (§3.3).
- Short replies. The system prompt asks for two sentences, and `max_tokens`
  is 600.
- A "thinking" tick in the voice readout after 600 ms, so a slow turn does
  not look like a dead one.
- Speech in progress stops the moment the user talks again, as today
  (`app/src/voice/voice-control.ts:130`).

If the measured figures miss by a wide margin, the next lever is fewer
tokens in the prefix, then the reply length. A larger model makes it worse.

## 8. Business model

### 8.1 What can be sold

The code is MIT. The data keeps its publishers' licences
(LICENSE-DATA.md). Anyone may host a copy of the whole app for nothing. So:

| Thing | Defensible? |
|---|---|
| The app, the layers, the data | No. Open by design, and that is the point of the project. |
| The AI service | Yes. It costs money per use and needs a key and an operator. A copy of the site does not come with one. |
| Guides we write and record | Partly. A script and a recording are new works with their own licence (guides.md Q2). Open guides build the audience. Commissioned ones are paid for once. |
| Running it for a place: a class set, a museum floor | Yes. Set-up, a code that works on thirty phones, guides for the syllabus or the exhibit, someone to call. |
| The name and the curation | Slowly. |

Revenue has to come from service and from work done, not from access to the
content.

### 8.2 The options

| Option | Money in | Money out | Needs | Verdict |
|---|---|---|---|---|
| **Free core, paid AI by subscription** | $3–5 a month a person | AI ≈ $0.11 a month (§6.4); card fee about 2.9% + $0.30, so $0.39 of $3 (check current rates) | Accounts, sign-in, Stripe subscriptions, cancellations, refunds | The cost side works. The demand side does not: a sky map is opened now and then, and people cancel what they use twice a month. |
| **Free core, paid AI by credits** | $5 for a pack | Same AI cost; fee $0.45 of $5 | Accounts, Stripe Checkout, a balance | Fits how it is used. A $5 pack is about 350 Haiku sessions (estimate), so most buyers never buy twice. Small money, simple to run. |
| **Bring your own key** | Nothing | Nothing | No Worker. The browser calls the API with the user's key. | Reaches developers only. It asks people to paste a secret into a web page that has no CSP today. Useful as a private preview of the tool surface, not as a product. |
| **Institutional licences** | $300–1,500 a year a site (estimate; to be tested with real buyers) | AI $25–165 a month at the volumes in §6.4, so $300–2,000 a year on Haiku: price by seats and usage, not flat | Licence codes, seat caps, an invoice. No consumer accounts. | The buyer has a budget, a need (a lesson, an exhibit) and no wish to build it. The work that is hard to copy is here. |
| **Commissioned and sponsored guides** | $2,000–10,000 a guide (estimate) | Writing, recording, checking | The guide system. A `sponsor` field (guides.md §3.1). | Pays for content directly. Needs a rule that a sponsor does not edit the science, and a visible "commissioned by". |
| **Grants for open science education** | Tens of thousands, once | Proposal time; reporting | A track record: guides in use, a school or museum partner | Fits an open project better than anything else and funds guides without a paywall. Slow, uncertain, and it does not recur. |

### 8.3 Recommendation

**Primary: institutional licences**, for schools, museums and planetariums. A
licence is a code for a set of phones or viewers, with the AI guide turned
on, a seat count, a monthly budget, and the guides the place needs.

Why this one:

- It sells the two things that can be defended: a running service and work
  done for a customer.
- The cost of the AI is small against a site licence, even with the caps
  generous.
- It needs the least machinery: no consumer accounts, no card form, no
  personal data. A code and an invoice.
- It is what the guide system is for. A class of thirty with Cardboard
  viewers following one guide is the planetarium use the user described.

**Sequence:**

1. **Guides ship, free and open.** This is [guides.md](guides.md). It builds
   what everything else stands on and costs nothing to run.
2. **Private preview of the AI with our own key**, behind the licence-code
   gate from day one, for the user and a few testers. Settles the eval, the
   latency and the real cost per session.
3. **One or two pilot sites**, free or cheap, invoiced by hand. Learn what a
   teacher and a museum floor need. Their letters support step 5.
4. **Paid institutional licences**, priced from the pilots.
5. **Grant applications** with the pilots as evidence, to fund guides.
6. **Commissioned guides** as they are asked for.
7. **Consumer credits**, only if people ask to pay. This is the step that
   brings accounts and a card form, so it comes last.

Bring-your-own-key is not in the sequence. Step 2 does its job without
teaching users to paste keys into pages.

### 8.4 What it needs built

| Step | Auth | Billing | Storage |
|---|---|---|---|
| 2–4 | Licence codes, hashed. HMAC session tokens. | An invoice. Stripe Invoicing if wanted; nothing in the app. | One Durable Object per licence: seats, budget, usage. |
| 7 | Sign-in by emailed link from an auth provider. No passwords. | Stripe Checkout for packs; one webhook route on the Worker, verified by Stripe's signature. | A balance per account in D1. |

Step 7 adds two routes and a store of email addresses, which is personal
data with the duties that follow. That is the reason to put it last and to
build it only on demand.

### 8.5 The licence problem to settle first

Some of the data is licensed for non-commercial use: the Smithsonian
volcano database, TeleGeography's cable map (CC BY-NC-SA), the SDO and SOHO
solar images (`docs/DATA-SOURCES.md`, first table). A free educational site
is within those terms. A site sold to a museum may not be, and the AI
quoting those layers inside a paid service is closer still to the line.

Each such source "sits in its own files and can be removed without touching
other layers" (`docs/DATA-SOURCES.md`). So there are three ways through: ask
each publisher, turn those layers off under a paid licence, or charge only
for the service and the guides and keep the site itself free to all. The
third is what this design already does. Whether that is enough is a legal
question for the user, not one a spec can answer (Q5).

## 9. Phases

All after [guides.md](guides.md) phase 3. Each line is one commit.

### Phase A — the tool surface, no AI

1. `feat(view)`: `find` and `nearby` on the view control (needs guides.md
   phase 5 commit 1).
2. `feat(ai)`: tool schemas cut from `guide.schema.json`; the freshness
   test.
3. `feat(ai)`: per-layer notes and `layer_info`, built by a script.
4. `test(ai)`: a tool-call replay harness: recorded tool calls run against
   the view control in the browser harness. No model, no network.

Phase A is useful by itself. It proves the vocabulary is enough for an AI
before a cent is spent.

### Phase B — the service, private

1. `chore(infra)`: `transparent-ai` Worker skeleton: the route table, 404
   for everything else; AGENTS.md exposure row.
2. `feat(ai-worker)`: `/v1/session`, licence codes, tokens, tests for every
   refusal.
3. `feat(ai-worker)`: request validation and body caps.
4. `feat(ai-worker)`: concurrency, rate and daily caps in Durable Objects.
5. `feat(ai-worker)`: the spend cap, reserve and correct.
6. `feat(ai-worker)`: `/v1/turn`: the relay, streaming, the two-call loop,
   timeouts, fixed error strings.
7. `test(ai-worker)`: a test that reads the route table and asserts each
   route calls the auth check; a test that no log line holds a body.
8. `feat(ai)`: the browser client: grammar first, then the AI; streaming
   speech; captions; the "thinking" tick; off by default behind a licence
   code.
9. `test(ai)`: the eval set and its runner.

### Phase C — pilots

1. `feat(ai-worker)`: seat counts and monthly budgets per licence; a
   command-line tool to issue and revoke codes.
2. `feat(ai)`: classroom mode: a teacher's code on thirty phones; "follow
   the guide" start.
3. `docs`: a plain-language privacy note for schools.

### Phase D — only on demand

Consumer sign-in and credits (§8.4, step 7).

## 10. Open questions

- **Q1. Strict schemas and the `Target` union.** Does the strict tool subset
  take it as written? Test in phase A. If not, flatten.
- **Q2. The eval bar.** What score lets it launch, and who writes the
  questions? It needs someone who knows the geology.
- **Q3. Speech out.** Is the browser's voice good enough on the phones
  schools have? If not, which service, at what checked price?
- **Q4. Is Haiku 5.5 good enough?** The eval answers it. If the answer is
  Sonnet 5.5, every cost in §6 is about 18 times higher and the licence
  prices in §8.2 move with it.
- **Q5. Non-commercial data under a paid licence** (§8.5). Needs the user,
  and probably a lawyer.
- **Q6. Children's data.** Schools will ask about COPPA, FERPA and GDPR. The
  Worker stores nothing, but the browser's speech recognition is a third
  party. Is push-to-talk with on-device recognition (Safari) a requirement
  for school licences?
- **Q7. Languages.** The fixed grammar is English
  (`app/src/voice/commands.ts`). The model is not limited that way. Does a
  licence promise other languages?
- **Q8. Who operates it.** A paid service needs someone to answer when it is
  down. Is that the user alone?
- **Q9. Pricing.** Every figure in §8.2 is a guess until a school and a
  museum have been asked.
- **Q10. The daily cap.** $20 is a starting value. It should follow the
  number of licences sold.
