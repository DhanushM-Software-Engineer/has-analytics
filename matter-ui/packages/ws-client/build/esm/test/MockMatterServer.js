/**
 * @license
 * Copyright 2025-2026 Open Home Foundation
 * SPDX-License-Identifier: Apache-2.0
 */
import { WebSocket, WebSocketServer } from "ws";
import { parseBigIntAwareJson, toBigIntAwareJson } from "../src/json-utils.js";
class MockMatterServer {
  server = null;
  clients = /* @__PURE__ */ new Set();
  receivedCommands = [];
  commandHandlers = /* @__PURE__ */ new Map();
  port;
  serverInfo;
  constructor(options = {}) {
    this.port = options.port ?? 0;
    this.serverInfo = {
      fabric_id: options.serverInfo?.fabric_id ?? BigInt("1234567890123456789"),
      compressed_fabric_id: options.serverInfo?.compressed_fabric_id ?? BigInt("18258567453835851999"),
      fabric_index: options.serverInfo?.fabric_index ?? 1,
      schema_version: options.serverInfo?.schema_version ?? 11,
      min_supported_schema_version: options.serverInfo?.min_supported_schema_version ?? 9,
      sdk_version: options.serverInfo?.sdk_version ?? "2025.1.0",
      wifi_credentials_set: options.serverInfo?.wifi_credentials_set ?? false,
      thread_credentials_set: options.serverInfo?.thread_credentials_set ?? false,
      bluetooth_enabled: options.serverInfo?.bluetooth_enabled ?? false
    };
  }
  get url() {
    if (!this.server) {
      throw new Error("Server not started");
    }
    const address = this.server.address();
    if (typeof address === "string" || address === null) {
      throw new Error("Invalid server address");
    }
    return `ws://127.0.0.1:${address.port}/ws`;
  }
  get actualPort() {
    if (!this.server) {
      throw new Error("Server not started");
    }
    const address = this.server.address();
    if (typeof address === "string" || address === null) {
      throw new Error("Invalid server address");
    }
    return address.port;
  }
  /**
   * Start the mock server.
   */
  async start() {
    return new Promise((resolve, reject) => {
      this.server = new WebSocketServer({ port: this.port });
      this.server.on("listening", () => {
        resolve();
      });
      this.server.on("error", (error) => {
        reject(error);
      });
      this.server.on("connection", (socket) => {
        this.clients.add(socket);
        socket.send(toBigIntAwareJson(this.serverInfo));
        socket.on("message", (data) => {
          const rawMessage = data.toString();
          try {
            const message = parseBigIntAwareJson(rawMessage);
            this.receivedCommands.push({ message, raw: rawMessage });
            this.handleCommand(socket, message);
          } catch (error) {
            console.error("Failed to parse message:", error);
          }
        });
        socket.on("close", () => {
          this.clients.delete(socket);
        });
      });
    });
  }
  /**
   * Stop the mock server.
   */
  async stop() {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }
      for (const client of this.clients) {
        client.close();
      }
      this.clients.clear();
      this.server.close((error) => {
        if (error) {
          reject(error);
        } else {
          this.server = null;
          resolve();
        }
      });
    });
  }
  /**
   * Register a handler for a specific command.
   * Handler can be sync or async. If async, the response is sent after the promise resolves.
   */
  onCommand(command, handler) {
    this.commandHandlers.set(command, handler);
  }
  /**
   * Get all received commands.
   */
  getReceivedCommands() {
    return [...this.receivedCommands];
  }
  /**
   * Clear received commands.
   */
  clearReceivedCommands() {
    this.receivedCommands = [];
  }
  /**
   * Send an event to all connected clients.
   */
  sendEvent(event, data) {
    const message = toBigIntAwareJson({ event, data });
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }
  /**
   * Send a raw string message to all clients (for testing malformed messages).
   */
  sendRaw(message) {
    for (const client of this.clients) {
      if (client.readyState === WebSocket.OPEN) {
        client.send(message);
      }
    }
  }
  handleCommand(socket, message) {
    const handler = this.commandHandlers.get(message.command);
    if (handler) {
      try {
        const result = handler(message.args);
        if (result instanceof Promise) {
          result.then((asyncResult) => {
            socket.send(
              toBigIntAwareJson({
                message_id: message.message_id,
                result: asyncResult
              })
            );
          }).catch((error) => {
            socket.send(
              toBigIntAwareJson({
                message_id: message.message_id,
                error_code: 1,
                details: error instanceof Error ? error.message : String(error)
              })
            );
          });
        } else {
          socket.send(
            toBigIntAwareJson({
              message_id: message.message_id,
              result
            })
          );
        }
      } catch (error) {
        socket.send(
          toBigIntAwareJson({
            message_id: message.message_id,
            error_code: 1,
            details: error instanceof Error ? error.message : String(error)
          })
        );
      }
    } else {
      socket.send(
        toBigIntAwareJson({
          message_id: message.message_id,
          result: null
        })
      );
    }
  }
}
export {
  MockMatterServer
};
//# sourceMappingURL=MockMatterServer.js.map
