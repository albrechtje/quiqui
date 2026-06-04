# QuiQui — Project Brief

## Background and purpose

QuiQui is a live audience response tool designed specifically for university lectures. The core idea is simple: a lecturer poses one activating question during a lecture, students answer on their own devices, and the class immediately sees a bar chart of how everyone responded — no correct answer revealed, just the distribution. This creates a moment for discussion and reflection rather than a test.

The mental model is close to Slido or Mentimeter, but with a much narrower scope. QuiQui is not a quiz platform, a grading tool, or a course management system. It is designed for a single, well-defined use case: one or two activating questions per lecture, used to spark discussion, surface misconceptions, or gauge understanding in real time.

## Design decisions and their rationale

### One or two questions per lecture, not a full quiz

The tool is optimised for the "activating question" pattern in lecturing — a brief moment where students engage with a concept before the lecturer continues. A full quiz workflow (many questions, scoring, results summary) is deliberately out of scope for v1. This keeps the interface minimal and the cognitive overhead low for both lecturer and students.

### No correct answer revealed

After submitting, students see only the distribution of answers across the class, not which answer is correct. This is intentional: the point is to generate discussion, not to provide immediate feedback. Revealing the correct answer would short-circuit the discussion the lecturer wants to have. The lecturer decides what to do with the results — explain, debate, move on.

### Teacher-paced, not student-paced

The lecturer controls which question is currently active. Students cannot browse ahead or work at their own pace. This keeps the class in sync and ensures the bar chart moment lands at the right point in the lecture, not whenever individual students happen to finish.

### No student login

Students join by scanning a QR code or visiting a URL — nothing else required. Any friction at the student side (accounts, codes, app installs) reduces participation. Anonymous responses also make students more willing to answer honestly, which is the point of activating questions.

### Questions stored in a GitHub repo, not in the tool

Each lecturer maintains their own public GitHub repository of YAML question files, one file per lecture. QuiQui pulls from this repo at session start. This decision keeps the server stateless (no database, no file storage), gives lecturers version control over their questions for free, and makes it trivial to share the tool with colleagues — each colleague simply points QuiQui at their own repo via a URL parameter. There is no admin interface for managing question files; that is handled entirely in the lecturer's normal editor and git workflow.

### Repo URL as a URL parameter, not server configuration

The GitHub repo URL is not stored on the server. It is passed as a `?repo=` query parameter in the teacher URL and bookmarked once. This means the server holds no per-user configuration, multiple lecturers can share one deployment without any account system, and adding a colleague is as simple as sending them the tool URL and telling them to append their own repo. The trade-off is a slightly longer bookmarked URL, which is acceptable.

### No authentication on the teacher page

The teacher page is protected only by an obscure URL slug (e.g. `/teach-xk92p`), not a password. For a single-user deployment this is sufficient — the slug is effectively a shared secret. A proper login system is a v2 concern, deferred until there is a real need for multi-user support.

### In-memory session state, no persistence

All session data (active question, votes, connected students) lives in server memory and is discarded when the session ends or the server restarts. There is no database. This is intentional: QuiQui is a live, ephemeral tool. Lecturers do not need a record of how students voted; the value is in the live moment, not in historical analytics. Persistence would add infrastructure complexity with no benefit for the v1 use case.

### Vanilla JS frontend, no build step

The frontend uses plain HTML, CSS, and JavaScript with no framework and no build toolchain. This keeps the project easy to understand, deploy, and modify without Node.js frontend tooling knowledge. Socket.io is the only client-side dependency, loaded from a script tag.

---

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express
- **Real-time**: Socket.io
- **YAML parsing**: js-yaml
- **Git integration**: simple-git
- **QR code**: qrcode (npm)
- **Frontend**: Vanilla HTML/CSS/JS — no build step, no framework

---

## Project Structure

```
quiqui/
├── server.js               # Express + Socket.io server
├── package.json
├── .env.example            # Documents env vars (no secrets)
├── public/
│   ├── teacher.html        # Teacher view (protected by obscure slug)
│   ├── student.html        # Student view
│   └── style.css           # Shared styles
└── tmp/
    └── questions/          # Temp clone of the git repo (gitignored)
```

---

## Environment Variables

```
TEACHER_SLUG=teach-xk92p    # Obscure path segment for teacher page
PORT=3000
```

The GitHub repo URL is NOT stored server-side. It is passed as a URL parameter by the teacher and held only in memory during the session.

---

## URL Structure

