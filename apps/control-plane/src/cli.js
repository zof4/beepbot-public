const baseUrl = process.env.CONTROL_PLANE_HTTP_URL || 'http://localhost:3001';
const defaultUser = process.env.CLI_USER_ID || process.env.DEFAULT_USER_ID || 'tester';
const userToken = process.env.CLI_USER_TOKEN || 'tester-app-token';

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
      'x-user-token': userToken,
      ...(options.headers || {})
    }
  });

  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${response.status}: ${JSON.stringify(body)}`);
  }

  return body;
}

function usage() {
  console.log('Usage:');
  console.log('  npm run cli -- status [userId]');
  console.log('  npm run cli -- sites [userId]');
  console.log('  npm run cli -- clear-sites [userId] [siteId]');
  console.log('  npm run cli -- oauth-status [userId]');
  console.log('  npm run cli -- oauth-start [userId]');
  console.log('  npm run cli -- oauth-disconnect [userId]');
  console.log('  npm run cli -- send [--user <userId>] "Build me a basketball score tracker website"');
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command) {
    usage();
    process.exitCode = 1;
    return;
  }

  if (command === 'status') {
    const userId = args[0] || defaultUser;
    const status = await request(`/api/status?userId=${encodeURIComponent(userId)}`);
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  if (command === 'sites') {
    const userId = args[0] || defaultUser;
    const status = await request(`/api/status?userId=${encodeURIComponent(userId)}`);
    console.log(JSON.stringify(status.activeSites, null, 2));
    return;
  }

  if (command === 'clear-sites') {
    const userId = args[0] || defaultUser;
    const siteId = args[1];
    const query = new URLSearchParams({ userId });
    if (siteId) {
      query.set('siteId', siteId);
    }
    const response = await request(`/api/sites?${query.toString()}`, {
      method: 'DELETE'
    });
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (command === 'oauth-status') {
    const userId = args[0] || defaultUser;
    const status = await request(`/api/auth/openai/status?userId=${encodeURIComponent(userId)}`);
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  if (command === 'oauth-start') {
    const userId = args[0] || defaultUser;
    const response = await request(`/api/auth/openai/start?userId=${encodeURIComponent(userId)}`);
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (command === 'oauth-disconnect') {
    const userId = args[0] || defaultUser;
    const response = await request(`/api/auth/openai/connection?userId=${encodeURIComponent(userId)}`, {
      method: 'DELETE'
    });
    console.log(JSON.stringify(response, null, 2));
    return;
  }

  if (command === 'send') {
    if (!args.length) {
      throw new Error('Message is required for send command');
    }

    let userId = defaultUser;
    let messageParts = args.slice();

    if (messageParts[0] === '--user') {
      userId = messageParts[1];
      messageParts = messageParts.slice(2);
    } else if (messageParts[0] && messageParts[0].startsWith('--user=')) {
      userId = messageParts[0].slice('--user='.length);
      messageParts = messageParts.slice(1);
    }

    if (!userId || !/^[a-zA-Z0-9_-]+$/.test(userId)) {
      throw new Error('A valid userId is required when using --user');
    }

    const message = messageParts.join(' ').trim();
    if (!message) {
      throw new Error('Message is required for send command');
    }

    const response = await request('/api/messages', {
      method: 'POST',
      body: JSON.stringify({
        userId,
        message
      })
    });

    console.log(JSON.stringify(response, null, 2));
    return;
  }

  usage();
  process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
