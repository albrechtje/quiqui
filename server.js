require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const yaml = require('js-yaml');
const simpleGit = require('simple-git');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const TEACHER_SLUG = process.env.TEACHER_SLUG || 'teach';
const QUESTIONS_DIR = path.join(__dirname, 'tmp', 'questions');

const SESSION_TIMEOUT_MS = 90 * 60 * 1000; // 90 minutes after last question activation

// ─── In-memory session state ──────────────────────────────────────────────────
// One active session at a time (v1 scope).
let session = null;
// { sessionId, activeQuestion, title, votes, voters, open }
let sessionTimer = null; // reset on each activation, expires the session after 90 min of inactivity

// ─── Static files ─────────────────────────────────────────────────────────────
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// ─── Middleware ───────────────────────────────────────────────────────────────

function requireTeacher(req, res, next) {
  if (req.headers['x-teacher-token'] !== TEACHER_SLUG) {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Serve marked UMD bundle for the browser
app.get('/marked.min.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', 'marked', 'lib', 'marked.umd.js'));
});

// Teacher page
app.get(`/${TEACHER_SLUG}`, (req, res) => {
  res.sendFile(path.join(__dirname, 'teacher.html'));
});

// Student join page
app.get('/join/:sessionId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'student.html'));
});

// Pull/clone repo and return list of yaml files + config
app.post('/api/pull', requireTeacher, async (req, res) => {
  const { repo } = req.body;
  if (!repo) return res.status(400).json({ error: 'repo is required' });

  // Only allow public HTTPS repos — blocks file:// and ssh:// clones
  if (!/^https:\/\//i.test(repo)) {
    return res.status(400).json({ error: 'Only https:// repository URLs are supported.' });
  }

  try {
    await fs.promises.rm(QUESTIONS_DIR, { recursive: true, force: true });
    await fs.promises.mkdir(QUESTIONS_DIR, { recursive: true });

    const git = simpleGit();

    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Clone timed out after 15 seconds')), 15000)
    );
    await Promise.race([git.clone(repo, QUESTIONS_DIR, ['--depth', '1']), timeout]);

    // Read optional config.yaml
    let config = {};
    const configPath = path.join(QUESTIONS_DIR, 'config.yaml');
    try {
      config = yaml.load(await fs.promises.readFile(configPath, 'utf8')) || {};
    } catch (_) { /* config.yaml is optional */ }

    // List .yaml / .yml files (excluding config.yaml)
    const all = await fs.promises.readdir(QUESTIONS_DIR);
    const files = all.filter(f =>
      (f.endsWith('.yaml') || f.endsWith('.yml')) && f !== 'config.yaml' && f !== 'config.yml'
    );

    res.json({ files, config });
  } catch (err) {
    console.error('Pull failed:', err.message);
    const msg = err.message.includes('timed out') ? err.message
      : err.message.includes('Repository not found') || err.message.includes('not found') ? 'Repository not found. Check the URL and make sure it is public.'
      : err.message.includes('Authentication failed') || err.message.includes('could not read Username') ? 'Repository is private or requires authentication. Only public repositories are supported.'
      : 'Clone failed: ' + err.message;
    res.status(500).json({ error: msg });
  }
});

// Load questions from a specific file
app.get('/api/questions', requireTeacher, (req, res) => {
  const { file } = req.query;
  if (!file) return res.status(400).json({ error: 'file is required' });

  // Prevent path traversal
  const safe = path.basename(file);
  const filePath = path.join(QUESTIONS_DIR, safe);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  try {
    const questions = yaml.load(fs.readFileSync(filePath, 'utf8'));
    res.json({ questions });
  } catch (err) {
    res.status(500).json({ error: 'Failed to parse YAML: ' + err.message });
  }
});

// Generate QR code for a URL
app.get('/api/qr', requireTeacher, async (req, res) => {
  const { url } = req.query;
  if (!url) return res.status(400).json({ error: 'url is required' });
  try {
    const dataUrl = await QRCode.toDataURL(url, { width: 200, margin: 1 });
    res.json({ dataUrl });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Current session info (for teacher page reload)
app.get('/api/session', requireTeacher, (req, res) => {
  if (!session) return res.json({ session: null });
  res.json({
    session: {
      sessionId: session.sessionId,
      activeQuestion: session.activeQuestion,
      votes: session.votes,
      open: session.open,
      total: session.voters.size,
    }
  });
});

// ─── Session expiry ───────────────────────────────────────────────────────────

function expireSession() {
  if (!session) return;
  const { sessionId } = session;
  session.open = false;
  sessionTimer = null;
  io.to(`session:${sessionId}`).emit('voting-closed');
  io.to(`session:${sessionId}`).emit('session-expired');
  console.log(`Session ${sessionId} expired.`);
}

// ─── Socket.io ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {

  // Student joins a session room
  socket.on('join-session', ({ sessionId }) => {
    socket.join(`session:${sessionId}`);

    if (session && session.sessionId === sessionId) {
      const { correct, explanation, ...studentQuestion } = session.activeQuestion;
      socket.emit('session-state', {
        question: studentQuestion,
        votes: session.votes,
        open: session.open,
        total: session.voters.size,
        title: session.title || null,
      });
    } else {
      // No active session yet — student waits
      socket.emit('session-state', { question: null, votes: null, open: false, total: 0 });
    }
  });

  // Teacher activates a question — token checked here because socket events have no HTTP headers
  socket.on('activate-question', ({ question, sessionId, token, title }) => {
    if (token !== TEACHER_SLUG) return;

    socket.join(`session:${sessionId}`);
    session = {
      sessionId,
      activeQuestion: question,
      title: title || null,
      votes: {},
      voters: new Set(),
      open: true,
    };

    // Reset the 90-minute inactivity timer on every activation
    clearTimeout(sessionTimer);
    sessionTimer = setTimeout(expireSession, SESSION_TIMEOUT_MS);

    // Initialise vote counts
    question.answers.forEach((_, i) => { session.votes[i] = 0; });

    // Strip teacher-only fields before broadcasting to students
    const { correct, explanation, ...studentQuestion } = question;
    io.to(`session:${sessionId}`).emit('question-activated', { question: studentQuestion, sessionId, title: session.title });
  });

  // Student submits answer(s)
  socket.on('submit-answer', ({ sessionId, selected }) => {
    if (!session || session.sessionId !== sessionId) return;
    if (!session.open) return;
    if (session.voters.has(socket.id)) return; // deduplicated by socket ID

    // Cap selections to the number of actual answers to prevent inflated counts
    if (!Array.isArray(selected) || selected.length > session.activeQuestion.answers.length) return;

    session.voters.add(socket.id);
    selected.forEach(idx => {
      if (session.votes[idx] !== undefined) session.votes[idx]++;
    });

    const total = session.voters.size;
    io.to(`session:${sessionId}`).emit('vote-update', { votes: session.votes, total });
  });

  // Teacher closes voting — token checked same as activate-question
  socket.on('close-voting', ({ sessionId, token }) => {
    if (token !== TEACHER_SLUG) return;
    if (!session || session.sessionId !== sessionId) return;
    session.open = false;
    io.to(`session:${sessionId}`).emit('voting-closed');
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`QuiQui running on http://localhost:${PORT}`);
  console.log(`Teacher page: http://localhost:${PORT}/${TEACHER_SLUG}`);
});
