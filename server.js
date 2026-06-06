const fs = require('fs');
const path = require('path');
const envPath = fs.existsSync(path.join(__dirname, '.env')) ? path.join(__dirname, '.env') : '/etc/secrets/.env';
require('dotenv').config({ path: envPath });

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
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

// Normalise the correct field (array or single value) to 0-based answer indices.
// Accepts e.g. ['A','b','C'], 'B', or a bare YAML letter that js-yaml parsed as a string.
function toCorrectIndices(correct) {
  const letters = Array.isArray(correct) ? correct : (correct ? [correct] : []);
  return letters
    .map(l => String(l).trim()[0]?.toLowerCase())  // take only the first character
    .filter(Boolean)
    .map(l => 'abcdefghijklmnopqrstuvwxyz'.indexOf(l))
    .filter(i => i >= 0);
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

// Legal pages
app.get('/impressum', (req, res) => {
  const raw = req.query.back || '';
  const back = (raw.startsWith('/') || raw.startsWith(`${req.protocol}://${req.hostname}`)) ? raw : null;
  const logoHref = back || '/';
  const backLink = back ? back : 'javascript:history.back()';

  function field(envVar, label) {
    const val = process.env[envVar];
    return val
      ? val
      : `<span class="placeholder">${label}</span>`;
  }

  const footerBack = back ? '?back=' + encodeURIComponent(back) : '';
  const html = `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Impressum — QuiQui</title>
  <link rel="stylesheet" href="/style.css" />
  <style>
    .lang-nav { display:flex; gap:1rem; margin-bottom:1.5rem; }
    .lang-nav a { font-size:13px; font-weight:500; color:var(--color-text-muted); text-decoration:none; padding:4px 12px; border:0.5px solid var(--color-border-mid); border-radius:99px; }
    .lang-nav a:hover, .lang-nav a.active { background:var(--color-accent-light); color:var(--color-accent-dark); border-color:var(--color-accent); }
    .legal-content { display:none; }
    .legal-content.active { display:block; }
    .legal-content h1 { font-size:20px; font-weight:600; margin-bottom:1.25rem; }
    .legal-content h2 { font-size:14px; font-weight:600; text-transform:uppercase; letter-spacing:0.05em; color:var(--color-text-muted); margin:1.25rem 0 0.5rem; }
    .legal-content p { font-size:14px; line-height:1.7; margin-bottom:0.75rem; }
    .placeholder { background:var(--color-accent-light); color:var(--color-accent-dark); border-radius:3px; padding:1px 6px; font-style:italic; }
  </style>
</head>
<body>
  <div class="page-wrap">
    <header class="top-bar">
      <a href="${logoHref}"><img src="/quiqui-logo.png" alt="QuiQui" class="logo" /></a>
    </header>
    <main>
      <section class="card">
        <nav class="lang-nav">
          <a href="#de" id="btn-de" class="active" onclick="switchLang('de')">Deutsch</a>
          <a href="#en" id="btn-en" onclick="switchLang('en')">English</a>
        </nav>

        <div class="legal-content active" id="lang-de">
          <h1>Impressum</h1>

          <h2>Angaben gemäß § 5 TMG</h2>
          <p>
            ${field('IMPRESSUM_NAME', 'Titel, Vorname, Nachname')}<br />
            ${field('IMPRESSUM_INSTITUTION', 'Institution / Hochschule')}<br />
            ${field('IMPRESSUM_DEPARTMENT', 'Fakultät / Fachbereich')}<br />
            ${field('IMPRESSUM_STREET', 'Straße und Hausnummer')}<br />
            ${field('IMPRESSUM_CITY', 'PLZ Ort')}
          </p>

          <h2>Kontakt</h2>
          <p>E-Mail: ${field('IMPRESSUM_EMAIL', 'vorname.nachname@hochschule.de')}</p>

          <h2>Verantwortlich für den Inhalt nach § 18 Abs. 2 MStV</h2>
          <p>
            ${field('IMPRESSUM_NAME', 'Titel, Vorname, Nachname')}<br />
            ${field('IMPRESSUM_STREET', 'Straße und Hausnummer')}<br />
            ${field('IMPRESSUM_CITY', 'PLZ Ort')}
          </p>

          <h2>Hinweis</h2>
          <p>
            Diese Website wird im Rahmen von Lehrveranstaltungen an der
            ${field('IMPRESSUM_INSTITUTION', 'Name der Hochschule')} betrieben.
            Sie dient ausschließlich Bildungszwecken.
          </p>
        </div>

        <div class="legal-content" id="lang-en">
          <h1>Legal Notice (Impressum)</h1>

          <h2>Information according to § 5 TMG</h2>
          <p>
            ${field('IMPRESSUM_NAME', 'Title, First name, Last name')}<br />
            ${field('IMPRESSUM_INSTITUTION', 'Institution / University')}<br />
            ${field('IMPRESSUM_DEPARTMENT', 'Faculty / Department')}<br />
            ${field('IMPRESSUM_STREET', 'Street and number')}<br />
            ${field('IMPRESSUM_CITY', 'Postcode City')}
          </p>

          <h2>Contact</h2>
          <p>Email: ${field('IMPRESSUM_EMAIL', 'firstname.lastname@university.de')}</p>

          <h2>Responsible for content according to § 18 para. 2 MStV</h2>
          <p>
            ${field('IMPRESSUM_NAME', 'Title, First name, Last name')}<br />
            ${field('IMPRESSUM_STREET', 'Street and number')}<br />
            ${field('IMPRESSUM_CITY', 'Postcode City')}
          </p>

          <h2>Note</h2>
          <p>
            This website is operated in the context of courses at
            ${field('IMPRESSUM_INSTITUTION', 'University name')} for educational purposes only.
          </p>
        </div>
      </section>

      <p style="font-size:12px;color:#9e9e99;margin-top:1rem">
        <a href="${backLink}" style="color:inherit">← Back</a>
      </p>
    </main>
    <footer class="site-footer">
      <a href="/impressum${footerBack}">Impressum</a>
      <a href="/privacy${footerBack}">Privacy Policy</a>
    </footer>
  </div>
  <script>
    function switchLang(lang) {
      document.querySelectorAll('.legal-content').forEach(el => el.classList.remove('active'));
      document.querySelectorAll('.lang-nav a').forEach(el => el.classList.remove('active'));
      document.getElementById('lang-' + lang).classList.add('active');
      document.getElementById('btn-' + lang).classList.add('active');
    }
    if (window.location.hash === '#en') switchLang('en');
  </script>
</body>
</html>`;
  res.send(html);
});

app.get('/privacy', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
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
        answersRevealed: false,
        lastActivity: Date.now(),
      });
      // Notify any students already waiting at this URL
      io.to(`session:${sessionId}`).emit('session-created', { title: config.title || null });
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
      const correctIndices = s.answersRevealed ? toCorrectIndices(s.activeQuestion.correct) : [];
      socket.emit('session-state', {
        exists: true,
        question: studentQuestion,
        votes: s.votes,
        open: s.open,
        total: s.voters.size,
        title: s.title || null,
        answersRevealed: s.answersRevealed || false,
        correctIndices: s.answersRevealed ? correctIndices : [],
      });
    } else {
      socket.emit('session-state', { exists: !!s, question: null, votes: null, open: false, total: 0, title: s ? s.title || null : null, answersRevealed: false, correctIndices: [] });
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
    s.answersRevealed = false;
    touchSession(sessionId);

    // Initialise vote counts
    question.answers.forEach((_, i) => { s.votes[i] = 0; });

    // Strip teacher-only fields before broadcasting to students
    const { correct, explanation, ...studentQuestion } = question;
    io.to(`session:${sessionId}`).emit('question-activated', { question: studentQuestion, sessionId, title: s.title });
  });

  // Teacher reveals correct answers — closes voting implicitly and broadcasts highlighted indices
  socket.on('show-answer', ({ sessionId, token }) => {
    if (token !== TEACHER_SLUG) return;
    const s = sessions.get(sessionId);
    if (!s || !s.activeQuestion) return;

    s.open = false;
    s.answersRevealed = true;
    touchSession(sessionId);

    // Convert letter list (e.g. ['A','b','C'] or a single string 'B') to 0-based indices
    const correctIndices = toCorrectIndices(s.activeQuestion.correct);

    io.to(`session:${sessionId}`).emit('answer-revealed', { correctIndices, votes: s.votes, total: s.voters.size });
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
