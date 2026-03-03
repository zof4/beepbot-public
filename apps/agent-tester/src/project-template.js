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
    ? 'Basketball League Score Tracker (Node Runtime)'
    : 'League Score Tracker (Node Runtime)';

  const serverJs = [
    "const http = require('http');",
    '',
    "const port = Number(process.env.PORT || 3000);",
    "const title = 'Basketball Score Tracker API';",
    '',
    'const html = `<!doctype html>',
    '<html lang="en">',
    '  <head>',
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    '    <title>${title}</title>',
    '    <style>',
    '      body { font-family: system-ui, sans-serif; margin: 2rem; color: #1b1f2a; }',
    '      code { background: #eef2ff; padding: 0.2rem 0.4rem; border-radius: 6px; }',
    '      h1 { margin-bottom: 0.4rem; }',
    '      p { max-width: 680px; }',
    '    </style>',
    '  </head>',
    '  <body>',
    '    <h1>${title}</h1>',
    '    <p>This demo is served by the <code>node</code> sister-container runtime profile.</p>',
    '    <p>Health endpoint: <code>/health</code></p>',
    '    <p>JSON info endpoint: <code>/api/info</code></p>',
    '  </body>',
    '</html>`;',
    '',
    'const server = http.createServer((req, res) => {',
    "  if (req.url === '/health') {",
    "    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });",
    "    res.end(JSON.stringify({ ok: true, runtime: 'node' }));",
    '    return;',
    '  }',
    '',
    "  if (req.url === '/api/info') {",
    "    res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });",
    '    res.end(JSON.stringify({',
    '      service: title,',
    "      runtime: 'node',",
    '      port',
    '    }));',
    '    return;',
    '  }',
    '',
    "  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });",
    '  res.end(html);',
    '});',
    '',
    'server.listen(port, () => {',
    "  console.log(`[node-site] listening on ${port}`);",
    '});',
    ''
  ].join('\n');

  return {
    projectTitle: title,
    projectSlugHint: 'score-tracker-node',
    summary: 'Generated deterministic fallback Node runtime demo app.',
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
            name: 'score-tracker-node-demo',
            version: '0.1.0',
            private: true,
            type: 'commonjs',
            scripts: {
              start: 'node server.js'
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
          'Generated by agent-tester deterministic node fallback runtime.',
          '',
          '## Run',
          '1. npm install',
          '2. npm run start',
          '',
          '## Endpoints',
          '- `/health`',
          '- `/api/info`'
        ].join('\n')
      }
    ]
  };
}

module.exports = {
  buildFallbackProjectSpec,
  buildFallbackNodeProjectSpec
};
