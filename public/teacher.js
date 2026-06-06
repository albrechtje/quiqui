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
const repoInput        = document.getElementById('repo-url');
const btnPull          = document.getElementById('btn-pull');
const fileSelect       = document.getElementById('file-select');
const pullStatus       = document.getElementById('pull-status');
const sectionQuestions = document.getElementById('section-questions');
const questionList     = document.getElementById('question-list');
const sectionActive    = document.getElementById('section-active');
const activeQText      = document.getElementById('active-q-text');
const joinInfo         = document.getElementById('join-info');
const qrImg            = document.getElementById('qr-img');
const joinUrlEl        = document.getElementById('join-url');
const statAnsweredBadge = document.getElementById('stat-answered-badge');
const barChart         = document.getElementById('bar-chart');
const btnActivate      = document.getElementById('btn-activate');
const btnShowAnswer    = document.getElementById('btn-show-answer');
const btnClose         = document.getElementById('btn-close');
const btnNext          = document.getElementById('btn-next');
const explanationEl    = document.getElementById('explanation');
const statusBadge      = document.getElementById('status-badge');
const connectionIndicator = document.getElementById('connection-indicator');

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
    sectionActive.style.display = 'none';
    questionList.innerHTML = '';
    selectedQuestion = null;
    selectedIndex = -1;
    revealedCorrectIndices = [];
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
    selectedQuestion = null;
    selectedIndex = -1;
    renderQuestionList();
    sectionQuestions.style.display = '';
    sectionActive.style.display = 'none';
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
  if (currentSessionId) socket.emit('close-question', { sessionId: currentSessionId, token: TEACHER_TOKEN });
  selectedIndex = index;
  selectedQuestion = questions[index];
  revealedCorrectIndices = [];

  document.querySelectorAll('.q-item').forEach((el, i) => {
    el.classList.toggle('active-q', i === index);
  });

  activeQText.innerHTML = mdHtml(selectedQuestion.question);
  sectionActive.style.display = '';

  statAnsweredBadge.textContent = '0 answered';
  statAnsweredBadge.style.display = '';
  setState('inactive');

  if (selectedQuestion.explanation) {
    const correct = selectedQuestion.correct;
    const letters = (Array.isArray(correct) ? correct : [correct])
      .map(l => String(l).trim()[0].toUpperCase())
      .join(', ');
    explanationEl.textContent = `${letters}: ${selectedQuestion.explanation}`;
    explanationEl.style.display = '';
  } else {
    explanationEl.style.display = 'none';
  }

  renderBarChart(selectedQuestion.answers, {}, 0);
  sectionActive.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

// ─── State machine ────────────────────────────────────────────────────────────
// States: 'inactive' | 'active' | 'deactivated' | 'revealed' | 'closed'
// 'inactive'    — teacher preview, students on waiting screen
// 'active'      — voting open
// 'deactivated' — voting closed, students see bars (no highlights)
// 'revealed'    — voting closed, students see bars + highlights
// 'closed'      — students on waiting screen, activeQuestion cleared

function setState(state) {
  const labels = {
    inactive:    '◌ Inactive',
    active:      '● Live',
    deactivated: '◼ Deactivated',
    revealed:    '◼ Revealed',
    closed:      '◼ Closed',
  };
  const badgeMod = state === 'active' ? '' : state === 'inactive' ? ' badge-inactive' : ' badge-closed';
  statusBadge.textContent = labels[state] || '';
  statusBadge.style.display = state ? '' : 'none';
  statusBadge.className = 'badge-live' + badgeMod;

  // Activate button toggles label based on state
  btnActivate.textContent = state === 'active' ? '⏹ Deactivate' : '▶ Activate';
  btnActivate.className   = state === 'active' ? 'btn-secondary' : 'btn-primary';

  // disabled=true per state:
  //               Activate  Reveal  Close
  // inactive          ✗       ✓      ✓
  // active            ✗       ✗      ✗
  // deactivated       ✗       ✗      ✗
  // revealed          ✗       ✓      ✗
  // closed            ✗       ✓      ✓
  const cfg = {
    inactive:    { activate: false, reveal: true,  close: true  },
    active:      { activate: false, reveal: false, close: false },
    deactivated: { activate: false, reveal: false, close: false },
    revealed:    { activate: false, reveal: true,  close: false },
    closed:      { activate: false, reveal: true,  close: true  },
  }[state];
  btnActivate.disabled   = cfg.activate;
  btnShowAnswer.disabled = cfg.reveal;
  btnClose.disabled      = cfg.close;
  updateNextBtn();
}

function updateNextBtn() {
  btnNext.style.display = selectedIndex < questions.length - 1 ? '' : 'none';
}

// ─── Activate / Deactivate toggle ─────────────────────────────────────────────
function activateQuestion() {
  if (!selectedQuestion || sessionExpired) return;
  if (btnActivate.textContent.startsWith('⏹')) {
    // Currently active — deactivate
    socket.emit('deactivate-question', { sessionId: currentSessionId, token: TEACHER_TOKEN });
  } else {
    socket.emit('activate-question', {
      question: selectedQuestion,
      sessionId: currentSessionId,
      token: TEACHER_TOKEN,
      title: currentTitle,
    });
    setState('active');
  }
}
window.activateQuestion = activateQuestion;

// ─── Reveal answer ────────────────────────────────────────────────────────────
function revealAnswer() {
  if (!currentSessionId || !selectedQuestion) return;
  socket.emit('show-answer', { sessionId: currentSessionId, token: TEACHER_TOKEN });
}
window.revealAnswer = revealAnswer;

// ─── Close question ───────────────────────────────────────────────────────────
function closeQuestion() {
  if (!currentSessionId) return;
  socket.emit('close-question', { sessionId: currentSessionId, token: TEACHER_TOKEN });
}
window.closeQuestion = closeQuestion;

function nextQuestion() {
  if (selectedIndex < questions.length - 1) selectQuestion(selectedIndex + 1);
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

// ─── Connection indicator ─────────────────────────────────────────────────────
socket.on('connect', () => {
  connectionIndicator.classList.remove('connection-indicator--off');
  connectionIndicator.title = 'Connected';
});

socket.on('disconnect', () => {
  connectionIndicator.classList.add('connection-indicator--off');
  connectionIndicator.title = 'Disconnected — reconnecting…';
});

// ─── Socket events ────────────────────────────────────────────────────────────
socket.on('vote-update', ({ votes, total }) => {
  if (!selectedQuestion) return;
  statAnsweredBadge.textContent = `${total} answered`;
  renderBarChart(selectedQuestion.answers, votes, total, revealedCorrectIndices);
});

socket.on('question-deactivated', ({ votes, total }) => {
  if (!selectedQuestion) return;
  statAnsweredBadge.textContent = `${total} answered`;
  renderBarChart(selectedQuestion.answers, votes, total, []);
  setState('deactivated');
});

socket.on('answer-revealed', ({ correctIndices, votes, total }) => {
  if (!selectedQuestion) return;
  revealedCorrectIndices = correctIndices;
  statAnsweredBadge.textContent = `${total} answered`;
  renderBarChart(selectedQuestion.answers, votes, total, correctIndices);
  setState('revealed');
});

socket.on('question-closed', () => {
  setState('closed');
});

socket.on('session-expired', () => {
  sessionExpired = true;
  currentSessionId = null;
  btnActivate.disabled = true;
  btnShowAnswer.disabled = true;
  btnClose.disabled = true;
  btnNext.style.display = 'none';
  statusBadge.style.display = 'none';
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

function mdHtml(s) { return marked.parse(s); }
function mdInline(s) { return marked.parseInline(s); }
