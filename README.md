# QuiQui

A lightweight live audience response tool for university lectures. The lecturer poses an activating question, students answer on their own devices, and the class sees a live bar chart of the distribution — no correct answer revealed, just a moment for discussion.

> Inspired by Slido and Mentimeter, but deliberately minimal: no accounts, no app installs, no scoring.

**→ [Quickstart guide for lecturers](QUICKSTART.md)** — get up and running in 5 minutes.

---

## Features

- **Teacher-paced** — the lecturer controls which question is active; students cannot browse ahead
- **No student login** — students join by scanning a QR code or visiting a URL
- **Live results** — bar chart updates in real time as students submit
- **Single and multiple choice** — per-question type configured in YAML
- **Markdown and LaTeX** — question text and answers support code blocks, inline code, and math expressions
- **Questions in Git** — question files live in a public GitHub repo; no admin interface needed
- **Multiple concurrent sessions** — each repo's `session_url` defines an independent session
- **No database** — all session state is in memory and intentionally ephemeral
- **No build step** — vanilla HTML/CSS/JS frontend, deploy anywhere Node.js runs

---

## How it works

### Teacher flow

1. Open your bookmarked teacher URL: `https://your-deployment.com/teach-xk92p?repo=https://github.com/you/quiqui-questions`
2. The repo is pulled automatically; the QR code and join URL appear in the top card — project these on screen for students to scan
3. Select a question file from the dropdown, then click a question to preview it
4. Click **Activate** to open voting — the live bar chart starts updating as students answer
5. Click **Close voting** when done — students are sent back to the waiting screen
6. Click **Next question →** to advance, or pick any question from the list

### Student flow

1. Scan the QR code or visit the join URL (e.g. `https://your-deployment.com/join/python101`) — no login required
2. Wait on the waiting screen until the lecturer activates a question
3. Select your answer(s) and submit — you can only submit once
4. See the live distribution of answers across the class
5. When the lecturer closes voting, you return to the waiting screen for the next question

### Session lifecycle

- A session is created when a teacher pulls a repo. It is identified by `session_url` from `config.yaml` (or a random ID if absent).
- The session expires after **90 minutes of inactivity** (no pull, activate, or close action). On expiry, all server-side state and cloned files are deleted automatically.
- Students at the join URL see "Waiting for the lecturer" while a session is active, and "No quiz session active at this URL" after it expires — without needing to refresh.

---

## Getting started

> **Lecturer?** See the [Quickstart guide](QUICKSTART.md) for a step-by-step walkthrough with screenshots.


### Prerequisites

- Node.js 18 or later
- A public GitHub repository containing your question YAML files (see [albrechtje/quiqui-questions](https://github.com/albrechtje/quiqui-questions))

### Installation

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

> **Limits:** QuiQui checks the repository size via the GitHub API before cloning and rejects repos larger than **1 MB**. Individual question files larger than **100 KB** are also rejected when loaded. In practice a full lecture file is well under 50 KB.

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
    ├── student.html        # Student view
    ├── style.css           # Shared styles
    ├── teacher.js          # Teacher frontend logic
    └── student.js          # Student frontend logic
```

**Why `start.sh`?** Node.js inherits the shell environment, which can include variables like `PAGER` or credential helpers that cause git to hang or throw security errors when cloning. `start.sh` sets `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS=true`, and `GIT_PAGER=cat` to give git a clean, non-interactive environment. `npm start` and `npm run dev` call it automatically.

**Why is `teacher.html` outside `public/`?**  
Everything in `public/` is served statically and is publicly accessible by filename. Moving `teacher.html` to the project root means it can only be reached through the slug route — visiting `/teacher.html` directly returns 404.

---

## Socket.io events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `join-session` | client → server | `{ sessionId }` | Student joins a session room |
| `session-state` | server → client | `{ exists, question, votes, open, total, title }` | Current state sent on join |
| `session-created` | server → clients | — | Emitted when a teacher pulls a repo; updates waiting students |
| `activate-question` | client → server | `{ question, sessionId, token, title }` | Teacher activates a question |
| `question-activated` | server → clients | `{ question, sessionId, title }` | Broadcast to all students in session |
| `submit-answer` | client → server | `{ sessionId, selected: [0, 2] }` | Student submits answer indices |
| `vote-update` | server → clients | `{ votes, total }` | Broadcast after each new vote |
| `close-voting` | client → server | `{ sessionId, token }` | Teacher closes voting |
| `voting-closed` | server → clients | — | Students return to waiting screen |
| `session-expired` | server → clients | — | Session timed out; teacher UI locked, students see "no session" message |

---

## Security model

QuiQui uses a shared-secret approach suited for lecture deployments:

- **Teacher page** is only reachable at `/:teacherSlug` — the HTML file is not accessible as a static asset
- **Teacher API endpoints** (`/api/pull`, `/api/questions`, `/api/qr`, `/api/session`) require an `X-Teacher-Token` header matching the slug
- **Teacher socket events** (`activate-question`, `close-voting`) require a `token` field matching the slug
- **Student endpoints** (`/join/:sessionId`, socket events) are intentionally open — no login required
- **Only public GitHub repos** are accepted — `file://` and `ssh://` URLs are rejected; repo size is checked via the GitHub API before cloning

This is not a substitute for HTTPS or a proper authentication system. For a shared deployment used by multiple lecturers, add authentication in a future version.

---

## Deployment

QuiQui runs on any platform that supports Node.js. [Render](https://render.com) is recommended — it has a free tier and supports persistent processes (required for Socket.io).

1. Push this repo to GitHub
2. Go to [render.com](https://render.com) → **New → Web Service** → connect your repo
3. Set the build command to `npm install` and the start command to `npm start`
4. Add environment variable `TEACHER_SLUG` in the dashboard (choose something hard to guess)
5. Deploy, then bookmark your teacher URL: `https://your-app.onrender.com/<TEACHER_SLUG>?repo=https://github.com/you/quiqui-questions`

> **Note:** Render's free tier spins down after 15 minutes of inactivity and takes ~30 seconds to wake on the next request. Open your teacher page a minute before class to avoid a cold start.

Cloned question files live in `tmp/sessions/` and are deleted automatically when a session expires — no persistent storage needed.

---

## Contributing

Contributions are welcome. For significant changes, please open an issue first to discuss what you'd like to change.

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-change`)
3. Commit your changes
4. Open a pull request

---

## License

[AGPL-3.0](LICENSE)
