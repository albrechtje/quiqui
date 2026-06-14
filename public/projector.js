marked.use(markedKatex({ throwOnError: false }));

const socket = io();

// ─── State ────────────────────────────────────────────────────────────────────
let currentQuestion = null;

// ─── DOM refs ─────────────────────────────────────────────────────────────────
const screenWaiting  = document.getElementById('screen-waiting');
const screenQuestion = document.getElementById('screen-question');
const typeHint       = document.getElementById('type-hint');
const questionText   = document.getElementById('proj-q-text');
const answerList     = document.getElementById('proj-answer-list');
const resultMeta     = document.getElementById('proj-result-meta');
const qrImg          = document.getElementById('proj-qr-img');
const joinUrlEl      = document.getElementById('proj-join-url');
const cardFit        = document.getElementById('proj-card-fit');

// ─── Responsive scaling ─────────────────────────────────────────────────────────
// Only the question card scales; the header (logo + title) and QR sidebar stay
// at the fixed reference zoom (1.5, set in CSS on .projector-outer) for a stable
// look. We measure the card's natural height and shrink it (scale ≤ 1) just
// enough to fit the space left between its top edge and the bottom of the
// viewport — so more answer options or a shorter screen shrink the card alone.
const MAX_CARD_SCALE = 1;     // never enlarge past its natural (1.5×) size
const FIT_MARGIN = 0.97;      // breathing room above the bottom edge

function fitScreen() {
  if (!cardFit) return;
  // Reset to natural size before measuring; rect values already include the
  // parent's CSS zoom, so all the maths below is in real viewport pixels.
  cardFit.style.transform = 'scale(1)';
  const rect = cardFit.getBoundingClientRect();
  const available = (window.innerHeight - rect.top) * FIT_MARGIN;
  if (rect.height <= 0) return;
  const scale = Math.min(MAX_CARD_SCALE, available / rect.height);
  cardFit.style.transform = `scale(${scale})`;
}
window.addEventListener('resize', fitScreen);
fitScreen();

// ─── Init ─────────────────────────────────────────────────────────────────────
const joinUrl = `${location.origin}/join/${getSessionId()}`;

(function init() {
  const sessionId = getSessionId();
  if (!sessionId) return;

  // QR always encodes the real join URL; the shortlink (if any) only changes the
  // displayed text once it arrives via session-state / session-created.
  setJoinDisplay(null);
  fetchQR(joinUrl);
})();

// Join (and re-join) the session room on every (re)connect. A reconnect gives us
// a new socket id that is not in the room, so joining only once at page load would
// silently freeze the beamer on a stale question after an idle drop — no further
// question-activated / vote-update / session-* broadcasts would arrive.
socket.on('connect', () => {
  const sessionId = getSessionId();
  if (sessionId) socket.emit('join-session', { sessionId });
});

// Show the shortlink if the lecturer provided one, otherwise the full join URL.
function setJoinDisplay(shortlink) {
  joinUrlEl.textContent = shortlink || joinUrl;
}

function getSessionId() {
  const parts = window.location.pathname.split('/');
  return parts[parts.length - 1] || null;
}

async function fetchQR(url) {
  try {
    const res = await fetch(`/api/qr-public?url=${encodeURIComponent(url)}`);
    const data = await res.json();
    if (data.dataUrl) qrImg.src = data.dataUrl;
  } catch (_) {}
}

// ─── Socket events ────────────────────────────────────────────────────────────

socket.on('session-state', ({ exists, question, open, title, shortlink, answersRevealed, deactivated, correctIndices, votes, total }) => {
  if (title) applyTitle(title);
  setJoinDisplay(shortlink);
  if (question && (open || deactivated || answersRevealed)) {
    showQuestion(question);
    if (deactivated || answersRevealed) {
      showInlineBars();
      if (votes) updateInlineBars(votes, total || 0);
    }
    if (deactivated) {
      resultMeta.style.display = '';
      resultMeta.textContent = 'Voting has ended.';
    }
    if (answersRevealed) {
      resultMeta.style.display = '';
      resultMeta.textContent = `${total} answer${total !== 1 ? 's' : ''} submitted`;
      highlightCorrect(correctIndices);
    }
  } else {
    document.getElementById('waiting-msg').textContent = exists
      ? 'Waiting for the next question'
      : 'No quiz session active at this URL.';
  }
});

socket.on('question-activated', ({ question, title }) => {
  if (title) applyTitle(title);
  showQuestion(question);
  resultMeta.style.display = 'none';
  refit();
});

socket.on('question-deactivated', ({ votes, total }) => {
  if (!currentQuestion) return;
  showInlineBars();
  updateInlineBars(votes, total);
  resultMeta.style.display = '';
  resultMeta.textContent = 'Voting has ended.';
});

socket.on('answer-revealed', ({ correctIndices, votes, total }) => {
  if (!currentQuestion) return;
  showInlineBars();
  updateInlineBars(votes, total);
  resultMeta.style.display = '';
  resultMeta.textContent = `${total} answer${total !== 1 ? 's' : ''} submitted`;
  highlightCorrect(correctIndices);
});

socket.on('question-closed', () => {
  currentQuestion = null;
  showScreen('waiting');
});

socket.on('session-expired', () => {
  currentQuestion = null;
  document.getElementById('waiting-msg').textContent = 'No quiz session active at this URL.';
  showScreen('waiting');
});

socket.on('session-created', ({ title, shortlink }) => {
  if (title) applyTitle(title);
  setJoinDisplay(shortlink);
  if (!currentQuestion) {
    document.getElementById('waiting-msg').textContent = 'Waiting for the next question';
    showScreen('waiting');
  }
});

// ─── Show question ────────────────────────────────────────────────────────────
function showQuestion(question) {
  currentQuestion = question;

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
    answerList.appendChild(opt);
  });

  showScreen('question');
}

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
  refit(); // bars + percentages add height
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
  refit();
}

// Re-fit after content changes. rAF lets the browser lay out the new content
// (and render math/markdown) before we measure its natural height.
function refit() {
  requestAnimationFrame(fitScreen);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
function applyTitle(title) {
  document.title = `QuiQui: ${title}`;
  const el = document.getElementById('logo-title');
  if (el) el.textContent = title;
}

// Question/answer content comes from a public GitHub repo, so it is untrusted.
// Sanitise the rendered Markdown/LaTeX to strip embedded HTML/JS (XSS).
// DOMPurify's default profile permits HTML + SVG + MathML, preserving KaTeX output.
function mdHtml(s) { return DOMPurify.sanitize(marked.parse(s)); }
function mdInline(s) { return DOMPurify.sanitize(marked.parseInline(s)); }
