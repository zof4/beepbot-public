function scoreTrackerTemplate(title) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
    <style>
      :root {
        --bg: #f4f6fb;
        --card: #ffffff;
        --ink: #182035;
        --muted: #6c7385;
        --line: #dde2ef;
        --brand: #1355ff;
        --brand-soft: #e7eeff;
        --good: #0f8f45;
        --bad: #b23737;
      }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        font-family: "IBM Plex Sans", "Segoe UI", sans-serif;
        color: var(--ink);
        background:
          radial-gradient(circle at 20% 0%, #dde7ff 0%, transparent 35%),
          radial-gradient(circle at 90% 10%, #d6fff2 0%, transparent 25%),
          var(--bg);
        min-height: 100vh;
      }
      .wrap {
        max-width: 920px;
        margin: 40px auto;
        padding: 0 16px;
      }
      .card {
        background: var(--card);
        border: 1px solid var(--line);
        border-radius: 14px;
        padding: 18px;
        box-shadow: 0 8px 28px rgba(15, 29, 75, 0.06);
      }
      h1 {
        margin: 0 0 14px;
        font-size: 1.9rem;
      }
      p.sub {
        color: var(--muted);
        margin-top: 0;
      }
      form {
        display: grid;
        grid-template-columns: repeat(6, minmax(0, 1fr));
        gap: 10px;
        margin-bottom: 16px;
      }
      input, button {
        width: 100%;
        border: 1px solid var(--line);
        border-radius: 10px;
        padding: 10px 12px;
        font: inherit;
      }
      button {
        background: var(--brand);
        color: white;
        border: none;
        cursor: pointer;
      }
      button:hover { filter: brightness(1.05); }
      .span-2 { grid-column: span 2; }
      .span-3 { grid-column: span 3; }
      .stats {
        display: flex;
        gap: 12px;
        margin: 14px 0 18px;
      }
      .stat {
        flex: 1;
        background: var(--brand-soft);
        border-radius: 12px;
        padding: 12px;
      }
      .stat strong {
        display: block;
        font-size: 1.4rem;
        margin-top: 4px;
      }
      table {
        width: 100%;
        border-collapse: collapse;
      }
      th, td {
        padding: 10px;
        border-bottom: 1px solid var(--line);
        text-align: left;
      }
      .win { color: var(--good); }
      .loss { color: var(--bad); }
      @media (max-width: 760px) {
        form { grid-template-columns: 1fr 1fr; }
        .span-2, .span-3 { grid-column: span 2; }
        .stats { flex-direction: column; }
      }
    </style>
  </head>
  <body>
    <main class="wrap">
      <section class="card">
        <h1>${title}</h1>
        <p class="sub">Track games, win/loss record, and points differential.</p>
        <form id="gameForm">
          <input class="span-2" id="opponent" placeholder="Opponent" required />
          <input type="date" class="span-2" id="date" required />
          <input id="ourScore" type="number" placeholder="Our score" required />
          <input id="theirScore" type="number" placeholder="Their score" required />
          <button class="span-2" type="submit">Add game</button>
        </form>
        <div class="stats">
          <div class="stat">Record <strong id="record">0-0</strong></div>
          <div class="stat">Points For <strong id="pf">0</strong></div>
          <div class="stat">Points Against <strong id="pa">0</strong></div>
          <div class="stat">Diff <strong id="diff">0</strong></div>
        </div>
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Opponent</th>
              <th>Score</th>
              <th>Result</th>
              <th></th>
            </tr>
          </thead>
          <tbody id="rows"></tbody>
        </table>
      </section>
    </main>
    <script>
      const key = 'score-tracker-games';
      const rows = document.getElementById('rows');
      const form = document.getElementById('gameForm');
      const fields = {
        opponent: document.getElementById('opponent'),
        date: document.getElementById('date'),
        ourScore: document.getElementById('ourScore'),
        theirScore: document.getElementById('theirScore')
      };

      function loadGames() {
        return JSON.parse(localStorage.getItem(key) || '[]');
      }

      function saveGames(games) {
        localStorage.setItem(key, JSON.stringify(games));
      }

      function removeGame(index) {
        const games = loadGames();
        games.splice(index, 1);
        saveGames(games);
        render();
      }

      function render() {
        const games = loadGames();
        let wins = 0;
        let losses = 0;
        let pf = 0;
        let pa = 0;

        rows.innerHTML = '';

        games.forEach((game, index) => {
          pf += game.ourScore;
          pa += game.theirScore;
          const win = game.ourScore > game.theirScore;
          if (win) wins += 1; else losses += 1;

          const tr = document.createElement('tr');
          tr.innerHTML =
            '<td>' + game.date + '</td>' +
            '<td>' + game.opponent + '</td>' +
            '<td>' + game.ourScore + ' - ' + game.theirScore + '</td>' +
            '<td class="' + (win ? 'win' : 'loss') + '">' + (win ? 'W' : 'L') + '</td>' +
            '<td><button data-index="' + index + '" style="padding:6px 10px">Delete</button></td>';
          rows.appendChild(tr);
        });

        document.getElementById('record').textContent = String(wins) + '-' + String(losses);
        document.getElementById('pf').textContent = String(pf);
        document.getElementById('pa').textContent = String(pa);
        document.getElementById('diff').textContent = String(pf - pa);
      }

      form.addEventListener('submit', (event) => {
        event.preventDefault();
        const games = loadGames();
        games.push({
          opponent: fields.opponent.value.trim(),
          date: fields.date.value,
          ourScore: Number(fields.ourScore.value),
          theirScore: Number(fields.theirScore.value)
        });
        saveGames(games);
        form.reset();
        render();
      });

      rows.addEventListener('click', (event) => {
        const index = event.target.dataset.index;
        if (index === undefined) return;
        removeGame(Number(index));
      });

      render();
    </script>
  </body>
</html>`;
}

function buildFallbackProjectSpec(promptText) {
  const title = promptText.toLowerCase().includes('basketball')
    ? 'Basketball League Score Tracker'
    : 'League Score Tracker';

  return {
    projectTitle: title,
    projectSlugHint: 'score-tracker',
    summary: 'Generated fallback static score tracker from local template.',
    runtime: {
      profile: 'static'
    },
    files: [
      {
        path: 'index.html',
        content: scoreTrackerTemplate(title)
      },
      {
        path: 'README.md',
        content: [
          `# ${title}`,
          '',
          'Generated by agent-tester fallback runtime.',
          '',
          '## Notes',
          '- Static app using localStorage for persistence.',
          '- Served by an ephemeral sister container through Caddy proxy.'
        ].join('\n')
      }
    ]
  };
}

