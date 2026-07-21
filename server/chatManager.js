'use strict';

const crypto = require('crypto');

class ChatError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

class ChatManager {
  constructor({ now = () => Date.now(), maxLength = 300, rateLimitWindowMs = 20000, maxMessagesPerWindow = 5, historyLimit = 100 } = {}) {
    this.now = now;
    this.maxLength = maxLength;
    this.rateLimitWindowMs = rateLimitWindowMs;
    this.maxMessagesPerWindow = maxMessagesPerWindow;
    this.historyLimit = historyLimit;
    this.history = [];
    this.rateWindows = new Map();
    this.reports = new Map();
  }

  addMessage(sessionId, nickname, text) {
    const cleanText = typeof text === 'string' ? text.trim() : '';
    if (!cleanText) {
      throw new ChatError('chat_empty', 'Message cannot be empty');
    }
    if (cleanText.length > this.maxLength) {
      throw new ChatError('chat_too_long', `Chat messages are limited to ${this.maxLength} characters.`);
    }

    const now = this.now();
    const window = this._getWindow(sessionId, now);
    if (window.length >= this.maxMessagesPerWindow) {
      throw new ChatError('chat_rate_limited', 'You are sending messages too quickly. Please wait a moment.');
    }

    const message = {
      messageId: this._nextId(),
      nickname: String(nickname || 'Guest'),
      text: cleanText,
      timestamp: now,
    };

    window.push(now);
    this.rateWindows.set(sessionId, window);
    this.history.push(message);
    if (this.history.length > this.historyLimit) this.history.shift();
    return message;
  }

  reportMessage(messageId) {
    if (!this.history.some((message) => message.messageId === messageId)) {
      throw new ChatError('chat_report_invalid', 'Reported message not found');
    }
    const count = (this.reports.get(messageId) || 0) + 1;
    this.reports.set(messageId, count);
    return { messageId, reports: count };
  }

  getHistory() {
    return this.history.slice();
  }

  _getWindow(sessionId, now) {
    const seen = this.rateWindows.get(sessionId) || [];
    const cutoff = now - this.rateLimitWindowMs;
    const pruned = seen.filter((ts) => ts > cutoff);
    return pruned;
  }

  _nextId() {
    return crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
  }
}

module.exports = { ChatManager, ChatError };
