marked.use(markedKatex({ throwOnError: false }));

const socket = io();

// ─── State ────────────────────────────────────────────────────────────────────
let currentQuestion = null;
let selected = [];       // indices of selected answer(s)
let submitted = false;
let currentSessionToken = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const screenWaiting   = document.getElementById('screen-waiting');
const screenQuestion  = document.getElementById('screen-question');
const typeHint        = document.getElementById('type-hint');
const questionText    = document.getElementById('student-q-text');
const answerList      = document.getElementById('student-answer-list');
const btnSubmit       = document.getElementById('btn-submit');
const resultMeta      = document.getElementById('student-result-meta');
// ─── Init ─────────────────────────────────────────────────────────────────────
(function init() {
  const sessionId = getSessionId();
  if (!sessionId) return;

  btnSubmit.addEventListener('click', submitAnswer);
})();

// Join (and re-join) the session room on every (re)connect. A reconnect gives us
// a new socket id that is not in the room, so joining only once at page load would
// silently stop all broadcasts (question-activated, vote-update, …) after an idle
// drop — the student screen would freeze and never advance.
socket.on('connect', () => {
  const sessionId = getSessionId();
  if (sessionId) socket.emit('join-session', { sessionId });
});

function getSessionId() {
  const parts = window.location.pathname.split('/');
  return parts[parts.length - 1] || null;
}

// ─── Socket events ────────────────────────────────────────────────────────────

// Initial state when joining
socket.on('session-state', ({ exists, question, open, title, answersRevealed, deactivated, correctIndices, sessionToken }) => {
  if (sessionToken) currentSessionToken = sessionToken;
  if (title) applyTitle(title);
  if (question && (open || deactivated || answersRevealed)) {
    showQuestion(question);
    if (deactivated || (answersRevealed && !open)) {
      submitted = true;
      btnSubmit.disabled = true;
      showInlineBars();
    }
    if (deactivated) {
      resultMeta.style.display = '';
      resultMeta.textContent = 'Voting has ended.';
    }
    if (answersRevealed) highlightCorrect(correctIndices);
  } else {
    document.getElementById('waiting-msg').innerHTML = exists
      ? 'Waiting for the next question'
      : 'No quiz session active at this URL.';
  }
});

// Teacher pushes a new question
socket.on('question-activated', ({ question, votes, total, title, sessionToken }) => {
  if (sessionToken) currentSessionToken = sessionToken;
  if (title) applyTitle(title);
  const sameQuestion = currentQuestion && currentQuestion.question === question.question;
  if (!sameQuestion) {
    submitted = false;
    selected = [];
    sessionStorage.removeItem(answerKey(question.question));
  }
  showQuestion(question);
  if (sameQuestion && submitted && votes) {
    showInlineBars();
    updateInlineBars(votes, total);
  }
});

// New vote came in
socket.on('vote-update', ({ votes, total }) => {
  if (!currentQuestion || !submitted) return;
  updateInlineBars(votes, total);
  resultMeta.textContent = `${total} answer${total !== 1 ? 's' : ''} submitted`;
});

// Teacher deactivated — show bars without highlights, disable submit
socket.on('question-deactivated', ({ votes, total }) => {
  if (!currentQuestion) return;
  submitted = true;
  btnSubmit.disabled = true;
  showInlineBars();
  updateInlineBars(votes, total);
  resultMeta.style.display = '';
  resultMeta.textContent = 'Voting has ended.';
});

// Teacher revealed correct answers — highlight them, disable submit, show bars
socket.on('answer-revealed', ({ correctIndices, votes, total }) => {
  if (!currentQuestion) return;
  const hadSubmitted = submitted;
  submitted = true;
  btnSubmit.disabled = true;
  showInlineBars();
  updateInlineBars(votes, total);
  resultMeta.style.display = '';
  resultMeta.textContent = hadSubmitted
    ? `${total} answer${total !== 1 ? 's' : ''} submitted`
    : 'Voting has ended.';
  highlightCorrect(correctIndices);
});

// Teacher closed — return to waiting screen
socket.on('question-closed', () => {
  currentQuestion = null;
  submitted = false;
  selected = [];
  showScreen('waiting');
});

// Session expired — show "no session" message without requiring a refresh
socket.on('session-expired', () => {
  currentQuestion = null;
  submitted = false;
  selected = [];
  document.getElementById('waiting-msg').innerHTML = 'No quiz session active at this URL.';
  showScreen('waiting');
});

// Teacher pulled a new repo — update message for students already on the waiting screen
socket.on('session-created', ({ title, sessionToken }) => {
  if (sessionToken) currentSessionToken = sessionToken;
  if (title) applyTitle(title);
  if (!currentQuestion) {
    document.getElementById('waiting-msg').innerHTML = 'Waiting for the next question';
  }
});

