require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto'); // used for random session ID fallback
const yaml = require('js-yaml');
const simpleGit = require('simple-git');
const QRCode = require('qrcode');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const TEACHER_SLUG = process.env.TEACHER_SLUG || 'teach';
const SESSIONS_DIR = path.join(__dirname, 'tmp', 'sessions');

const SESSION_TIMEOUT_MS = 90 * 60 * 1000; // 90 minutes after last question activation
const REPO_SIZE_LIMIT_KB = 1024;  // 1 MB — GitHub reports size in KB
const FILE_SIZE_LIMIT_KB = 100;   // 100 KB per question file

// ─── In-memory session state ──────────────────────────────────────────────────
// Map of sessionId → session object.
// { sessionId, repoUrl, questionsDir, activeQuestion, title, votes, voters, open, lastActivity }
const sessions = new Map();

// Single interval that reaps sessions idle for longer than SESSION_TIMEOUT_MS.
setInterval(() => {
  const now = Date.now();
  for (const [sessionId, s] of sessions) {
    if (now - s.lastActivity > SESSION_TIMEOUT_MS) {
      expireSession(sessionId);
    }
  }
}, 10000); // check every 10 s (fine for 90-min timeout; adjust if shortening for tests)

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

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Stable directory name for a repo — sanitised from the URL for easy debugging
// e.g. https://github.com/albrechtje/quiqui-questions → github.com-albrechtje-quiqui-questions
function repoDirName(repoUrl) {
  return repoUrl
    .replace(/^https?:\/\//, '')
    .replace(/\.git$/, '')
    .replace(/[^a-zA-Z0-9._-]/g, '-')
    .replace(/-+/g, '-')
    .slice(0, 64);
}

function touchSession(sessionId) {
  const s = sessions.get(sessionId);
  if (s) s.lastActivity = Date.now();
}

// ─── Routes ───────────────────────────────────────────────────────────────────

// Serve client-side bundles from node_modules
app.get('/marked.min.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', 'marked', 'lib', 'marked.umd.js'));
});
app.get('/katex.min.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', 'katex', 'dist', 'katex.min.js'));
});
app.get('/katex.min.css', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', 'katex', 'dist', 'katex.min.css'));
});
app.get('/katex-extension.js', (req, res) => {
  res.sendFile(path.join(__dirname, 'node_modules', 'marked-katex-extension', 'lib', 'index.umd.js'));
});
// KaTeX fonts (referenced by katex.min.css as ./fonts/...)
app.use('/fonts', express.static(path.join(__dirname, 'node_modules', 'katex', 'dist', 'fonts')));

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

  // Only allow public HTTPS GitHub repos
  if (!/^https:\/\//i.test(repo)) {
    return res.status(400).json({ error: 'Only https:// repository URLs are supported.' });
  }

  // Check repo size via GitHub API before cloning
  const githubMatch = repo.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/i);
  if (githubMatch) {
    try {
      const apiRes = await fetch(`https://api.github.com/repos/${githubMatch[1]}`, {
        headers: { 'User-Agent': 'quiqui', Accept: 'application/vnd.github+json' },
      });
      if (apiRes.status === 404) {
        return res.status(400).json({ error: 'Repository not found. Check the URL and make sure it is public.' });
      }
      if (apiRes.ok) {
        const { size } = await apiRes.json(); // size is in KB
        if (size > REPO_SIZE_LIMIT_KB) {
          return res.status(400).json({ error: `Repository is too large (${size} KB). Maximum allowed size is ${REPO_SIZE_LIMIT_KB} KB.` });
        }
      }
    } catch (_) { /* network error — proceed and let clone fail naturally */ }
  } else {
    return res.status(400).json({ error: 'Only GitHub repositories are supported (https://github.com/owner/repo).' });
  }

  const questionsDir = path.join(SESSIONS_DIR, repoDirName(repo));

  try {
    await fs.promises.rm(questionsDir, { recursive: true, force: true });
    await fs.promises.mkdir(questionsDir, { recursive: true });

    const git = simpleGit();
    const timeout = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Clone timed out after 15 seconds')), 15000)
    );
    await Promise.race([git.clone(repo, questionsDir, ['--depth', '1']), timeout]);

    // Read optional config.yaml
    let config = {};
    const configPath = path.join(questionsDir, 'config.yaml');
    try {
      config = yaml.load(await fs.promises.readFile(configPath, 'utf8')) || {};
    } catch (_) { /* config.yaml is optional */ }

    // Derive sessionId — stable slug from config or random fallback
    const sessionId = config.session_url || crypto.randomBytes(3).toString('hex');

    // Check for session_url conflict: another active session with the same ID from a different repo
    const existing = sessions.get(sessionId);
    if (existing && existing.repoUrl !== repo) {
      return res.status(409).json({
        error: `Session URL "${sessionId}" is already in use by a different repository. Change session_url in your config.yaml to something unique.`,
      });
    }

    // Register or refresh the session entry (no active question yet)
    if (!existing) {
      sessions.set(sessionId, {
        sessionId,
        repoUrl: repo,
        questionsDir,
        activeQuestion: null,
        title: config.title || null,
        votes: {},
        voters: new Set(),
        open: false,
        lastActivity: Date.now(),
      });
      // Notify any students already waiting at this URL
      io.to(`session:${sessionId}`).emit('session-created');
    } else {
      // Same repo pulled again — refresh directory and activity
      existing.questionsDir = questionsDir;
      existing.title = config.title || null;
      existing.lastActivity = Date.now();
    }

    // List .yaml / .yml files (excluding config.yaml)
    const all = await fs.promises.readdir(questionsDir);
    const files = all.filter(f =>
      (f.endsWith('.yaml') || f.endsWith('.yml')) && f !== 'config.yaml' && f !== 'config.yml'
    );

    res.json({ files, config, sessionId });
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
app.get('/api/questions', requireTeacher, async (req, res) => {
  const { file, sessionId } = req.query;
  if (!file) return res.status(400).json({ error: 'file is required' });
  if (!sessionId) return res.status(400).json({ error: 'sessionId is required' });

  const s = sessions.get(sessionId);
  if (!s) return res.status(404).json({ error: 'Session not found.' });

  // Prevent path traversal
  const safe = path.basename(file);
  const filePath = path.join(s.questionsDir, safe);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

  try {
    const { size } = await fs.promises.stat(filePath);
    if (size > FILE_SIZE_LIMIT_KB * 1024) {
      return res.status(400).json({ error: `File is too large (${Math.round(size / 1024)} KB). Maximum allowed size is ${FILE_SIZE_LIMIT_KB} KB.` });
    }
    const questions = yaml.load(fs.readFileSync(filePath, 'utf8'));
    touchSession(sessionId);
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
  const { sessionId } = req.query;
  const s = sessionId ? sessions.get(sessionId) : null;
  if (!s) return res.json({ session: null });
  res.json({
    session: {
      sessionId: s.sessionId,
      activeQuestion: s.activeQuestion,
      votes: s.votes,
      open: s.open,
      total: s.voters.size,
    }
  });
});

// ─── Session expiry ───────────────────────────────────────────────────────────

function expireSession(sessionId) {
  const s = sessions.get(sessionId);
  if (!s) return;
  s.open = false;
  io.to(`session:${sessionId}`).emit('voting-closed');
  io.to(`session:${sessionId}`).emit('session-expired');
  io.emit('session-expired');
  // Clean up cloned files
  fs.promises.rm(s.questionsDir, { recursive: true, force: true }).catch(() => {});
  sessions.delete(sessionId);
  console.log(`Session ${sessionId} expired.`);
}

// ─── Socket.io ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {

  // Student joins a session room
  socket.on('join-session', ({ sessionId }) => {
    socket.join(`session:${sessionId}`);

    const s = sessions.get(sessionId);
    if (s && s.activeQuestion) {
      const { correct, explanation, ...studentQuestion } = s.activeQuestion;
      socket.emit('session-state', {
        exists: true,
        question: studentQuestion,
        votes: s.votes,
        open: s.open,
        total: s.voters.size,
        title: s.title || null,
      });
    } else {
      socket.emit('session-state', { exists: !!s, question: null, votes: null, open: false, total: 0 });
    }
  });

  // Teacher activates a question — token checked here because socket events have no HTTP headers
  socket.on('activate-question', ({ question, sessionId, token, title }) => {
    if (token !== TEACHER_SLUG) return;

    const s = sessions.get(sessionId);
    if (!s) return;

    socket.join(`session:${sessionId}`);
    s.activeQuestion = question;
    s.title = title || null;
    s.votes = {};
    s.voters = new Set();
    s.open = true;
    touchSession(sessionId);

    // Initialise vote counts
    question.answers.forEach((_, i) => { s.votes[i] = 0; });

    // Strip teacher-only fields before broadcasting to students
    const { correct, explanation, ...studentQuestion } = question;
    io.to(`session:${sessionId}`).emit('question-activated', { question: studentQuestion, sessionId, title: s.title });
  });

  // Student submits answer(s)
  socket.on('submit-answer', ({ sessionId, selected }) => {
    const s = sessions.get(sessionId);
    if (!s || !s.open) return;
    if (s.voters.has(socket.id)) return; // deduplicated by socket ID

    // Cap selections to the number of actual answers to prevent inflated counts
    if (!Array.isArray(selected) || selected.length > s.activeQuestion.answers.length) return;

    s.voters.add(socket.id);
    selected.forEach(idx => {
      if (s.votes[idx] !== undefined) s.votes[idx]++;
    });

    const total = s.voters.size;
    io.to(`session:${sessionId}`).emit('vote-update', { votes: s.votes, total });
  });

  // Teacher closes voting — token checked same as activate-question
  socket.on('close-voting', ({ sessionId, token }) => {
    if (token !== TEACHER_SLUG) return;
    const s = sessions.get(sessionId);
    if (!s) return;
    s.open = false;
    touchSession(sessionId);
    io.to(`session:${sessionId}`).emit('voting-closed');
  });
});

// ─── Start ────────────────────────────────────────────────────────────────────
server.listen(PORT, () => {
  console.log(`QuiQui running on http://localhost:${PORT}`);
  console.log(`Teacher page: http://localhost:${PORT}/${TEACHER_SLUG}`);
});
