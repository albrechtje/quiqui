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
let currentVotes = {};
let currentTotal = 0;
let currentState = 'inactive';
let runStart = 0;        // Date.now() when the question went active
let runTimer = null;     // setInterval handle for the live stopwatch
let collapseOnClose = false; // when true, the next question-closed echo collapses the inline card

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
    const projectorUrl = `${location.origin}/view/${currentSessionId}`;
    const projectorUrlEl = document.getElementById('projector-url');
    projectorUrlEl.textContent = projectorUrl;
    projectorUrlEl.href = projectorUrl;

    // Optional lecturer-provided shortlink from config.yaml — display only,
    // QuiQui does not resolve or validate where it points. The server normalises
    // it (trim + scheme prefix) so the value here is ready to use.
    setShortlink(data.shortlink);

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
    parkActiveCard();
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
    stopStopwatch();
    questionList.firstElementChild?.focus();
  } catch (err) {
    setStatus('Error loading file: ' + err.message, true);
  }
}

// ─── Question list ────────────────────────────────────────────────────────────
// Park the active card back at its home position (after #section-questions) and
// hide it. Used before rebuilding the list, which would otherwise delete the
// card when it is parked inline among the .q-item children.
function parkActiveCard() {
  stopStopwatch();
  sectionActive.style.display = 'none';
  if (sectionActive.parentElement === questionList) {
    sectionQuestions.after(sectionActive);
  }
}

function renderQuestionList() {
  parkActiveCard();
  questionList.innerHTML = '';
  questions.forEach((q, i) => {
    const item = document.createElement('div');
    item.className = 'q-item';
    item.dataset.index = i;
    item.tabIndex = 0;
    item.innerHTML = `
      <span class="q-text">${mdInline(previewQuestion(q.question))}</span>
      <span class="q-badge">${q.type === 'multiple' ? 'multi' : 'single'}</span>
    `;
    item.addEventListener('click', () => selectQuestion(i));
    item.addEventListener('keydown', e => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectQuestion(i); }
      if (e.key === 'ArrowDown') { e.preventDefault(); item.nextElementSibling?.focus(); }
      if (e.key === 'ArrowUp')   { e.preventDefault(); item.previousElementSibling?.focus(); }
    });
    questionList.appendChild(item);
  });
}

function selectQuestion(index) {
  collapseOnClose = false; // this close is part of switching questions, not a collapse
  if (currentSessionId) socket.emit('close-question', { sessionId: currentSessionId, token: TEACHER_TOKEN });
  selectedIndex = index;
  selectedQuestion = questions[index];
  revealedCorrectIndices = [];
  currentVotes = {};
  currentTotal = 0;
  currentState = 'inactive';

  // Inline the active card in place of the selected snippet: hide that snippet
  // and move the (single) #section-active card to sit right after it in the list.
  const items = questionList.querySelectorAll('.q-item');
  items.forEach((el, i) => {
    el.classList.remove('active-q');
    el.style.display = i === index ? 'none' : '';
  });
  const target = items[index];
  if (target) target.after(sectionActive);

  activeQText.innerHTML = mdHtml(selectedQuestion.question);
  sectionActive.style.display = '';

  statAnsweredBadge.textContent = '0 answered';
  statAnsweredBadge.style.display = '';
  setState('inactive');

  if (selectedQuestion.explanation) {
    const correct = selectedQuestion.correct;
    if (correct != null) {
      const letters = (Array.isArray(correct) ? correct : [correct])
        .map(l => String(l).trim()[0].toUpperCase())
        .join(', ');
      explanationEl.textContent = `${letters}: ${selectedQuestion.explanation}`;
    } else {
      explanationEl.textContent = selectedQuestion.explanation;
    }
    explanationEl.style.display = '';
  } else {
    explanationEl.style.display = 'none';
  }

  renderBarChart(selectedQuestion.answers, {}, 0);
  sectionActive.scrollIntoView({ behavior: 'smooth', block: 'center' });
  btnActivate.focus();
}

// Collapse the inline active card back to a snippet: hide the card and re-show
// the snippet it replaced, restoring it to the focused list position.
function collapseActive() {
  stopStopwatch();
  sectionActive.style.display = 'none';
  const item = questionList.querySelector(`.q-item[data-index="${selectedIndex}"]`);
  if (item) {
    item.style.display = '';
    item.classList.remove('active-q');
    item.focus();
  }
  selectedQuestion = null;
  selectedIndex = -1;
}

