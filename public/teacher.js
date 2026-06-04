marked.use(markedKatex({ throwOnError: false }));

const socket = io();

// ─── State ────────────────────────────────────────────────────────────────────
let questions = [];
let selectedQuestion = null;
let selectedIndex = -1;
let currentSessionId = null;
let currentTitle = null;
let sessionExpired = false;
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
const btnNext         = document.getElementById('btn-next');
const correctAnswer   = document.getElementById('correct-answer');
const statusBadge     = document.getElementById('status-badge');

// ─── Init ─────────────────────────────────────────────────────────────────────
(function init() {
  const params = new URLSearchParams(window.location.search);
  const repo = params.get('repo');
  if (repo) repoInput.value = repo;

  btnPull.addEventListener('click', pullRepo);
  repoInput.addEventListener('keydown', e => { if (e.key === 'Enter') pullRepo(); });
  fileSelect.addEventListener('change', loadFile);

  if (repo) pullRepo();
})();

function setStatus(msg, isError = false) {
  pullStatus.textContent = msg;
  pullStatus.classList.toggle('meta-line--error', isError);
}

// ─── Repo pull ────────────────────────────────────────────────────────────────
async function pullRepo() {
  const repo = repoInput.value.trim();
  if (!repo) { setStatus('Enter a repo URL first.', true); return; }

  btnPull.disabled = true;
  setStatus('Cloning…');

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

    // sessionId is always returned by the server (from config.session_url or random fallback)
    currentSessionId = data.sessionId;
    sessionExpired = false;
    const joinUrl = `${location.origin}/join/${currentSessionId}`;
    joinUrlEl.textContent = joinUrl;
    joinInfo.style.display = '';
    fetchQR(joinUrl);

    if (data.config && data.config.title) {
      currentTitle = data.config.title;
      const t = `QuiQui: ${currentTitle}`;
      document.title = t;
      document.getElementById('logo').textContent = t;
    }


    const url = new URL(window.location);
    url.searchParams.set('repo', repo);
    history.replaceState(null, '', url);

    setStatus(`Pulled ${data.files.length} file(s).`);
    sectionQuestions.style.display = 'none';
    questionList.innerHTML = '';
  } catch (err) {
    setStatus('Error: ' + err.message, true);
  } finally {
    btnPull.disabled = false;
  }
}

// ─── Load questions from selected file ────────────────────────────────────────
async function loadFile() {
  const file = fileSelect.value;
  if (!file) { sectionQuestions.style.display = 'none'; return; }

  try {
    const res = await fetch(`/api/questions?file=${encodeURIComponent(file)}&sessionId=${encodeURIComponent(currentSessionId)}`, {
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
    setStatus('Error loading file: ' + err.message, true);
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
      <span class="q-text">${mdInline(q.question)}</span>
      <span class="q-badge">${q.type === 'multiple' ? 'multi' : 'single'}</span>
    `;
    item.addEventListener('click', () => selectQuestion(i));
    questionList.appendChild(item);
  });
}

function selectQuestion(index) {
  selectedIndex = index;
  selectedQuestion = questions[index];

  document.querySelectorAll('.q-item').forEach((el, i) => {
    el.classList.toggle('active-q', i === index);
  });

  activeQText.innerHTML = mdHtml(selectedQuestion.question);
  sectionActive.style.display = '';

  // Show preview state — answer options with empty bars, ready to activate
  liveStats.style.display = 'none';
  btnActivate.style.display = '';
  btnClose.style.display = 'none';
  btnNext.style.display = selectedIndex < questions.length - 1 ? '' : 'none';
  setStatusBadge(null);

  if (selectedQuestion.correct) {
    correctAnswer.textContent = 'Correct: ' + selectedQuestion.correct;
    correctAnswer.style.display = '';
  } else {
    correctAnswer.style.display = 'none';
  }

  renderBarChart(selectedQuestion.answers, {}, 0);
  sectionActive.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function setStatusBadge(state) {
  // state: null | 'live' | 'closed'
  statusBadge.textContent = state === 'live' ? '● Live' : state === 'closed' ? '◼ Closed' : '';
  statusBadge.style.display = state ? '' : 'none';
  statusBadge.className = 'badge-live' + (state === 'closed' ? ' badge-closed' : '');
}

// ─── Activate question ────────────────────────────────────────────────────────
function activateQuestion() {
  if (!selectedQuestion || sessionExpired) return;

  socket.emit('activate-question', {
    question: selectedQuestion,
    sessionId: currentSessionId,
    token: TEACHER_TOKEN,
    title: currentTitle,
  });

  // Update UI immediately
  setStatusBadge('live');
  btnActivate.style.display = 'none';
  btnClose.style.display = '';
  btnNext.style.display = selectedIndex < questions.length - 1 ? '' : 'none';
  liveStats.style.display = '';
  statAnswered.textContent = '0';
  statJoined.textContent = '0';
  joined = 0;


  // Init bar chart
  renderBarChart(selectedQuestion.answers, {}, 0);
}
window.activateQuestion = activateQuestion;

// ─── Close voting ─────────────────────────────────────────────────────────────
function closeVoting() {
  if (!currentSessionId) return;
  socket.emit('close-voting', { sessionId: currentSessionId, token: TEACHER_TOKEN });
  setStatusBadge('closed');
  btnClose.style.display = 'none';
  btnActivate.style.display = '';
  btnNext.style.display = selectedIndex < questions.length - 1 ? '' : 'none';
}
window.closeVoting = closeVoting;

function nextQuestion() {
  if (selectedIndex < questions.length - 1) {
    selectQuestion(selectedIndex + 1);
  }
}
window.nextQuestion = nextQuestion;

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
  setStatusBadge('closed');
  btnClose.style.display = 'none';
  btnActivate.style.display = '';
  btnNext.style.display = selectedIndex < questions.length - 1 ? '' : 'none';
});

socket.on('session-expired', () => {
  sessionExpired = true;
  currentSessionId = null;
  setStatusBadge('closed');
  btnClose.style.display = 'none';
  btnActivate.style.display = 'none';
  btnNext.style.display = 'none';
  setStatus('Session has expired. Pull the repo again to start a new session.', true);
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
      <div class="bar-label" title="${escHtml(ans)}">${mdInline(ans)}</div>
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

// Render Markdown to HTML; inline-only (no wrapping <p>) for single-line strings
function mdHtml(s) {
  return marked.parse(s);
}

function mdInline(s) {
  return marked.parseInline(s);
}
