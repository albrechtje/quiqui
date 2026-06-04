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

// ─── In-memory session state ──────────────────────────────────────────────────
// One active session at a time (v1 scope).
let session = null;
// { sessionId, activeQuestion, votes: {0:n,...}, voters: Set, open: bool }

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

  try {
    await fs.promises.rm(QUESTIONS_DIR, { recursive: true, force: true });
    await fs.promises.mkdir(QUESTIONS_DIR, { recursive: true });

    const git = simpleGit();
    await git.clone(repo, QUESTIONS_DIR, ['--depth', '1']);

    // Read optional config.yaml
    let config = {};
    const configPath = path.join(QUESTIONS_DIR, 'config.yaml');
    if (fs.existsSync(configPath)) {
      config = yaml.load(fs.readFileSync(configPath, 'utf8')) || {};
    }

    // List .yaml / .yml files (excluding config.yaml)
    const all = await fs.promises.readdir(QUESTIONS_DIR);
    const files = all.filter(f =>
      (f.endsWith('.yaml') || f.endsWith('.yml')) && f !== 'config.yaml' && f !== 'config.yml'
    );

    res.json({ files, config });
  } catch (err) {
    console.error('Pull failed:', err.message);
    res.status(500).json({ error: err.message });
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
      });
    } else {
      // No active session yet — student waits
      socket.emit('session-state', { question: null, votes: null, open: false, total: 0 });
    }
  });

  // Teacher activates a question
  socket.on('activate-question', ({ question, sessionId, token }) => {
    if (token !== TEACHER_SLUG) return;
    session = {
      sessionId,
      activeQuestion: question,
      votes: {},
      voters: new Set(),
      open: true,
    };
    // Initialise vote counts
    question.answers.forEach((_, i) => { session.votes[i] = 0; });

    // Strip teacher-only fields before broadcasting to students
    const { correct, explanation, ...studentQuestion } = question;
    io.to(`session:${sessionId}`).emit('question-activated', { question: studentQuestion, sessionId });
  });

  // Student submits answer(s)
  socket.on('submit-answer', ({ sessionId, selected }) => {
    if (!session || session.sessionId !== sessionId) return;
    if (!session.open) return;
    if (session.voters.has(socket.id)) return; // no double voting

    session.voters.add(socket.id);
    selected.forEach(idx => {
      if (session.votes[idx] !== undefined) session.votes[idx]++;
    });

    const total = session.voters.size;
    io.to(`session:${sessionId}`).emit('vote-update', { votes: session.votes, total });
  });

  // Teacher closes voting
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