// ─── State machine ────────────────────────────────────────────────────────────
// States: 'inactive' | 'active' | 'deactivated' | 'revealed' | 'closed'
// 'inactive'    — teacher preview, students on waiting screen
// 'active'      — voting open
// 'deactivated' — voting closed, students see bars (no highlights)
// 'revealed'    — voting closed, students see bars + highlights
// 'closed'      — students on waiting screen, activeQuestion cleared

function setState(state) {
  currentState = state;
  const labels = {
    inactive:    '◌ Inactive',
    active:      '● Active',
    deactivated: '◼ Deactivated',
    revealed:    '◼ Revealed',
    closed:      '◼ Closed',
  };
  statusBadge.style.display = state ? '' : 'none';
  if (state === 'active') {
    // While active, the badge becomes a live red stopwatch counting up.
    startStopwatch();
  } else {
    stopStopwatch();
    const badgeMod = state === 'inactive' ? ' badge-inactive' : ' badge-closed';
    statusBadge.textContent = labels[state] || '';
    statusBadge.className = 'badge-live' + badgeMod;
  }

  // Activate button toggles label based on state
  btnActivate.textContent = state === 'active' ? '⏹ Deactivate' : '▶ Activate';

  // Button styles and disabled state per state:
  // strong blue = btn-primary, light blue = btn-light, white = btn-secondary (disabled)
  //               Activate       Reveal         Close
  // inactive      strong         white(off)     light
  // active        light          strong         light
  // deactivated   light          strong         light
  // revealed      light          white(off)     strong
  // closed        strong         white(off)     white(off)
  // In 'inactive' the question was never activated, so Close has nothing to tear
  // down server-side — it just collapses the inline card back to a snippet.
  const cfg = {
    inactive:    { activate: ['btn-primary', false], reveal: ['btn-secondary', true],  close: ['btn-light',     false], next: false },
    active:      { activate: ['btn-light',   false], reveal: ['btn-primary',   false], close: ['btn-light',     false], next: false },
    deactivated: { activate: ['btn-light',   false], reveal: ['btn-primary',   false], close: ['btn-light',     false], next: false },
    revealed:    { activate: ['btn-light',   false], reveal: ['btn-secondary', true],  close: ['btn-primary',   false], next: false },
    closed:      { activate: [currentTotal > 0 ? 'btn-light' : 'btn-primary', false], reveal: ['btn-secondary', true], close: ['btn-secondary', true], next: currentTotal > 0 },
  }[state];
  const hasCorrect = selectedQuestion && selectedQuestion.correct != null;
  btnShowAnswer.style.display = hasCorrect ? '' : 'none';
  [btnActivate, btnShowAnswer, btnClose].forEach((btn, i) => {
    const key = ['activate', 'reveal', 'close'][i];
    btn.className = cfg[key][0];
    btn.disabled  = cfg[key][1];
  });
  updateNextBtn(cfg.next);
  const primary = cfg.next ? btnNext : [btnActivate, btnShowAnswer, btnClose].find((btn, i) => cfg[['activate','reveal','close'][i]][0] === 'btn-primary' && btn.style.display !== 'none');
  if (primary) primary.focus();
}

// ─── Stopwatch ────────────────────────────────────────────────────────────────
// While a question is active, the status badge shows elapsed run time (m:ss),
// updated once per second. Reverts to a normal badge in every other state.
function startStopwatch() {
  if (runTimer) return;          // already running — keep the existing start time
  runStart = Date.now();
  renderStopwatch();
  runTimer = setInterval(renderStopwatch, 1000);
}

function stopStopwatch() {
  if (runTimer) { clearInterval(runTimer); runTimer = null; }
}

function renderStopwatch() {
  const secs = Math.floor((Date.now() - runStart) / 1000);
  const mins = Math.floor(secs / 60);
  statusBadge.textContent = `● ${mins}:${String(secs % 60).padStart(2, '0')}`;
  statusBadge.className = 'badge-live badge-running';
}

function updateNextBtn(strong = false) {
  const visible = selectedIndex < questions.length - 1;
  btnNext.style.display = visible ? '' : 'none';
  if (visible) btnNext.className = strong ? 'btn-primary' : 'btn-light';
}

