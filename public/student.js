marked.use(markedKatex({ throwOnError: false }));

const socket = io();

// ─── State ────────────────────────────────────────────────────────────────────
let currentQuestion = null;
let selected = [];       // indices of selected answer(s)
let submitted = false;

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

  socket.emit('join-session', { sessionId });

  btnSubmit.addEventListener('click', submitAnswer);
})();

function getSessionId() {
  const parts = window.location.pathname.split('/');
  return parts[parts.length - 1] || null;
}

// ─── Socket events ────────────────────────────────────────────────────────────

// Initial state when joining
socket.on('session-state', ({ exists, question, open, title, answersRevealed, correctIndices }) => {
  if (title) applyTitle(title);
  if (question && (open || answersRevealed)) {
    showQuestion(question);
    if (answersRevealed) highlightCorrect(correctIndices);
  } else {
    document.getElementById('waiting-msg').innerHTML = exists
      ? 'Waiting for the lecturer<span class="dot-anim"></span>'
      : 'No quiz session active at this URL.';
  }
});

// Teacher pushes a new question
socket.on('question-activated', ({ question, title }) => {
  if (title) applyTitle(title);
  submitted = false;
  selected = [];
  sessionStorage.removeItem(answerKey(getSessionId(), question.question));
  showQuestion(question);
});

// New vote came in
socket.on('vote-update', ({ votes, total }) => {
  if (!currentQuestion || !submitted) return;
  updateInlineBars(votes, total);
  resultMeta.textContent = `${total} answer${total !== 1 ? 's' : ''} submitted`;
});

// Teacher revealed correct answers — highlight them, disable submit, show bars
socket.on('answer-revealed', ({ correctIndices, votes, total }) => {
  if (!currentQuestion) return;
  submitted = true;
  btnSubmit.disabled = true;
  showInlineBars();
  updateInlineBars(votes, total);
  resultMeta.style.display = '';
  resultMeta.textContent = `${total} answer${total !== 1 ? 's' : ''} submitted`;
  highlightCorrect(correctIndices);
});

// Voting closed by teacher — return to waiting screen
socket.on('voting-closed', () => {
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
socket.on('session-created', ({ title }) => {
  if (title) applyTitle(title);
  if (!currentQuestion) {
    document.getElementById('waiting-msg').innerHTML = 'Waiting for the lecturer<span class="dot-anim"></span>';
  }
});

// ─── Show question ────────────────────────────────────────────────────────────
function showQuestion(question) {
  const sessionId = getSessionId();
  if (hasAnswered(sessionId, question.question)) {
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
  markAnswered(sessionId, currentQuestion.question);
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

function answerKey(sessionId, question) {
  // Short key from sessionId + first 40 chars of question text
  return `answered:${sessionId}:${question.slice(0, 40)}`;
}

function markAnswered(sessionId, question) {
  sessionStorage.setItem(answerKey(sessionId, question), '1');
}

function hasAnswered(sessionId, question) {
  return sessionStorage.getItem(answerKey(sessionId, question)) === '1';
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function applyTitle(title) {
  document.title = `QuiQui: ${title}`;
  document.getElementById('logo-title').textContent = title;
}

function mdHtml(s) {
  return marked.parse(s);
}

function mdInline(s) {
  return marked.parseInline(s);
}