// ─── Show question ────────────────────────────────────────────────────────────
function showQuestion(question) {
  const sessionId = getSessionId();
  if (hasAnswered(question.question)) {
    // Already submitted — render question with bars visible but locked
    currentQuestion = question;
    submitted = true;
  }

  currentQuestion = question;
  selected = [];

  typeHint.textContent = question.type === 'multiple' ? 'Select all that apply' : 'Select one answer';
  questionText.innerHTML = mdHtml(question.question);

  answerList.innerHTML = '';
  const keys = ['A', 'B', 'C', 'D', 'E', 'F'];
  question.answers.forEach((ans, i) => {
    const opt = document.createElement('div');
    opt.className = 'answer-opt';
    opt.dataset.index = i;
    opt.innerHTML = `
      <div class="opt-key">${keys[i] || i + 1}</div>
      <div style="flex:1">
        <div>${mdInline(ans)}</div>
        <div class="opt-bar-wrap" id="opt-bar-wrap-${i}">
          <div class="opt-bar-fill" id="opt-bar-fill-${i}" style="width:0%"></div>
        </div>
        <div class="opt-bar-pct" id="opt-bar-pct-${i}"></div>
      </div>
    `;
    opt.addEventListener('click', () => toggleAnswer(i, opt, question.type));
    answerList.appendChild(opt);
  });

  btnSubmit.disabled = submitted; // keep disabled if already answered
  resultMeta.style.display = submitted ? '' : 'none';
  if (submitted) resultMeta.textContent = 'Answer already submitted.';

  showScreen('question');
  if (submitted) showInlineBars();
}

function toggleAnswer(index, el, type) {
  if (submitted) return;

  if (type === 'single') {
    // Deselect all others
    document.querySelectorAll('.answer-opt').forEach(o => o.classList.remove('selected'));
    selected = [index];
  } else {
    // Toggle this one
    if (selected.includes(index)) {
      selected = selected.filter(i => i !== index);
      el.classList.remove('selected');
    } else {
      selected.push(index);
    }
  }

  el.classList.toggle('selected', selected.includes(index));
  btnSubmit.disabled = selected.length === 0;
}

// ─── Submit answer ────────────────────────────────────────────────────────────
function submitAnswer() {
  if (submitted || selected.length === 0 || !currentQuestion) return;
  submitted = true;
  btnSubmit.disabled = true;

  const sessionId = getSessionId();
  markAnswered(currentQuestion.question);
  socket.emit('submit-answer', { sessionId, selected });

  // Reveal bars immediately — they start at 0% and animate in on first vote-update
  showInlineBars();
  resultMeta.style.display = '';
  resultMeta.textContent = 'Waiting for results…';
}
window.submitAnswer = submitAnswer;

// ─── Correct answer highlight ─────────────────────────────────────────────────
function highlightCorrect(correctIndices) {
  if (!correctIndices || !correctIndices.length) return;
  document.querySelectorAll('.answer-opt').forEach(el => {
    const idx = parseInt(el.dataset.index, 10);
    if (correctIndices.includes(idx)) el.classList.add('answer-correct');
  });
}

// ─── Inline bar chart ─────────────────────────────────────────────────────────
function showInlineBars() {
  if (!currentQuestion) return;
  currentQuestion.answers.forEach((_, i) => {
    document.getElementById(`opt-bar-wrap-${i}`)?.classList.add('visible');
    document.getElementById(`opt-bar-pct-${i}`)?.classList.add('visible');
  });
}

function updateInlineBars(votes, total) {
  if (!currentQuestion) return;
  currentQuestion.answers.forEach((_, i) => {
    const count = (votes && votes[i]) || 0;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    const fill = document.getElementById(`opt-bar-fill-${i}`);
    const pctEl = document.getElementById(`opt-bar-pct-${i}`);
    if (fill) fill.style.width = pct + '%';
    if (pctEl) pctEl.textContent = `${pct}% (${count})`;
  });
}

// ─── Screen switching ─────────────────────────────────────────────────────────
function showScreen(name) {
  screenWaiting.style.display  = name === 'waiting'  ? '' : 'none';
  screenQuestion.style.display = name === 'question' ? '' : 'none';
}

// ─── Session storage — prevent re-submission on refresh ───────────────────────

function answerKey(question) {
  const token = currentSessionToken || getSessionId();
  return `answered:${token}:${question.slice(0, 40)}`;
}

function markAnswered(question) {
  sessionStorage.setItem(answerKey(question), '1');
}

function hasAnswered(question) {
  return sessionStorage.getItem(answerKey(question)) === '1';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function applyTitle(title) {
  document.title = `QuiQui: ${title}`;
  document.getElementById('logo-title').textContent = title;
}

// Question/answer content comes from a public GitHub repo, so it is untrusted.
// Render Markdown/LaTeX, then sanitise to strip any embedded HTML/JS (XSS).
// DOMPurify's default profile permits HTML + SVG + MathML, which preserves
// KaTeX's rendered math output.
function mdHtml(s) {
  return DOMPurify.sanitize(marked.parse(s));
}

function mdInline(s) {
  return DOMPurify.sanitize(marked.parseInline(s));
}
