<img src="public/quiqui-logo.png" alt="QuiQui" width="240" />

# Quickstart for Lecturers

> Part of the [QuiQui](https://github.com/albrechtje/quiqui) open source project. Hosted instance: [quiqui-x9um.onrender.com](https://quiqui-x9um.onrender.com) (may take ~30s to wake up on first visit).

QuiQui lets you pose a question to your class and see live answers on screen — no app, no login, no setup for students.

---

## What you need

- Your QuiQui teacher URL (bookmarked once, reused every lecture)
- A public GitHub repository with your question files — see [albrechtje/quiqui-questions](https://github.com/albrechtje/quiqui-questions) for the format

---

## Before the lecture (once)

1. **Set up your question repo** on GitHub with a `config.yaml` and one `.yaml` file per lecture topic
2. **Bookmark your teacher URL:**
   ```
   https://quiqui-x9um.onrender.com/<teacher-slug>?repo=https://github.com/you/quiqui-questions
   ```
   Contact the hosted service operator to receive your teacher slug.
3. **Put the student QR code or URL in your slides** — it never changes as long as `session_url` in `config.yaml` stays the same. Choose a unique name that includes your organisation or course (e.g. `tum-python101`) — generic names like `demo` will conflict if another lecturer uses the same name on the same server
4. **Optionally bookmark the projector URL** (`/view/<session_url>`) to open in your browser during the lecture — it shows the live question and results on your beamer alongside the QR code

---

## During the lecture

<img src="public/teacher-view.png" alt="Teacher View" width="600" />

1. **Open your bookmarked teacher URL** — the repo is pulled automatically and the QR code appears
2. **Project the QR code** so students can join (or share the URL verbally)
3. **Select a lecture file** from the dropdown, then click a question to preview it
4. **Click ▶ Activate** — voting opens; badge shows **● Active**. Click again (**⏹ Deactivate**) to stop voting without revealing answers — students see the result bars but no highlights
5. **Click ✓ Reveal** to show the correct answers highlighted in green for everyone in the room
6. **Click ✕ Close** to send students back to the waiting screen without revealing answers
7. **Click Next question →** to move on — students return to the waiting screen automatically

> **Happy path:** Activate → (students vote) → Reveal → Close → Next question →

> **Tip:** Open the teacher page a minute before class — the app may take ~30 seconds to wake up on the free Render plan.

---

## What students see

<img src="public/student-view.png" alt="Student View" width="500" />

Students visit the join URL or scan the QR code — no login, no app install. They see "Waiting for the next question" until you activate a question. After submitting their answer (only once per question), the result bars appear live under each answer option.

- **Deactivate** — students see the bars without correct answer highlights
- **Reveal** — correct answers highlighted in green for everyone
- **Close** — students return to the waiting screen

If a student hasn't voted when you deactivate or reveal, they see "Voting has ended." and the bars — but cannot submit. If a student refreshes after submitting, they see the question with bars but cannot submit again.

---

## Projector view (beamer)

<img src="public/projector-view.png" alt="Projector View" width="700" />

Open `/view/<session_url>` in your browser and project it on the beamer. It shows the same question and live result bars as the student view, plus the QR code and join URL — so students can scan at any time. No submit button, no interaction needed.

The projector URL is shown in the teacher view next to the student join URL as soon as a repo is pulled. If your organisation doesn't allow browser add-ins in PowerPoint, this is the recommended way to display live results during a presentation.

---

## Adding or editing questions

Edit the `.yaml` files in your GitHub repo and click **Pull latest** in the teacher view to reload. No server restart needed.

Questions support plain text, **Markdown** (inline code, code blocks), and **LaTeX** math (`$...$` inline, `$$...$$` display). See the [question repo README](https://github.com/albrechtje/quiqui-questions) for the full format reference.

### Two ways to use QuiQui

**With correct answers in the YAML** — include a `correct` field. The **✓ Reveal** button highlights the right option(s) in green for everyone in the room.

**Generic / slide-based** — omit `correct` and keep your question text in your slides. QuiQui collects votes and shows the live bar chart; the Reveal button is hidden automatically. Each answer option is labelled with a letter badge (A, B, C, …), so students just call out or click the letter they see on the slide. The [question repo](https://github.com/albrechtje/quiqui-questions) includes a ready-made `lecture7-generic.yaml` with templates for A/B/C/D, Yes/No, True/False, and a 5-point agreement scale — load it once and reuse it throughout your lecture.

---

## Session lifetime

A session expires after **90 minutes of inactivity**. After expiry, click **Pull latest** to start a fresh session — the student URL stays the same.