| URL | Description |
|---|---|
| `/join/:sessionId` | Student view — join active session |
| `/:teacherSlug` | Teacher view (obscure URL, no password) |
| `/:teacherSlug?repo=https://github.com/user/repo` | Teacher view with repo pre-loaded |

---

## YAML Question Format

Files live in a public GitHub repo, one `.yaml` file per lecture:

```yaml
- question: "Which loop runs at least once regardless of the condition?"
  type: single
  answers:
    - "for loop"
    - "while loop"
    - "do-while loop"
    - "recursion"

- question: "Select all valid ways to exit a loop in Python."
  type: multiple
  answers:
    - "break"
    - "continue"
    - "return"
    - "exit()"
```

- `type: single` — student may select exactly one answer
- `type: multiple` — student may select one or more answers
- No `correct` field — QuiQui never reveals correct answers

---

## Teacher Flow

1. Teacher opens bookmarked URL: `/:teacherSlug?repo=https://github.com/user/repo`
2. Server clones/pulls the repo into `tmp/questions/`
3. Teacher page lists all `.yaml` files found in the repo
4. Teacher selects a file — questions load in a list
5. Teacher clicks a question to select it, then clicks **Activate**
6. A session is created with a random `sessionId`; a QR code and join URL are displayed
7. Students join at `/join/:sessionId`
8. As students answer, the bar chart updates live on both teacher and student screens
9. Teacher clicks **Close voting** — no more answers accepted
10. Teacher can activate the next question (new session, same join URL pattern)

---

## Student Flow

1. Student scans QR code or visits the join URL
2. If no question is active: waiting screen with animated indicator
3. When teacher activates a question: question appears automatically (via Socket.io push)
4. Student selects answer(s) and submits — can only submit once
5. After submitting: live bar chart showing answer distribution (percentages per option)
6. Chart updates in real time as more students submit
7. When teacher closes voting: chart freezes, "voting closed" indicator appears

---

## Server-Side Session State (in memory only)

```js
{
  sessionId: "abc123",
  repo: "https://github.com/user/repo",
  activeQuestion: {
    question: "...",
    type: "single" | "multiple",
    answers: ["...", "..."]
  },
  votes: {
    0: 5,   // answer index -> count
    1: 3,
    2: 8,
    3: 1
  },
  voters: Set(["socketId1", "socketId2"]),  // prevent double voting
  open: true
}
```

No database. All state is lost when the server restarts — that's intentional.

---

## Socket.io Events

| Event | Direction | Payload | Description |
|---|---|---|---|
| `join-session` | client→server | `{ sessionId }` | Student joins |
| `session-state` | server→client | `{ question, votes, open }` | Current state on join |
| `question-activated` | server→client | `{ question, sessionId }` | Teacher activated a question |
| `submit-answer` | client→server | `{ sessionId, selected: [0,2] }` | Student submits |
| `vote-update` | server→broadcast | `{ votes, total }` | New vote received |
| `voting-closed` | server→broadcast | — | Teacher closed voting |

---

## Teacher Page UI

- **Repo URL input** — pre-filled from `?repo=` param, with a "Pull latest" button
- **File list** — dropdown or list of `.yaml` files found in the repo
- **Question list** — all questions from the selected file, click to select
- **Active question panel** — shows selected question, Activate / Close voting buttons
- **Live bar chart** — updates in real time, shows count and percentage per answer option
- **Join info** — QR code + URL for students, shown when a question is active

---

## Student Page UI

- **Waiting screen** — QR code + URL + animated "waiting for lecturer" message
- **Question screen** — question text, answer options (A/B/C/D), submit button
  - Single choice: radio-style (selecting one deselects others)
  - Multiple choice: checkbox-style, hint text "select all that apply"
- **Result screen** — horizontal bar chart, percentage per option, live updates, total answered count

---

## QR Code

Generate server-side using the `qrcode` npm package. The QR encodes the full student join URL. Render as a data URL and embed in the teacher page as an `<img>` tag.

---

## Deployment Notes

- Target platform: **Render** or **Railway** (free tier is fine for lecture use)
- Set environment variables in the platform dashboard
- The `tmp/questions/` directory is ephemeral — recreated on each session start
- No database required

---

## What to Build First (v1 Scope)

1. Basic Express server with Socket.io
2. Teacher page: repo pull, file selection, question list, activate/close
3. Student page: waiting → question → live chart
4. In-memory session state
5. QR code generation
6. Deploy to Render

**Out of scope for v1:**
- Multiple concurrent sessions
- Authentication / user accounts
- Persistent results / history
- Multiple teacher support
- Correct answer reveal
