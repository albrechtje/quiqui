const socket = io();

// ─── State ────────────────────────────────────────────────────────────────────
let questions = [];
let selectedQuestion = null;
let currentSessionId = null;
let joined = 0;

// Slug is the path segment this page was loaded from — used as the teacher token
const TEACHER_TOKEN = window.location.pathname.replace(/^\//, '').split('/')[0];

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const repoInput       = document.getElementById('repo-url');
const btnPull         = document.getElementById('btn-pull');
const fileSelect      = document.getElementById('file-select');
const pullStatus      = document.getElementById('pull-status');
const sectionQuestions = document.getElementById('section-questions');
const questionList    = document.getElementById('question-list');
const sectionActive   = document.getElementById('section-active');
const activeQText     = document.getElementById('active-q-text');
const badgeLive       = document.getElementById('badge-live');
const joinInfo        = document.getElementById('join-info');
const qrImg           = document.getElementById('qr-img');
const joinUrlEl       = document.getElementById('join-url');
const liveStats       = document.getElementById('live-stats');
const statAnswered    = document.getElementById('stat-answered');
const statJoined      = document.getElementById('stat-joined');
const barChart        = document.getElementById('bar-chart');
const btnActivate     = document.getElementById('btn-activate');
const btnClose        = document.getElementById('btn-close');
const correctAnswer   = document.getElementById('correct-answer');

// ─── Init ─────────────────────────────────────────────────────────────────────
(function init() {
  const params = new URLSearchParams(window.location.search);
  const repo = params.get('repo');
  if (repo) repoInput.value = repo;

  btnPull.addEventListener('click', pullRepo);
  fileSelect.addEventListener('change', loadFile);
})();

// ─── Repo pull ────────────────────────────────────────────────────────────────
async function pullRepo() {
  const repo = repoInput.value.trim();
  if (!repo) { pullStatus.textContent = 'Enter a repo URL first.'; return; }

  btnPull.disabled = true;
  pullStatus.textContent = 'Cloning…';

  try {
    const res = await fetch('/api/pull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Teacher-Token': TEACHER_TOKEN },
      body: JSON.stringify({ repo }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    // Populate file dropdown
    fileSelect.innerHTML = '<option value="">— select a lecture file —</option>';
    data.files.forEach(f => {
      const opt = document.createElement('option');
      opt.value = f;
      opt.textContent = f;
      fileSelect.appendChild(opt);
    });

    // If config provides a session slug, store it
    if (data.config && data.config.session_id) {
      currentSessionId = data.config.session_id;
    }

    pullStatus.textContent = `Pulled ${data.files.length} file(s).`;
    sectionQuestions.style.display = 'none';
    questionList.innerHTML = '';
  } catch (err) {
    pullStatus.textContent = 'Error: ' + err.message;
  } finally {
    btnPull.disabled = false;
  }
}

// ─── Load questions from selected file ────────────────────────────────────────
async function loadFile() {
  const file = fileSelect.value;
  if (!file) { sectionQuestions.style.display = 'none'; return; }

  try {
    const res = await fetch(`/api/questions?file=${encodeURIComponent(file)}`, {
      headers: { 'X-Teacher-Token': TEACHER_TOKEN },
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error);

    questions = data.questions || [];
    renderQuestionList();
    sectionQuestions.style.display = '';
    sectionActive.style.display = 'none';
    selectedQuestion = null;
  } catch (err) {
    pullStatus.textContent = 'Error loading file: ' + err.message;
  }
}

// ─── Question list ────────────────────────────────────────────────────────────
function renderQuestionList() {
  questionList.innerHTML = '';
  questions.forEach((q, i) => {
    const item = document.createElement('div');
    item.className = 'q-item';
    item.dataset.index = i;
    item.innerHTML = `
      <span class="q-text">${escHtml(q.question)}</span>
      <span class="q-badge">${q.type === 'multiple' ? 'multi' : 'single'}</span>
    `;
    item.addEventListener('click', () => selectQuestion(i));
    questionList.appendChild(item);
  });
}

function selectQuestion(index) {
  selectedQuestion = questions[index];

  document.querySelectorAll('.q-item').forEach((el, i) => {
    el.classList.toggle('active-q', i === index);
  });

  activeQText.textContent = selectedQuestion.question;
  sectionActive.style.display = '';

  // Reset panel to pre-activation state
  badgeLive.style.display = 'none';
  joinInfo.style.display = 'none';
  liveStats.style.display = 'none';
  barChart.innerHTML = '';
  btnActivate.style.display = '';
  btnClose.style.display = 'none';

  if (selectedQuestion.correct) {
    correctAnswer.textContent = 'Correct: ' + selectedQuestion.correct;
    correctAnswer.style.display = '';
  } else {
    correctAnswer.style.display = 'none';
  }
}

// ─── Activate question ────────────────────────────────────────────────────────
function activateQuestion() {
  if (!selectedQuestion) return;

  // Derive session ID from config or generate a short random one
  if (!currentSessionId) {
    currentSessionId = Math.random().toString(36).slice(2, 8);
  }

  socket.emit('activate-question', {
    question: selectedQuestion,
    sessionId: currentSessionId,
    token: TEACHER_TOKEN,
  });

  // Update UI immediately
  badgeLive.style.display = '';
  btnActivate.style.display = 'none';
  btnClose.style.display = '';
  liveStats.style.display = '';
  statAnswered.textContent = '0';
  statJoined.textContent = '0';
  joined = 0;

  // Show join info
  const joinUrl = `${location.origin}/join/${currentSessionId}`;
  joinUrlEl.textContent = joinUrl;
  joinInfo.style.display = '';
  fetchQR(joinUrl);

  // Init bar chart
  renderBarChart(selectedQuestion.answers, {}, 0);
}
window.activateQuestion = activateQuestion;

// ─── Close voting ─────────────────────────────────────────────────────────────
function closeVoting() {
  if (!currentSessionId) return;
  socket.emit('close-voting', { sessionId: currentSessionId, token: TEACHER_TOKEN });
  badgeLive.style.display = 'none';
  btnClose.style.display = 'none';
  btnActivate.style.display = '';
}
window.closeVoting = closeVoting;

// ─── QR code ──────────────────────────────────────────────────────────────────
async function fetchQR(url) {
  try {
    const res = await fetch(`/api/qr?url=${encodeURIComponent(url)}`, {
      headers: { 'X-Teacher-Token': TEACHER_TOKEN },
    });
    const data = await res.json();
    qrImg.src = data.dataUrl;
    qrImg.style.display = '';
  } catch (_) {}
}

// ─── Socket events ────────────────────────────────────────────────────────────
socket.on('vote-update', ({ votes, total }) => {
  if (!selectedQuestion) return;
  statAnswered.textContent = total;
  renderBarChart(selectedQuestion.answers, votes, total);
});

socket.on('voting-closed', () => {
  badgeLive.style.display = 'none';
  btnClose.style.display = 'none';
  btnActivate.style.display = '';
});

// ─── Bar chart ────────────────────────────────────────────────────────────────
function renderBarChart(answers, votes, total) {
  barChart.innerHTML = '';
  answers.forEach((ans, i) => {
    const count = votes[i] || 0;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;

    const row = document.createElement('div');
    row.className = 'bar-row';
    row.innerHTML = `
      <div class="bar-label" title="${escHtml(ans)}">${escHtml(ans)}</div>
      <div class="bar-track">
        <div class="bar-fill" style="width:${pct}%">
          ${pct >= 15 ? `<span class="bar-pct-inside">${pct}%</span>` : ''}
        </div>
      </div>
      <div class="bar-pct-outside">${pct < 15 ? pct + '%' : ''}&nbsp;(${count})</div>
    `;
    barChart.appendChild(row);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function escHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
