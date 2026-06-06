marked.use(markedKatex({ throwOnError: false }));

const socket = io();

// ─── State ────────────────────────────────────────────────────────────────────
let questions = [];
let selectedQuestion = null;
let selectedIndex = -1;
let currentSessionId = null;
let currentTitle = null;
let sessionExpired = false;
let revealedCorrectIndices = [];

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
const joinInfo        = document.getElementById('join-info');
const qrImg           = document.getElementById('qr-img');
const joinUrlEl       = document.getElementById('join-url');
const statAnsweredBadge = document.getElementById('stat-answered-badge');
const barChart        = document.getElementById('bar-chart');
const btnActivate     = document.getElementById('btn-activate');
const btnShowAnswer   = document.getElementById('btn-show-answer');
const btnClose        = document.getElementById('btn-close');
const btnNext         = document.getElementById('btn-next');
const statusBadge     = document.getElementById('status-badge');

// ─── Init ─────────────────────────────────────────────────────────────────────
(function init() {
  const params = new URLSearchParams(window.location.search);
  const repo = params.get('repo');
  if (repo) repoInput.value = repo;

  btnPull.addEventListener('click', pullRepo);
  repoInput.addEventListener('keydown', e => { if (e.key === 'Enter') pullRepo(); });
  fileSelect.addEventListener('change', loadFile);

  if (repo) {
    pullRepo();
  } else {
    repoInput.select();
  }
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
    joinUrlEl.href = joinUrl;
    joinInfo.style.display = '';
    fetchQR(joinUrl);

    if (data.config && data.config.title) {
      currentTitle = data.config.title;
      document.title = `QuiQui: ${currentTitle}`;
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
      <span class="q-text">${mdInline(previewQuestion(q.question))}</span>
      <span class="q-badge">${q.type === 'multiple' ? 'multi' : 'single'}</span>
    `;
    item.addEventListener('click', () => selectQuestion(i));
    questionList.appendChild(item);
  });
}

function selectQuestion(index) {
  selectedIndex = index;
  selectedQuestion = questions[index];
  revealedCorrectIndices = [];

  document.querySelectorAll('.q-item').forEach((el, i) => {
    el.classList.toggle('active-q', i === index);
  });

  activeQText.innerHTML = mdHtml(selectedQuestion.question);
  sectionActive.style.display = '';

  // Show preview state — answer options with empty bars, ready to activate
  statAnsweredBadge.textContent = '0 answered';
  statAnsweredBadge.style.display = '';
  btnActivate.disabled = false;
  btnShowAnswer.disabled = true;
  btnClose.disabled = true;
  btnNext.style.display = selectedIndex < questions.length - 1 ? '' : 'none';
  setStatusBadge(null);

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
  btnActivate.disabled = true;
  btnShowAnswer.disabled = false;
  btnClose.disabled = false;
  btnNext.style.display = selectedIndex < questions.length - 1 ? '' : 'none';
}
window.activateQuestion = activateQuestion;

// ─── Close voting ─────────────────────────────────────────────────────────────
function closeVoting() {
  if (!currentSessionId) return;
  socket.emit('close-voting', { sessionId: currentSessionId, token: TEACHER_TOKEN });
  setStatusBadge('closed');
  btnClose.disabled = true;
  btnShowAnswer.disabled = false;
  btnActivate.disabled = false;
  btnNext.style.display = selectedIndex < questions.length - 1 ? '' : 'none';
}
window.closeVoting = closeVoting;

// ─── Show answer ──────────────────────────────────────────────────────────────
function showAnswer() {
  if (!currentSessionId || !selectedQuestion) return;
  socket.emit('show-answer', { sessionId: currentSessionId, token: TEACHER_TOKEN });
  setStatusBadge('closed');
  btnShowAnswer.disabled = true;
  btnClose.disabled = false;
  btnActivate.disabled = false;
  btnNext.style.display = selectedIndex < questions.length - 1 ? '' : 'none';
}
window.showAnswer = showAnswer;

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
  statAnsweredBadge.textContent = `${total} answered`;
  renderBarChart(selectedQuestion.answers, votes, total, revealedCorrectIndices);
});

socket.on('voting-closed', () => {
  setStatusBadge('closed');
  btnClose.disabled = true;
  btnShowAnswer.disabled = false;
  btnActivate.disabled = false;
  btnNext.style.display = selectedIndex < questions.length - 1 ? '' : 'none';
});

socket.on('answer-revealed', ({ correctIndices, votes, total }) => {
  if (!selectedQuestion) return;
  revealedCorrectIndices = correctIndices;
  statAnsweredBadge.textContent = `${total} answered`;
  renderBarChart(selectedQuestion.answers, votes, total, correctIndices);
});

socket.on('session-expired', () => {
  sessionExpired = true;
  currentSessionId = null;
  setStatusBadge('closed');
  btnClose.disabled = true;
  btnShowAnswer.disabled = true;
  btnActivate.disabled = true;
  btnNext.style.display = 'none';
  setStatus('Session has expired. Pull the repo again to start a new session.', true);
});

// ─── Bar chart ────────────────────────────────────────────────────────────────
function renderBarChart(answers, votes, total, correctIndices = []) {
  barChart.innerHTML = '';
  const keys = ['A', 'B', 'C', 'D', 'E', 'F'];
  answers.forEach((ans, i) => {
    const count = (votes && votes[i]) || 0;
    const pct = total > 0 ? Math.round((count / total) * 100) : 0;
    const isCorrect = correctIndices.includes(i);
    const block = document.createElement('div');
    block.className = 'answer-opt' + (isCorrect ? ' answer-correct' : '');
    block.style.cursor = 'default';
    block.innerHTML = `
      <div class="opt-key">${keys[i] || i + 1}</div>
      <div style="flex:1">
        <div>${mdInline(ans)}</div>
        <div class="opt-bar-wrap visible">
          <div class="opt-bar-fill" style="width:${pct}%"></div>
        </div>
        <div class="opt-bar-pct visible">${pct}% (${count})</div>
      </div>
    `;
    barChart.appendChild(block);
  });
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
// Inline preview for the question list — collapses multiline, converts $$...$$ to $...$
function previewQuestion(s) {
  return s
    .replace(/```[\s\S]*?```/gs, '')
    .replace(/\$\$([\s\S]*?)\$\$/gs, (_, m) => `$${m.replace(/\s+/g, ' ').trim()}$`)
    .replace(/\s+/g, ' ')
    .trim();
}

function mdHtml(s) {
  return marked.parse(s);
}

function mdInline(s) {
  return marked.parseInline(s);
}
