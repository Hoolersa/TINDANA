'use strict';

const crypto = require('crypto');

const MAX_NICKNAME_LENGTH = 24;

/**
 * Issues and verifies guest sessions using an HMAC-signed token, so the
 * server doesn't need a database to trust "this browser is session X"
 * across requests/reconnects. The cookie itself carries the session id;
 * the signature prevents a client from forging or altering it.
 *
 * Cookie value format: `${sessionId}.${nickname_base64url}.${signatureHex}`
 */
class SessionStore {
  constructor(secret) {
    if (!secret || typeof secret !== 'string' || secret.length < 16) {
      throw new Error('SessionStore requires a strong secret (>=16 chars), e.g. from env var SESSION_SECRET');
    }
    this.secret = secret;
  }

  _sign(sessionId, nicknameB64) {
    return crypto
      .createHmac('sha256', this.secret)
      .update(`${sessionId}.${nicknameB64}`)
      .digest('hex');
  }

  /**
   * Create a brand-new guest session for a nickname.
   * @returns {{ sessionId: string, token: string, nickname: string }}
   */
  createGuestSession(rawNickname) {
    const nickname = sanitizeNickname(rawNickname);
    const sessionId = crypto.randomUUID();
    const nicknameB64 = Buffer.from(nickname, 'utf8').toString('base64url');
    const signature = this._sign(sessionId, nicknameB64);
    const token = `${sessionId}.${nicknameB64}.${signature}`;
    return { sessionId, token, nickname };
  }

  /**
   * Verify a token from an incoming cookie.
   * @returns {{ sessionId: string, nickname: string } | null} null if invalid/tampered
   */
  verifyToken(token) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const [sessionId, nicknameB64, signature] = parts;
    if (!isUuid(sessionId)) return null;

    const expected = this._sign(sessionId, nicknameB64);
    const sigBuf = Buffer.from(signature, 'hex');
    const expectedBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expectedBuf.length) return null;
    if (!crypto.timingSafeEqual(sigBuf, expectedBuf)) return null;

    let nickname;
    try {
      nickname = Buffer.from(nicknameB64, 'base64url').toString('utf8');
    } catch {
      return null;
    }
    return { sessionId, nickname };
  }
}

function isUuid(str) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(str);
}

/** Trim, cap length, strip control characters. Keeps Bengali/Unicode intact. */
function sanitizeNickname(raw) {
  const str = (typeof raw === 'string' ? raw : '').trim();
  // eslint-disable-next-line no-control-regex
  const stripped = str.replace(/[\u0000-\u001F\u007F]/g, '');
  const truncated = Array.from(stripped).slice(0, MAX_NICKNAME_LENGTH).join('');
  return truncated.length > 0 ? truncated : 'Guest';
}

module.exports = { SessionStore, sanitizeNickname, MAX_NICKNAME_LENGTH };
