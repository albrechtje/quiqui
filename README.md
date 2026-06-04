# QuiQui

A lightweight live audience response tool for university lectures. The lecturer poses an activating question, students answer on their own devices, and the class sees a live bar chart of the distribution — no correct answer revealed, just a moment for discussion.

> Inspired by Slido and Mentimeter, but deliberately minimal: one or two questions per lecture, no accounts, no app installs, no scoring.

---

## Features

- **Teacher-paced** — the lecturer controls which question is active; students cannot browse ahead
- **No student login** — students join by scanning a QR code or visiting a URL
- **Live results** — bar chart updates in real time as students submit
- **Single and multiple choice** — per-question type configured in YAML
- **Questions in Git** — question files live in a public GitHub repo; no admin interface needed
- **No database** — all session state is in memory and intentionally ephemeral
- **No build step** — vanilla HTML/CSS/JS frontend, deploy anywhere Node.js runs

---

## How it works

### Teacher flow

1. Open your bookmarked teacher URL: `https://your-deployment.com/teach-xk92p?repo=https://github.com/you/quiqui-questions`
2. Click **Pull latest** to clone your question repo
3. Select a lecture file from the dropdown
4. Click a question to select it, then click **Activate question**
5. A QR code and join URL appear — project these for students to scan
6. Watch the bar chart update live as answers come in
7. Click **Close voting** when done — the chart freezes on all screens
8. Select the next question and repeat

### Student flow

1. Scan the QR code or visit the join URL (e.g. `https://your-deployment.com/join/python101`)
2. Wait for the lecturer to activate a question
3. Select your answer(s) and submit — you can only submit once
4. See the live distribution of answers across the class
5. When the lecturer closes voting, the chart freezes

---

## Getting started

### Prerequisites

- Node.js 18 or later
- A public GitHub repository containing your question YAML files (see [question format](#question-format))

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
- Student page: `http://localhost:3000/join/<sessionId>` (shown as QR after activating a question)

---

## Question format

Questions live in a public GitHub repository, one `.yaml` file per lecture. See [albrechtje/quiqui-questions](https://github.com/albrechtje/quiqui-questions) for a working example.

### Single choice

```yaml
- question: "What is the result of 7 // 2 in Python?"
  type: single
  answers:
    - "3.5"
    - "3"
    - "4"
    - "2"
  correct: "B — // is floor division. 7 / 2 = 3.5, floored to 3."
```

### Multiple choice

```yaml
- question: "Which of these are valid Python data types?"
  type: multiple
  answers:
    - "int"
    - "float"
    - "char"
    - "str"
    - "bool"
  correct: "A, B, D, E — Python has no char type."
```

- `type: single` — student may select exactly one answer
- `type: multiple` — student may select one or more answers
- `correct` — optional free-text field shown only on the teacher screen, never to students

### config.yaml

An optional `config.yaml` at the root of your question repo:

```yaml
session_url: python101
title: Python 101
```

- `session_url` — sets a stable join URL for the session (e.g. `/join/python101`). Students can bookmark or stay on this URL across multiple questions in a lecture. If omitted, QuiQui generates a random short ID each time a question is activated.
- `title` — optional display name shown in the header and browser tab of both teacher and student views, formatted as `QuiQui: <title>`.

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
| `session-state` | server → client | `{ question, votes, open, total }` | Current state sent on join |
| `activate-question` | client → server | `{ question, sessionId, token }` | Teacher activates a question |
| `question-activated` | server → clients | `{ question, sessionId }` | Broadcast to all students in session |
| `submit-answer` | client → server | `{ sessionId, selected: [0, 2] }` | Student submits answer indices |
| `vote-update` | server → clients | `{ votes, total }` | Broadcast after each new vote |
| `close-voting` | client → server | `{ sessionId, token }` | Teacher closes voting |
| `voting-closed` | server → clients | — | Broadcast to freeze student charts |

---

## Security model

QuiQui uses a shared-secret approach suited for single-user deployments:

- **Teacher page** is only reachable at `/:teacherSlug` — the HTML file is not accessible as a static asset
- **Teacher API endpoints** (`/api/pull`, `/api/questions`, `/api/qr`, `/api/session`) require an `X-Teacher-Token` header matching the slug
- **Teacher socket events** (`activate-question`, `close-voting`) require a `token` field matching the slug
- **Student endpoints** (`/join/:sessionId`, socket events) are intentionally open — no login required

This is not a substitute for HTTPS or a proper authentication system. For a shared deployment used by multiple lecturers, add authentication in a future version.

---

## Deployment

QuiQui runs on any platform that supports Node.js. [Render](https://render.com) and [Railway](https://railway.app) both have free tiers that work well for lecture use.

1. Push this repo to GitHub
2. Create a new Web Service pointing at your repo
3. Set the build command to `npm install` and the start command to `npm start`
4. Add your environment variables (`TEACHER_SLUG`, `PORT`) in the platform dashboard
5. Bookmark your teacher URL: `https://your-app.onrender.com/<TEACHER_SLUG>?repo=https://github.com/you/quiqui-questions`

The `tmp/questions/` directory is recreated on each pull — no persistent storage needed.

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
