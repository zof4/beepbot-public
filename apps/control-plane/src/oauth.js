const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');

function base64UrlEncode(buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function buildCodeChallenge(codeVerifier) {
  return base64UrlEncode(crypto.createHash('sha256').update(codeVerifier).digest());
}

function splitScopes(rawScopes) {
  return String(rawScopes || '')
    .split(/[,\s]+/)
    .map((scope) => scope.trim())
    .filter(Boolean);
}

function isOauthConfigured(oauthConfig) {
  return Boolean(
    oauthConfig &&
      oauthConfig.authorizationUrl &&
      oauthConfig.tokenUrl &&
      oauthConfig.clientId &&
      oauthConfig.redirectUri
  );
}

function createOauthManager({ oauthConfig, getUserOauthDir }) {
  const pendingStates = new Map();
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [state, entry] of pendingStates.entries()) {
      if (entry.expiresAt <= now) {
        pendingStates.delete(state);
      }
    }
  }, 30000);
  cleanupInterval.unref();

  function assertConfigured() {
    if (!isOauthConfigured(oauthConfig)) {
      throw new Error(
        'OpenAI OAuth is not configured. Set OPENAI_OAUTH_AUTHORIZATION_URL, OPENAI_OAUTH_TOKEN_URL, OPENAI_OAUTH_CLIENT_ID, and OPENAI_OAUTH_REDIRECT_URI.'
      );
    }
  }

  function getCredentialFile(userId) {
    return path.join(getUserOauthDir(userId), 'openai-credential.json');
  }

  async function saveCredential(userId, tokenPayload) {
    const obtainedAt = Date.now();
    const expiresAt = Number.isFinite(tokenPayload.expires_in)
      ? obtainedAt + Number(tokenPayload.expires_in) * 1000
      : null;

    const data = {
      provider: 'openai',
      tokenType: tokenPayload.token_type || 'bearer',
      accessToken: tokenPayload.access_token || '',
      refreshToken: tokenPayload.refresh_token || null,
      scope: tokenPayload.scope || null,
      obtainedAt,
      expiresAt
    };

    if (!data.accessToken) {
      throw new Error('OAuth token exchange did not return access_token');
    }

    const credentialFile = getCredentialFile(userId);
    await fs.mkdir(path.dirname(credentialFile), { recursive: true });
    await fs.writeFile(credentialFile, JSON.stringify(data, null, 2), { encoding: 'utf8', mode: 0o600 });

    return data;
  }

  async function readCredential(userId) {
    const credentialFile = getCredentialFile(userId);
    try {
      const raw = await fs.readFile(credentialFile, 'utf8');
      return JSON.parse(raw);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  async function clearCredential(userId) {
    const credentialFile = getCredentialFile(userId);
    try {
      await fs.unlink(credentialFile);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }
  }

  function isCredentialUsable(credential) {
    if (!credential || typeof credential.accessToken !== 'string' || credential.accessToken.length < 10) {
      return false;
    }

    if (!credential.expiresAt) {
      return true;
    }

    return Date.now() + 30000 < Number(credential.expiresAt);
  }

  async function getCredentialStatus(userId) {
    const credential = await readCredential(userId);
    return {
      configured: isOauthConfigured(oauthConfig),
      connected: isCredentialUsable(credential),
      expiresAt: credential?.expiresAt || null,
      scope: credential?.scope || null,
      hasRefreshToken: Boolean(credential?.refreshToken)
    };
  }

  function createAuthorizationRequest(userId) {
    assertConfigured();

    const state = base64UrlEncode(crypto.randomBytes(24));
    const codeVerifier = base64UrlEncode(crypto.randomBytes(48));
    const codeChallenge = buildCodeChallenge(codeVerifier);
    const expiresAt = Date.now() + Math.max(30000, Number(oauthConfig.stateTtlMs || 600000));

    pendingStates.set(state, {
      userId,
      codeVerifier,
      expiresAt
    });

    const query = new URLSearchParams({
      response_type: 'code',
      client_id: oauthConfig.clientId,
      redirect_uri: oauthConfig.redirectUri,
      scope: splitScopes(oauthConfig.scopes).join(' '),
      state,
      code_challenge_method: 'S256',
      code_challenge: codeChallenge
    });

    return {
      provider: 'openai',
      authorizationUrl: `${oauthConfig.authorizationUrl}?${query.toString()}`,
      state,
      expiresAt
    };
  }

  async function exchangeCodeForToken(code, codeVerifier) {
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: oauthConfig.redirectUri,
      client_id: oauthConfig.clientId,
      code_verifier: codeVerifier
    });

    if (oauthConfig.clientSecret) {
      form.set('client_secret', oauthConfig.clientSecret);
    }

    const response = await fetch(oauthConfig.tokenUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        accept: 'application/json'
      },
      body: form.toString()
    });

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const reason = body.error_description || body.error || `HTTP ${response.status}`;
      throw new Error(`OAuth token exchange failed: ${reason}`);
    }

    return body;
  }

  async function completeAuthorization({ state, code }) {
    assertConfigured();

    const stateEntry = pendingStates.get(state);
    pendingStates.delete(state);

    if (!stateEntry) {
      throw new Error('OAuth state is invalid or expired');
    }

    if (stateEntry.expiresAt <= Date.now()) {
      throw new Error('OAuth state expired; please start the connection again');
    }

    const tokenPayload = await exchangeCodeForToken(code, stateEntry.codeVerifier);
    const credential = await saveCredential(stateEntry.userId, tokenPayload);

    return {
      userId: stateEntry.userId,
      credential
    };
  }

  async function getUsableAccessToken(userId) {
    const credential = await readCredential(userId);
    if (!isCredentialUsable(credential)) {
      return null;
    }

    return credential.accessToken;
  }

  return {
    isConfigured: () => isOauthConfigured(oauthConfig),
    createAuthorizationRequest,
    completeAuthorization,
    getCredentialStatus,
    clearCredential,
    getUsableAccessToken
  };
}

module.exports = {
  createOauthManager
};
