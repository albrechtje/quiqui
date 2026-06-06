# QuiQui

A lightweight live audience response tool for university lectures. The lecturer poses a question, students answer on their own devices, and the class sees a live bar chart of the distribution. The teacher can optionally reveal correct answers at any time.

> Deliberately minimal: no accounts, no app installs, no scoring. Requires just a github repo with your questions in yaml.

**→ [Quickstart guide for lecturers](QUICKSTART.md)** — get up and running in 5 minutes.

**→ [Live hosted service](https://quiqui-x9um.onrender.com)** — hosted instance (may take ~30s to wake up on first visit).

---

## Features

- **Teacher-paced** — the lecturer controls which question is active; students cannot browse ahead
- **No student login** — students join by scanning a QR code or visiting a URL
- **Live results** — bar chart updates in real time as students submit
- **Show answer** — teacher can reveal correct answers at any time; correct options are highlighted in green for everyone in the room
- **Single and multiple choice** — per-question type configured in YAML
- **Markdown and LaTeX** — question text and answers support code blocks, inline code, and math expressions
- **Questions in Git** — question files live in a public GitHub repo; no admin interface needed
- **Multiple concurrent sessions** — each repo's `session_url` defines an independent session
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

Both commands set the required git environment variables automatically (see `start.sh`). Do not run `node server.js` directly — git cloning will hang or fail without them.

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
    ├── privacy.html        # Privacy policy (DE/EN)
    ├── style.css           # Shared styles
    ├── teacher.js          # Teacher frontend logic
    ├── student.js          # Student frontend logic
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
| `session-state` | server → client | `{ exists, question, votes, open, total, title, answersRevealed, correctIndices }` | Current state sent on join |
| `session-created` | server → clients | — | Emitted when a teacher pulls a repo; updates waiting students |
| `activate-question` | client → server | `{ question, sessionId, token, title }` | Teacher activates a question |
| `question-activated` | server → clients | `{ question, sessionId, title }` | Broadcast to all students in session |
| `submit-answer` | client → server | `{ sessionId, selected: [0, 2] }` | Student submits answer indices |
| `vote-update` | server → clients | `{ votes, total }` | Broadcast after each new vote |
| `show-answer` | client → server | `{ sessionId, token }` | Teacher reveals correct answers (closes voting implicitly) |
| `answer-revealed` | server → clients | `{ correctIndices, votes, total }` | Correct answer indices broadcast to all; students see green highlights |
| `close-voting` | client → server | `{ sessionId, token }` | Teacher closes voting without revealing answers |
| `voting-closed` | server → clients | — | Students return to waiting screen |
| `session-expired` | server → clients | — | Session timed out; teacher UI locked, students see "no session" message |

---

## Security model

QuiQui uses a shared-secret approach suited for lecture deployments:

- **Teacher page** is only reachable at `/:teacherSlug` — the HTML file is not accessible as a static asset
- **Teacher API endpoints** (`/api/pull`, `/api/questions`, `/api/qr`, `/api/session`) require an `X-Teacher-Token` header matching the slug
- **Teacher socket events** (`activate-question`, `close-voting`, `show-answer`) require a `token` field matching the slug
- **Student endpoints** (`/join/:sessionId`, socket events) are intentionally open — no login required
- **Only public GitHub repos** are accepted — `file://` and `ssh://` URLs are rejected; repo size is checked via the GitHub API before cloning

This is not a substitute for HTTPS or a proper authentication system. For a shared deployment used by multiple lecturers, add authentication in a future version.

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