// ─── Activate / Deactivate toggle ─────────────────────────────────────────────
function activateQuestion() {
  if (!selectedQuestion || sessionExpired) return;
  if (currentState === 'active') {
    socket.emit('deactivate-question', { sessionId: currentSessionId, token: TEACHER_TOKEN });
  } else {
    socket.emit('activate-question', {
      question: selectedQuestion,
      sessionId: currentSessionId,
      token: TEACHER_TOKEN,
      title: currentTitle,
    });
    revealedCorrectIndices = [];
    renderBarChart(selectedQuestion.answers, currentVotes, currentTotal, []);
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
  // A question that was only previewed (never activated) has no server-side
  // activeQuestion to clear — just collapse the inline card back to a snippet.
  if (currentState === 'inactive') { collapseActive(); return; }
  if (!currentSessionId) return;
  collapseOnClose = true; // a deliberate close collapses the inline card back to a snippet
  socket.emit('close-question', { sessionId: currentSessionId, token: TEACHER_TOKEN });
}
window.closeQuestion = closeQuestion;

function nextQuestion() {
  if (selectedIndex < questions.length - 1) selectQuestion(selectedIndex + 1);
}
window.nextQuestion = nextQuestion;

// ─── Optional shortlink ───────────────────────────────────────────────────────
// Lecturer-provided link from config.yaml (student_shortlink). Display only:
// QuiQui shows it but never resolves or checks where it points. The server has
// already normalised it (trim + scheme prefix), so it is null or ready to use.
function setShortlink(shortlink) {
  const label = document.getElementById('shortlink-label');
  const link = document.getElementById('shortlink-url');
  if (!shortlink) {
    label.style.display = 'none';
    link.style.display = 'none';
    return;
  }
  link.textContent = shortlink;
  link.href = shortlink;
  label.style.display = '';
  link.style.display = '';
}

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
  // Re-join the session room after a (re)connect — the new socket id is not in
  // the room, so without this vote-update and button-echo broadcasts would stop
  // reaching us, leaving frozen bars and seemingly dead buttons.
  if (currentSessionId && !sessionExpired) {
    socket.emit('join-session', { sessionId: currentSessionId });
  }
});

socket.on('disconnect', () => {
  connectionIndicator.classList.add('connection-indicator--off');
  connectionIndicator.title = 'Disconnected — reconnecting…';
});

// ─── Socket events ────────────────────────────────────────────────────────────
socket.on('vote-update', ({ votes, total }) => {
  if (!selectedQuestion) return;
  currentVotes = votes;
  currentTotal = total;
  statAnsweredBadge.textContent = `${total} answered`;
  renderBarChart(selectedQuestion.answers, votes, total, revealedCorrectIndices);
});

socket.on('question-deactivated', ({ votes, total }) => {
  if (!selectedQuestion) return;
  currentVotes = votes;
  currentTotal = total;
  statAnsweredBadge.textContent = `${total} answered`;
  renderBarChart(selectedQuestion.answers, votes, total, []);
  setState('deactivated');
});

socket.on('answer-revealed', ({ correctIndices, votes, total }) => {
  if (!selectedQuestion) return;
  currentVotes = votes;
  currentTotal = total;
  revealedCorrectIndices = correctIndices;
  statAnsweredBadge.textContent = `${total} answered`;
  renderBarChart(selectedQuestion.answers, votes, total, correctIndices);
  setState('revealed');
});

socket.on('question-closed', () => {
  // A deliberate ✕ Close collapses the inline card back to a snippet. The
  // close-question emitted while switching questions leaves the flag false, so
  // the freshly-expanded card for the new question is not collapsed by its echo.
  if (collapseOnClose) {
    collapseOnClose = false;
    collapseActive();
  } else {
    setState('closed');
  }
});

socket.on('session-expired', () => {
  sessionExpired = true;
  currentSessionId = null;
  btnActivate.disabled = true;
  btnShowAnswer.disabled = true;
  btnClose.disabled = true;
  btnNext.style.display = 'none';
  parkActiveCard();
  questionList.querySelectorAll('.q-item').forEach(el => { el.style.display = ''; el.classList.remove('active-q'); });
  selectedQuestion = null;
  selectedIndex = -1;
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

// Question/answer content comes from a public GitHub repo, so it is untrusted.
// Sanitise the rendered Markdown/LaTeX to strip embedded HTML/JS (XSS).
// DOMPurify's default profile permits HTML + SVG + MathML, preserving KaTeX output.
function mdHtml(s) { return DOMPurify.sanitize(marked.parse(s)); }
function mdInline(s) { return DOMPurify.sanitize(marked.parseInline(s)); }
