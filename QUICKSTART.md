# QuiQui — Quickstart for Lecturers

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
3. **Put the student QR code or URL in your slides** — it never changes as long as `session_url` in `config.yaml` stays the same

---

## During the lecture

![Teacher View](public/teacher-view.png)

1. **Open your bookmarked teacher URL** — the repo is pulled automatically and the QR code appears
2. **Project the QR code** so students can join (or share the URL verbally)
3. **Select a lecture file** from the dropdown, then click a question to preview it
4. **Click Activate** — voting opens and the bar chart updates live under each answer
5. **Click Show answer** at any time to reveal the correct answers — voting closes implicitly and the correct options are highlighted in green for everyone in the room
6. **Click Close voting** to end voting without revealing answers — students return to the waiting screen
7. **Click Next question →** to move on, or pick any question from the list

> **Tip:** Open the teacher page a minute before class — the app may take ~30 seconds to wake up on the free Render plan.

---

## What students see

![Student View](public/student-view.png)

Students visit the join URL or scan the QR code — no login, no app install. They see "Waiting for the lecturer" until you activate a question. After submitting their answer (only once per question), the result bars appear live under each answer option. When you close voting they return to the waiting screen automatically.

If a student hasn't voted when you click **Show answer** or **Close voting**, they see "Voting has ended." and the bars — but cannot submit.

If a student refreshes the page after submitting, they see the question with bars but cannot submit again.

---

## Adding or editing questions

Edit the `.yaml` files in your GitHub repo and click **Pull latest** in the teacher view to reload. No server restart needed.

Questions support plain text, **Markdown** (inline code, code blocks), and **LaTeX** math (`$...$` inline, `$$...$$` display). See the [question repo README](https://github.com/albrechtje/quiqui-questions) for the full format reference.

---

## Session lifetime

A session expires after **90 minutes of inactivity**. After expiry, click **Pull latest** to start a fresh session — the student URL stays the same.
