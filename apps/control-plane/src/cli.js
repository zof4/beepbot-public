const baseUrl = process.env.CONTROL_PLANE_HTTP_URL || 'http://localhost:3001';
const hardcodedUser = process.env.CLI_USER_ID || 'tester';

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      'content-type': 'application/json',
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
  console.log('  npm run cli -- status');
  console.log('  npm run cli -- sites');
  console.log('  npm run cli -- send "Build me a basketball score tracker website"');
}

async function main() {
  const [command, ...args] = process.argv.slice(2);

  if (!command) {
    usage();
    process.exitCode = 1;
    return;
  }

  if (command === 'status') {
    const status = await request('/api/status');
    console.log(JSON.stringify(status, null, 2));
    return;
  }

  if (command === 'sites') {
    const status = await request('/api/status');
    console.log(JSON.stringify(status.activeSites, null, 2));
    return;
  }

  if (command === 'send') {
    const message = args.join(' ').trim();
    if (!message) {
      throw new Error('Message is required for send command');
    }

    const response = await request('/api/messages', {
      method: 'POST',
      body: JSON.stringify({
        userId: hardcodedUser,
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
