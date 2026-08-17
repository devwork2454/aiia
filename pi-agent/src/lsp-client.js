import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';

export class LspClient extends EventEmitter {
  constructor(command, args, cwd) {
    super();
    this.process = spawn(command, args, { cwd });
    this.msgId = 1;
    this.callbacks = {};
    this.buffer = '';

    this.process.stdout.on('data', (chunk) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    this.process.stderr.on('data', (chunk) => {
      console.error(`[LSP] ${chunk}`);
    });
  }

  processBuffer() {
    while (true) {
      const match = this.buffer.match(/^Content-Length: (\d+)\r\n\r\n/);
      if (!match) break;
      const headerLength = match[0].length;
      const contentLength = parseInt(match[1], 10);
      if (this.buffer.length < headerLength + contentLength) break;

      const payload = this.buffer.slice(headerLength, headerLength + contentLength);
      this.buffer = this.buffer.slice(headerLength + contentLength);

      try {
        const msg = JSON.parse(payload);
        if (msg.id !== undefined && this.callbacks[msg.id]) {
          this.callbacks[msg.id](msg);
          delete this.callbacks[msg.id];
        }
      } catch (e) {
        console.warn('LSP Parse Error:', e.message);
      }
    }
  }

  send(method, params) {
    return new Promise((resolve, reject) => {
      const id = this.msgId++;
      this.callbacks[id] = (res) => {
        if (res.error) reject(res.error);
        else resolve(res.result);
      };

      const payload = JSON.stringify({
        jsonrpc: '2.0',
        id,
        method,
        params,
      });
      const msg = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
      this.process.stdin.write(msg);
    });
  }

  sendNotification(method, params) {
    const payload = JSON.stringify({
      jsonrpc: '2.0',
      method,
      params,
    });
    const msg = `Content-Length: ${Buffer.byteLength(payload, 'utf8')}\r\n\r\n${payload}`;
    this.process.stdin.write(msg);
  }

  async initialize(rootUri) {
    const result = await this.send('initialize', {
      processId: process.pid,
      rootUri,
      capabilities: {},
    });
    this.sendNotification('initialized', {});
    return result;
  }

  async openDocument(uri, languageId, text) {
    this.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId, version: 1, text },
    });
  }

  async gotoDefinition(uri, line, character) {
    return this.send('textDocument/definition', {
      textDocument: { uri },
      position: { line, character },
    });
  }

  async findReferences(uri, line, character) {
    return this.send('textDocument/references', {
      textDocument: { uri },
      position: { line, character },
      context: { includeDeclaration: true },
    });
  }

  close() {
    this.process.kill();
  }
}
