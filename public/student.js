marked.use(markedKatex({ throwOnError: false }));

const socket = io();

// ─── State ────────────────────────────────────────────────────────────────────
let currentQuestion = null;
let selected = [];       // indices of selected answer(s)
let submitted = false;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const screenWaiting   = document.getElementById('screen-waiting');
const screenQuestion  = document.getElementById('screen-question');
const screenResult    = document.getElementById('screen-result');
const typeHint        = document.getElementById('type-hint');
const questionText    = document.getElementById('student-q-text');
const answerList      = document.getElementById('student-answer-list');
const btnSubmit       = document.getElementById('btn-submit');
const studentBarChart = document.getElementById('student-bar-chart');
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
socket.on('session-state', ({ exists, question, open, title }) => {
  if (title) applyTitle(title);
  if (question && open) {
    showQuestion(question);
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
  showQuestion(question);
});

// New vote came in
socket.on('vote-update', ({ votes, total }) => {
  if (!currentQuestion) return;
  if (submitted) {
    showResults(votes, total, currentQuestion);
  }
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
    // Already submitted this question — show waiting screen instead
    currentQuestion = question;
    submitted = true;
    showScreen('waiting');
    document.getElementById('waiting-msg').innerHTML = 'Answer already submitted.<span class="dot-anim"></span>';
    return;
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
      <div>${mdInline(ans)}</div>
    `;
    opt.addEventListener('click', () => toggleAnswer(i, opt, question.type));
    answerList.appendChild(opt);
  });

  btnSubmit.disabled = true;
  submitted = false;

  showScreen('question');
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
}
window.submitAnswer = submitAnswer;

// ─── Show results ─────────────────────────────────────────────────────────────
function showResults(votes, total, question) {
  showScreen('result');
  resultMeta.textContent = `${total} answer${total !== 1 ? 's' : ''} submitted`;
  renderBarChart(question.answers, votes, total);
}

function renderBarChart(answers, votes, total) {
  studentBarChart.innerHTML = '';
  answers.forEach((ans, i) => {
    const count = (votes && votes[i]) || 0;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;

    const row = document.createElement('div');
    row.className = 'bar-row';

    // Highlight the student's own selection(s)
    const isOwn = selected.includes(i);
    row.innerHTML = `
      <div class="bar-label" title="${escHtml(ans)}" style="${isOwn ? 'color:var(--color-accent-text);font-weight:500' : ''}">${mdInline(ans)}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%;${isOwn ? 'background:var(--color-accent-dark)' : ''}">
          ${pct >= 15 ? `<span class="bar-pct-inside">${pct}%</span>` : ''}
        </div>
      </div>
      <div class="bar-pct-outside">${pct < 15 ? pct + '%' : ''}&nbsp;(${count})</div>
    `;
    studentBarChart.appendChild(row);
  });
}

// ─── Screen switching ─────────────────────────────────────────────────────────
function showScreen(name) {
  screenWaiting.style.display  = name === 'waiting'  ? '' : 'none';
  screenQuestion.style.display = name === 'question' ? '' : 'none';
  screenResult.style.display   = name === 'result'   ? '' : 'none';
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

function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function mdHtml(s) {
  return marked.parse(s);
}

function mdInline(s) {
  return marked.parseInline(s);
}
