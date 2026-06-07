# QuiQui

A lightweight live audience response tool for university lectures. The lecturer poses a question, students answer on their own devices, and the class sees a live bar chart of the distribution. The teacher can optionally reveal correct answers at any time.

> Deliberately minimal: no accounts, no app installs, no scoring. Requires just a github repo with your questions in yaml.

**→ [Quickstart guide for lecturers](QUICKSTART.md)** — get up and running in 5 minutes.

**→ [Live hosted service](https://quiqui-x9um.onrender.com)** — hosted instance (may take ~30s to wake up on first visit).

---

## Features

- **Teacher-paced** — the lecturer controls which question is active; students cannot browse ahead
- **No student login** — students join by scanning a QR code or visiting a URL
- **Optional shortlink** — a lecturer-provided `student_shortlink` in `config.yaml` is shown in the teacher view and used in place of the long join URL on the projector, so students can type a memorable address
- **Live results** — bar chart updates in real time as students submit
- **Four-state flow** — Activate → Deactivate (bars, no highlights) → Reveal (correct answers highlighted) → Close (students return to waiting screen)
- **Reveal answer** — teacher reveals correct answers; correct options are highlighted in green for everyone in the room
- **Single and multiple choice** — per-question type configured in YAML
- **Markdown and LaTeX** — question text and answers support code blocks, inline code, and math expressions
- **Questions in Git** — question files live in a public GitHub repo; no admin interface needed
- **Multiple concurrent sessions** — each repo's `session_url` defines an independent session; the URL must be unique per lecturer (e.g. `tum-python101`), as two sessions with the same `session_url` from different repos cannot coexist
- **No database** — all session state is in memory and intentionally ephemeral
- **No build step** — vanilla HTML/CSS/JS frontend, deploy anywhere Node.js runs

---

## Installation

> **Lecturer?** See the [Quickstart guide](QUICKSTART.md) for a step-by-step walkthrough with screenshots.

### Prerequisites

- Node.js 18 or later
- A public GitHub repository containing your question YAML files (see [albrechtje/quiqui-questions](https://github.com/albrechtje/quiqui-questions))

```bash
git clone https://github.com/albrechtje/quiqui.git
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

Questions live in a **public GitHub repository**, one `.yaml` file per lecture. See [albrechtje/quiqui-questions](https://github.com/albrechtje/quiqui-questions) for the full format reference and working examples.

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
    ├── projector.html      # Presenter/beamer view — read-only, shows QR + live results
    ├── privacy.html        # Privacy policy (DE/EN)
    ├── style.css           # Shared styles
    ├── projector.css       # Presenter-view styles
    ├── teacher.js          # Teacher frontend logic
    ├── student.js          # Student frontend logic
    ├── projector.js        # Presenter-view frontend logic
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

---

## License

[AGPL-3.0](LICENSE)