function buildFallbackNodeProjectSpec(promptText) {
  const title = promptText.toLowerCase().includes('basketball')
    ? 'Basketball League Score Tracker'
    : 'League Score Tracker';

  const indexHtml = [
    '<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `    <title>${title}</title>`,
    '    <style>',
    '      :root {',
    '        --bg: #f4f6fb;',
    '        --card: #ffffff;',
    '        --ink: #182035;',
    '        --muted: #6c7385;',
    '        --line: #dde2ef;',
    '        --brand: #1355ff;',
    '        --brand-soft: #e7eeff;',
    '        --good: #0f8f45;',
    '        --bad: #b23737;',
    '      }',
    '      * { box-sizing: border-box; }',
    '      body { margin: 0; font-family: "IBM Plex Sans", "Segoe UI", sans-serif; color: var(--ink);',
    '        background: radial-gradient(circle at 20% 0%, #dde7ff 0%, transparent 35%),',
    '          radial-gradient(circle at 90% 10%, #d6fff2 0%, transparent 25%), var(--bg); min-height: 100vh; }',
    '      .wrap { max-width: 920px; margin: 40px auto; padding: 0 16px; }',
    '      .card { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 18px; box-shadow: 0 8px 28px rgba(15, 29, 75, 0.06); }',
    '      h1 { margin: 0 0 14px; font-size: 1.9rem; }',
    '      p.sub { color: var(--muted); margin-top: 0; }',
    '      form { display: grid; grid-template-columns: repeat(6, minmax(0, 1fr)); gap: 10px; margin-bottom: 16px; }',
    '      input, button { width: 100%; border: 1px solid var(--line); border-radius: 10px; padding: 10px 12px; font: inherit; }',
    '      button { background: var(--brand); color: white; border: none; cursor: pointer; }',
    '      button:hover { filter: brightness(1.05); }',
    '      .span-2 { grid-column: span 2; }',
    '      .stats { display: flex; gap: 12px; margin: 14px 0 18px; }',
    '      .stat { flex: 1; background: var(--brand-soft); border-radius: 12px; padding: 12px; }',
    '      .stat strong { display: block; font-size: 1.4rem; margin-top: 4px; }',
    '      table { width: 100%; border-collapse: collapse; }',
    '      th, td { padding: 10px; border-bottom: 1px solid var(--line); text-align: left; }',
    '      .win { color: var(--good); }',
    '      .loss { color: var(--bad); }',
    '      @media (max-width: 760px) {',
    '        form { grid-template-columns: 1fr 1fr; }',
    '        .span-2 { grid-column: span 2; }',
    '        .stats { flex-direction: column; }',
    '      }',
    '    </style>',
    '  </head>',
    '  <body>',
    '    <main class="wrap">',
    '      <section class="card">',
    `        <h1>${title}</h1>`,
    '        <p class="sub">Server-backed persistence with SQLite. Works across browsers/devices.</p>',
    '        <form id="gameForm">',
    '          <input class="span-2" id="opponent" placeholder="Opponent" required />',
    '          <input type="date" class="span-2" id="date" required />',
    '          <input id="ourScore" type="number" placeholder="Our score" required />',
    '          <input id="theirScore" type="number" placeholder="Their score" required />',
    '          <button class="span-2" type="submit">Add game</button>',
    '        </form>',
    '        <div class="stats">',
    '          <div class="stat">Record <strong id="record">0-0</strong></div>',
    '          <div class="stat">Points For <strong id="pf">0</strong></div>',
    '          <div class="stat">Points Against <strong id="pa">0</strong></div>',
    '          <div class="stat">Diff <strong id="diff">0</strong></div>',
    '        </div>',
    '        <table>',
    '          <thead>',
    '            <tr>',
    '              <th>Date</th>',
    '              <th>Opponent</th>',
    '              <th>Score</th>',
    '              <th>Result</th>',
    '              <th></th>',
    '            </tr>',
    '          </thead>',
    '          <tbody id="rows"></tbody>',
    '        </table>',
    '      </section>',
    '    </main>',
    '    <script>',
    '      const rows = document.getElementById("rows");',
    '      const form = document.getElementById("gameForm");',
    '      const fields = {',
    '        opponent: document.getElementById("opponent"),',
    '        date: document.getElementById("date"),',
    '        ourScore: document.getElementById("ourScore"),',
    '        theirScore: document.getElementById("theirScore")',
    '      };',
    '',
    '      async function api(path, options) {',
    '        const response = await fetch(path, {',
    '          headers: { "content-type": "application/json" },',
    '          ...options',
    '        });',
    '        if (!response.ok) {',
    '          const text = await response.text();',
    '          throw new Error(text || `Request failed: ${response.status}`);',
    '        }',
    '        return response.json();',
    '      }',
    '',
    '      function render(games) {',
    '        let wins = 0; let losses = 0; let pf = 0; let pa = 0;',
    '        rows.innerHTML = "";',
    '        games.forEach((game) => {',
    '          pf += game.ourScore; pa += game.theirScore;',
    '          const win = game.ourScore > game.theirScore;',
    '          if (win) wins += 1; else losses += 1;',
    '          const tr = document.createElement("tr");',
    '          tr.innerHTML =',
    '            `<td>${game.gameDate}</td>` +',
    '            `<td>${game.opponent}</td>` +',
    '            `<td>${game.ourScore} - ${game.theirScore}</td>` +',
    '            `<td class="${win ? "win" : "loss"}">${win ? "W" : "L"}</td>` +',
    '            `<td><button data-id="${game.id}" style="padding:6px 10px">Delete</button></td>`;',
    '          rows.appendChild(tr);',
    '        });',
    '        document.getElementById("record").textContent = `${wins}-${losses}`;',
    '        document.getElementById("pf").textContent = String(pf);',
    '        document.getElementById("pa").textContent = String(pa);',
    '        document.getElementById("diff").textContent = String(pf - pa);',
    '      }',
    '',
    '      async function refresh() {',
    '        const data = await api("/api/games");',
    '        render(data.games);',
    '      }',
    '',
    '      form.addEventListener("submit", async (event) => {',
    '        event.preventDefault();',
    '        await api("/api/games", {',
    '          method: "POST",',
    '          body: JSON.stringify({',
    '            opponent: fields.opponent.value.trim(),',
    '            gameDate: fields.date.value,',
    '            ourScore: Number(fields.ourScore.value),',
    '            theirScore: Number(fields.theirScore.value)',
    '          })',
    '        });',
    '        form.reset();',
    '        await refresh();',
    '      });',
    '',
    '      rows.addEventListener("click", async (event) => {',
    '        const id = event.target.dataset.id;',
    '        if (!id) return;',
    '        await api(`/api/games/${id}`, { method: "DELETE" });',
    '        await refresh();',
    '      });',
    '',
    '      refresh().catch((error) => {',
    '        console.error(error);',
    '        alert("Failed to load score data. Check server logs.");',
    '      });',
    '    </script>',
    '  </body>',
    '</html>'
  ].join('\n');

  const serverJs = [
    "const http = require('http');",
    "const fs = require('fs/promises');",
    "const path = require('path');",
    "const initSqlJs = require('sql.js');",
    '',
    'const port = Number(process.env.PORT || 3000);',
    "const dataDir = process.env.DATA_DIR || path.join(__dirname, '.runtime-data');",
    "const dbPath = path.join(dataDir, 'score-tracker.sqlite');",
    '',
    'let db;',
    '',
    'async function initializeDatabase() {',
    '  const SQL = await initSqlJs();',
    '  await fs.mkdir(dataDir, { recursive: true });',
    '  try {',
    '    const existing = await fs.readFile(dbPath);',
    '    db = new SQL.Database(new Uint8Array(existing));',
    '  } catch (_error) {',
    '    db = new SQL.Database();',
    '  }',
    '',
    '  db.run(`',
    '    CREATE TABLE IF NOT EXISTS games (',
    '      id INTEGER PRIMARY KEY AUTOINCREMENT,',
    '      opponent TEXT NOT NULL,',
    '      game_date TEXT NOT NULL,',
    '      our_score INTEGER NOT NULL,',
    '      their_score INTEGER NOT NULL,',
    '      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP',
    '    )',
    '  `);',
    '',
    '  await persistDatabase();',
    '}',
    '',
    'async function persistDatabase() {',
    '  const data = db.export();',
    '  await fs.writeFile(dbPath, Buffer.from(data));',
    '}',
    '',
    'function listGames() {',
    '  const result = db.exec(`',
    '    SELECT id, opponent, game_date, our_score, their_score',
    '    FROM games',
    '    ORDER BY datetime(created_at) DESC, id DESC',
    '  `);',
    '',
    '  if (!result.length) return [];',
    '  const { columns, values } = result[0];',
    '',
    '  return values.map((row) => {',
    '    const game = {};',
    '    columns.forEach((column, index) => {',
    '      game[column] = row[index];',
    '    });',
    '    return {',
    '      id: Number(game.id),',
    '      opponent: String(game.opponent),',
    '      gameDate: String(game.game_date),',
    '      ourScore: Number(game.our_score),',
    '      theirScore: Number(game.their_score)',
    '    };',
    '  });',
    '}',
    '',
    'function sendJson(res, statusCode, body) {',
    "  res.writeHead(statusCode, { 'content-type': 'application/json; charset=utf-8' });",
    '  res.end(JSON.stringify(body));',
    '}',
    '',
    'function sendHtml(res, html) {',
    "  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });",
    '  res.end(html);',
    '}',
    '',
    'async function readJsonBody(req) {',
    "  const decoder = new TextDecoder('utf8');",
    "  let raw = '';",
    '  for await (const chunk of req) {',
    '    raw += decoder.decode(chunk, { stream: true });',
    "    if (raw.length > 1_000_000) throw new Error('Request body too large');",
    '  }',
    '  raw += decoder.decode();',
    '  return raw ? JSON.parse(raw) : {};',
    '}',
    '',
    'async function handleRequest(req, res) {',
    "  if (req.method === 'GET' && req.url === '/') {",
    `    sendHtml(res, ${JSON.stringify(indexHtml)});`,
    '    return;',
    '  }',
    '',
    "  if (req.method === 'GET' && req.url === '/health') {",
    '    sendJson(res, 200, { ok: true, runtime: "node", storage: "sqlite", dbPath });',
    '    return;',
    '  }',
    '',
    "  if (req.method === 'GET' && req.url === '/api/games') {",
    '    sendJson(res, 200, { games: listGames() });',
    '    return;',
    '  }',
    '',
    "  if (req.method === 'POST' && req.url === '/api/games') {",
    '    try {',
    '      const body = await readJsonBody(req);',
    '      const opponent = String(body.opponent || "").trim();',
    '      const gameDate = String(body.gameDate || "").trim();',
    '      const ourScore = Number(body.ourScore);',
    '      const theirScore = Number(body.theirScore);',
    '',
    '      if (!opponent || !gameDate || !Number.isFinite(ourScore) || !Number.isFinite(theirScore)) {',
    '        sendJson(res, 400, { error: "Invalid game payload" });',
    '        return;',
    '      }',
    '',
    '      const insert = db.prepare(`',
    '        INSERT INTO games (opponent, game_date, our_score, their_score)',
    '        VALUES (?, ?, ?, ?)',
    '      `);',
    '      insert.run([opponent, gameDate, Math.trunc(ourScore), Math.trunc(theirScore)]);',
    '      insert.free();',
    '      await persistDatabase();',
    '      sendJson(res, 201, { ok: true });',
    '      return;',
    '    } catch (error) {',
    '      sendJson(res, 400, { error: error.message });',
    '      return;',
    '    }',
    '  }',
    '',
    "  if (req.method === 'DELETE' && req.url && req.url.startsWith('/api/games/')) {",
    "    const idRaw = req.url.slice('/api/games/'.length);",
    '    const id = Number(idRaw);',
    '    if (!Number.isInteger(id) || id <= 0) {',
    '      sendJson(res, 400, { error: "Invalid game id" });',
    '      return;',
    '    }',
    '',
    '    const del = db.prepare(`DELETE FROM games WHERE id = ?`);',
    '    del.run([id]);',
    '    del.free();',
    '    await persistDatabase();',
    '    sendJson(res, 200, { ok: true });',
    '    return;',
    '  }',
    '',
    '  sendJson(res, 404, { error: "Not found" });',
    '}',
    '',
    'async function start() {',
    '  await initializeDatabase();',
    '  const server = http.createServer((req, res) => {',
    '    handleRequest(req, res).catch((error) => {',
    '      console.error(error);',
    '      sendJson(res, 500, { error: "Internal server error" });',
    '    });',
    '  });',
    '',
    '  server.listen(port, () => {',
    '    console.log(`[node-site] listening on ${port}`);',
    '    console.log(`[node-site] sqlite database path=${dbPath}`);',
    '  });',
    '}',
    '',
    'start().catch((error) => {',
    '  console.error(error);',
    '  process.exit(1);',
    '});',
    ''
  ].join('\n');

  return {
    projectTitle: title,
    projectSlugHint: 'score-tracker-node',
    summary: 'Generated deterministic Node runtime score tracker with SQLite persistence.',
    runtime: {
      profile: 'node',
      internalPort: 3000,
      startScript: 'start'
    },
    files: [
      {
        path: 'package.json',
        content: JSON.stringify(
          {
            name: 'score-tracker-node-sqlite',
            version: '0.1.0',
            private: true,
            type: 'commonjs',
            scripts: {
              start: 'node server.js'
            },
            dependencies: {
              'sql.js': '^1.13.0'
            }
          },
          null,
          2
        )
      },
      {
        path: 'server.js',
        content: serverJs
      },
      {
        path: 'README.md',
        content: [
          `# ${title}`,
          '',
          'Generated by agent-tester deterministic node fallback runtime with SQLite persistence.',
          '',
          '## Runtime',
          '- Node.js service',
          '- SQLite database persisted on disk',
          '',
          '## Endpoints',
          '- `GET /` UI',
          '- `GET /health` health status',
          '- `GET /api/games` list games',
          '- `POST /api/games` create game',
          '- `DELETE /api/games/:id` delete game',
          '',
          '## Persistence',
          '- DB file: `$DATA_DIR/score-tracker.sqlite`',
          '- In sister container runtime this maps to `/runtime-data/score-tracker.sqlite`'
        ].join('\n')
      }
    ]
  };
}

module.exports = {
  buildFallbackProjectSpec,
  buildFallbackNodeProjectSpec
};
