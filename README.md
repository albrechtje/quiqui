<img src="public/quiqui-logo.png" alt="QuiQui" width="240" />

# Live audience response for lectures — no apps, no accounts, no database

**Create a quick quiz with QuiQui and turn any lecture into a live poll in seconds.** You activate a question, students scan a QR code and answer on their phones, and the whole room watches the results fill in on a live bar chart. Reveal the correct answer whenever you like — it lights up green for everyone at once.

No student sign-up. No app to install. No admin panel to click through — **your questions are just YAML files in a GitHub repo.**

**→ [Try the live demo](https://quiqui-x9um.onrender.com)** — hosted instance (may take ~30s to wake on first visit)
**→ [Quickstart for lecturers](QUICKSTART.md)** — your own quiz running in 5 minutes
**→ [FAQ](FAQ.md)** — common questions answered

---

## Why QuiQui?

Commerical poll tools want an account, a subscription, your students' data, and a lot of clicking. QuiQui does one thing: **live in-class polling, stripped to the essentials.**

📝 **Your questions are plain text in Git**
Write questions as simple YAML in a public GitHub repo. Version them, diff them, copy them between courses, edit them in your favourite editor. No clunky web form, no vendor lock-in — pull the latest into a session anytime.

🧮 **Built for real teaching content**
Full **Markdown and LaTeX** support in questions *and* answers — code blocks, inline code, and proper math render beautifully. Single- and multiple-choice per question.

🎯 **Zero friction for students**
They scan a QR code (or type a short URL) and they're in. No login, no app, no email. Works on any phone with a browser.

📊 **Live results, teacher-paced**
You decide which question is live — students can't skip ahead. The bar chart updates in real time as votes land, then you **reveal the correct answer** with one click and it turns green on every screen in the room.

🖥️ **A view for every screen**
A dedicated **projector view** shows the QR code and live results on the beamer, while you drive everything from the teacher view — complete with a live stopwatch so you know how long voting's been open.

🪶 **Yours to run, free and private**
No database, no tracking, no scoring leaderboards. Session state lives in memory and vanishes when the quiz ends. **Self-host it anywhere Node.js runs** — there's no build step. One instance happily serves many lecturers at once.

---

## Full feature list

- **Teacher-paced** — the lecturer controls which question is active; students cannot browse ahead
- **No student login** — students join by scanning a QR code or visiting a URL
- **Live results** — bar chart updates in real time as students submit
- **Four-state flow** — Activate → Deactivate (bars, no highlights) → Reveal (correct answers highlighted) → Close (students return to waiting screen)
- **Reveal answer** — teacher reveals correct answers; correct options are highlighted in green for everyone in the room
- **Projector view** — read-only beamer view showing the QR code and live results, separate from the teacher controls
- **Run timer** — while a question is active, the teacher view shows a live stopwatch counting up, so the lecturer can see how long voting has been open
- **Single and multiple choice** — per-question type configured in YAML
- **Markdown and LaTeX** — question text and answers support code blocks, inline code, and math expressions
- **Questions in Git** — question files live in a public GitHub repo; no admin interface needed
- **Optional shortlink** — a lecturer-provided `student_shortlink` in `config.yaml` is shown in the teacher view and used in place of the long join URL on the projector, so students can type a memorable address
- **Multiple concurrent sessions** — each repo's `session_url` defines an independent session; the URL must be unique per lecturer (e.g. `tum-python101`), as two sessions with the same `session_url` from different repos cannot coexist
- **No database** — all session state is in memory and intentionally ephemeral
- **No build step** — vanilla HTML/CSS/JS frontend, deploy anywhere Node.js runs

---

## Installation

> **Lecturer?** See the [Quickstart guide](QUICKSTART.md) for a step-by-step walkthrough with screenshots.

### Prerequisites

- Node.js 18 or later
- A public GitHub repository containing your question YAML files (see [th-nuernberg/quiqui-questions](https://github.com/th-nuernberg/quiqui-questions))

```bash
git clone https://github.com/th-nuernberg/quiqui.git
cd quiqui
npm install
```

### Configuration

Copy `.env.example` to `.env` and set your values:

```bash
cp .env.example .env
```

```env
TEACHER_SLUG=teach-xk92p   # The secret path segment for the teacher page
PORT=3000
```

`TEACHER_SLUG` is the only thing protecting your teacher page — choose something hard to guess before deploying. If not set, it defaults to `teach` (fine for local development).

### Run locally

```bash
npm start
```

Or with auto-restart on file changes:

```bash
npm run dev
```

Both commands set the required git environment variables (`GIT_TERMINAL_PROMPT`, `GIT_ASKPASS`, `GIT_PAGER`) automatically — `npm start` via `start.sh`, `npm run dev` inline. Don't launch the server without them (e.g. plain `node server.js`) — git cloning will hang or fail.

Then open:
- Teacher page: `http://localhost:3000/teach` (or your configured slug)
- Student page: `http://localhost:3000/join/<session_url>` (shown as QR code after pulling a repo)

---

## Question format

Questions live in a **public GitHub repository**, one `.yaml` file per lecture. See [th-nuernberg/quiqui-questions](https://github.com/th-nuernberg/quiqui-questions) for the full format reference and working examples.

> **Limits:** QuiQui checks the repository size via the GitHub API before cloning and rejects repos larger than **1 MB**. Individual question files larger than **100 KB** are rejected when loaded. Each question may have at most **6 answer options**. YAML files are validated on load — format errors are shown as a clear error message in the teacher view.

---

## Project structure

```
quiqui/
├── server.js               # Express + Socket.io server, all backend logic
├── teacher.html            # Teacher view — served only via the slug route, not as a static file
├── start.sh                # Sets required git env vars and launches server.js
├── package.json
├── .env.example            # Documents required environment variables
└── public/                 # Served statically (no auth required)
    ├── index.html          # Landing page
    ├── student.html        # Student view
    ├── projector.html      # Projector/beamer view — read-only, shows QR + live results
    ├── privacy.html        # Privacy policy (DE/EN)
    ├── style.css           # Shared styles
    ├── projector.css       # Projector-view styles
    ├── teacher.js          # Teacher frontend logic
    ├── student.js          # Student frontend logic
    ├── projector.js        # Projector-view frontend logic
    └── quiqui-logo.png     # Logo
```

**Why `start.sh`?** Node.js inherits the shell environment, which can include variables like `PAGER` or credential helpers that cause git to hang or throw security errors when cloning. `start.sh` sets `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=true`, and `GIT_PAGER=cat` to give git a clean, non-interactive environment. `npm start` and `npm run dev` call it automatically.

**Why is `teacher.html` outside `public/`?**  
Everything in `public/` is served statically and is publicly accessible by filename. Moving `teacher.html` to the project root means it can only be reached through the slug route — visiting `/teacher.html` directly returns 404.

---

## Socket.io events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `join-session` | client → server | `{ sessionId }` | Student joins a session room |
| `session-state` | server → client | `{ exists, question, votes, open, total, title, shortlink, answersRevealed, deactivated, correctIndices }` | Current state sent on join |
| `session-created` | server → clients | `{ title, shortlink }` | Emitted when a teacher pulls a repo; updates waiting students |
| `activate-question` | client → server | `{ question, sessionId, token, title }` | Teacher activates a question; re-activating the same question preserves votes |
| `question-activated` | server → clients | `{ question, votes, total, title }` | Broadcast to all students; includes current vote counts for re-activate |
| `submit-answer` | client → server | `{ sessionId, selected: [0, 2] }` | Student submits answer indices |
| `vote-update` | server → clients | `{ votes, total }` | Broadcast after each new vote |
| `deactivate-question` | client → server | `{ sessionId, token }` | Teacher pauses voting; students see bars without highlights |
| `question-deactivated` | server → clients | `{ votes, total }` | Students see result bars; submit disabled |
| `show-answer` | client → server | `{ sessionId, token }` | Teacher reveals correct answers |
| `answer-revealed` | server → clients | `{ correctIndices, votes, total }` | Students see green highlights on correct options |
| `close-question` | client → server | `{ sessionId, token }` | Teacher sends students back to waiting screen |
| `question-closed` | server → clients | — | Students return to waiting screen; active question cleared |
| `session-expired` | server → clients | — | Session timed out; teacher UI locked, students see "no session" message |

---

## Security model

QuiQui uses a shared-secret approach suited for lecture deployments:

- **Teacher page** is only reachable at `/:teacherSlug` — the HTML file is not accessible as a static asset
- **Teacher API endpoints** (`/api/pull`, `/api/questions`, `/api/qr`, `/api/session`) require an `X-Teacher-Token` header matching the slug
- **Teacher socket events** (`activate-question`, `deactivate-question`, `show-answer`, `close-question`) require a `token` field matching the slug
- **Student endpoints** (`/join/:sessionId`, socket events) are intentionally open — no login required
- **Only public GitHub repos** are accepted — `file://` and `ssh://` URLs are rejected; repo size is checked via the GitHub API before cloning
- **Untrusted question content is sanitised** — question and answer text comes from a public GitHub repo (which the teacher may not control), so it is treated as untrusted. The client renders Markdown/LaTeX with `marked` + KaTeX and then runs the result through [DOMPurify](https://github.com/cure53/DOMPurify) before inserting it into the page, preventing stored XSS from a malicious repo. DOMPurify's default profile permits HTML, SVG, and MathML, so KaTeX's rendered math is preserved. This applies to the teacher, student, and projector views alike.

**Multiple lecturers, one instance.** A single deployment safely supports many concurrent sessions — each is isolated by its `session_url` (see [Features](#features)), so lecturers never see or affect one another's questions, votes, or results. The one thing to know is that the teacher slug is a *single shared secret*: anyone who knows it can control any session on the instance. If your lecturers should not be able to act on each other's sessions, give each their own deployment with its own `TEACHER_SLUG`.

The slug is a shared secret, not real authentication — keep your instance behind HTTPS so it can't be read off the wire.

---

## Contributing

Bug fix pull requests are welcome. For improvement ideas and feature requests, please open an issue — this project is intentionally kept as simple as possible, so new features are discussed before implementation.

1. Fork the repo
2. Create a feature branch (`git checkout -b fix/my-fix`)
3. Commit your changes
4. Open a pull request

By submitting a contribution, you agree it is licensed under the project's [AGPL-3.0-or-later](LICENSE) terms.

---

## License

[AGPL-3.0](LICENSE)

**What this means for you, plainly:**

- ✅ **Running QuiQui for your lectures is completely free, with no obligations** — whether you use it as-is or tweak it for yourself. Just using it never requires you to share anything or ask permission.
- ✅ Self-host it for your university, department, or course as much as you like.
- 🔁 The only requirement: **if you publicly host a *modified* version**, you must make your changes available under the same license. In other words — improvements to QuiQui stay open for everyone, and nobody can take it closed-source. That's the whole point of the AGPL.

If you just want to use QuiQui in class, you owe nothing and need do nothing. The copyleft only ever applies to people who change the code *and* offer it to others.
