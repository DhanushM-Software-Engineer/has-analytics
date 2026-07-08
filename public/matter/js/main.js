/**
 * @license
 * Copyright 2025-2026 Open Home Foundation
 * SPDX-License-Identifier: Apache-2.0
 */
const BIGINT_MARKER = "__BIGINT__";
function toBigIntAwareJson(value, spaces) {
  const replacements = new Array();
  let result = JSON.stringify(value, (_key, val) => {
    if (typeof val === "bigint") {
      if (val > Number.MAX_SAFE_INTEGER) {
        replacements.push({
          from: `"0x${val.toString(16)}"`,
          to: val.toString()
        });
        return `0x${val.toString(16)}`;
      } else {
        return Number(val);
      }
    }
    return val;
  }, spaces);
  if (replacements.length > 0) {
    replacements.forEach(({
      from,
      to
    }) => {
      result = result.replaceAll(from, to);
    });
  }
  return result;
}
function parseBigIntAwareJson(json) {
  const result = [];
  let i = 0;
  let inString = false;
  while (i < json.length) {
    const char = json[i];
    if (inString) {
      if (char === "\\") {
        result.push(char);
        i++;
        if (i < json.length) {
          result.push(json[i]);
          i++;
        }
      } else if (char === '"') {
        result.push(char);
        inString = false;
        i++;
      } else {
        result.push(char);
        i++;
      }
    } else {
      if (char === '"') {
        result.push(char);
        inString = true;
        i++;
      } else if (char >= "0" && char <= "9") {
        const hasMinus = result.length > 0 && result[result.length - 1] === "-";
        if (hasMinus) {
          result.pop();
        }
        const start = i;
        while (i < json.length && json[i] >= "0" && json[i] <= "9") {
          i++;
        }
        let isFloat = false;
        if (i < json.length && json[i] === ".") {
          isFloat = true;
          i++;
          while (i < json.length && json[i] >= "0" && json[i] <= "9") {
            i++;
          }
        }
        if (i < json.length && (json[i] === "e" || json[i] === "E")) {
          isFloat = true;
          i++;
          if (i < json.length && (json[i] === "+" || json[i] === "-")) {
            i++;
          }
          while (i < json.length && json[i] >= "0" && json[i] <= "9") {
            i++;
          }
        }
        const numberStr = (hasMinus ? "-" : "") + json.slice(start, i);
        if (!isFloat && numberStr.length - (hasMinus ? 1 : 0) >= 15) {
          const num = BigInt(numberStr);
          if (num > Number.MAX_SAFE_INTEGER || num < Number.MIN_SAFE_INTEGER) {
            result.push(`"${BIGINT_MARKER}${numberStr}"`);
          } else {
            result.push(numberStr);
          }
        } else {
          result.push(numberStr);
        }
      } else {
        result.push(char);
        i++;
      }
    }
  }
  const processed = result.join("");
  return JSON.parse(processed, (_key, value) => {
    if (typeof value === "string" && value.startsWith(BIGINT_MARKER)) {
      return BigInt(value.slice(BIGINT_MARKER.length));
    }
    return value;
  });
}

/**
 * @license
 * Copyright 2025-2026 Open Home Foundation
 * SPDX-License-Identifier: Apache-2.0
 */
class Connection {
  /**
   * Create a new connection.
   * @param ws_server_url WebSocket server URL
   * @param wsFactory Optional factory function to create WebSocket instances.
   *                  If not provided, uses the global WebSocket constructor.
   */
  constructor(ws_server_url, wsFactory) {
    this.ws_server_url = ws_server_url;
    this.ws_server_url = ws_server_url;
    this.wsFactory = wsFactory ?? (url => new WebSocket(url));
  }
  ws_server_url;
  serverInfo = void 0;
  socket;
  wsFactory;
  get connected() {
    return this.socket?.readyState === 1;
  }
  async connect(onMessage, onConnectionLost) {
    if (this.socket) {
      throw new Error("Already connected");
    }
    console.debug("Trying to connect");
    return new Promise((resolve, reject) => {
      this.socket = this.wsFactory(this.ws_server_url);
      this.socket.onopen = () => {
        console.log("WebSocket Connected");
      };
      this.socket.onclose = () => {
        console.log("WebSocket Closed");
        this.socket = void 0;
        this.serverInfo = void 0;
        onConnectionLost();
      };
      this.socket.onerror = error => {
        console.error("WebSocket Error: ", error);
        reject(new Error("WebSocket Error"));
      };
      this.socket.onmessage = event => {
        const dataStr = typeof event.data === "string" ? event.data : String(event.data);
        const data = parseBigIntAwareJson(dataStr);
        console.debug("WebSocket OnMessage", data);
        if (!this.serverInfo) {
          this.serverInfo = data;
          resolve();
          return;
        }
        onMessage(data);
      };
    });
  }
  disconnect() {
    if (this.socket) {
      this.socket.close();
      this.socket = void 0;
    }
    this.serverInfo = void 0;
  }
  sendMessage(message) {
    if (!this.socket) {
      throw new Error("Not connected");
    }
    console.debug("WebSocket send message", message);
    this.socket.send(toBigIntAwareJson(message));
  }
}

/**
 * @license
 * Copyright 2025-2026 Open Home Foundation
 * SPDX-License-Identifier: Apache-2.0
 */
class MatterError extends Error {}
class InvalidServerVersion extends MatterError {}
class CommandTimeoutError extends MatterError {
  constructor(command, timeoutMs) {
    super(`Command '${command}' timed out after ${timeoutMs}ms`);
    this.command = command;
    this.timeoutMs = timeoutMs;
    this.name = "CommandTimeoutError";
  }
  command;
  timeoutMs;
}
class ConnectionClosedError extends MatterError {
  constructor(message = "Connection closed while command was pending") {
    super(message);
    this.name = "ConnectionClosedError";
  }
}

/**
 * @license
 * Copyright 2025-2026 Open Home Foundation
 * SPDX-License-Identifier: Apache-2.0
 */
class MatterNode {
  constructor(data) {
    this.data = data;
    this.node_id = data.node_id;
    this.date_commissioned = data.date_commissioned;
    this.last_interview = data.last_interview;
    this.interview_version = data.interview_version;
    this.available = data.available;
    this.is_bridge = data.is_bridge;
    this.attributes = data.attributes;
    this.attribute_subscriptions = data.attribute_subscriptions;
    this.matter_version = data.matter_version;
  }
  data;
  node_id;
  date_commissioned;
  last_interview;
  interview_version;
  available;
  is_bridge;
  attributes;
  /** Attribute subscriptions (always empty array in current protocol, matches Python Matter Server) */
  attribute_subscriptions;
  /**
   * Matter specification version of the node (e.g., "1.2.0", "1.3.0", "1.4.0").
   * Optional - not available in Python Matter Server.
   */
  matter_version;
  get nodeLabel() {
    const label = this.attributes["0/40/5"];
    if (typeof label !== "string") return "";
    if (label.includes("\0\0")) return "";
    return label.trim();
  }
  get vendorName() {
    const value = this.attributes["0/40/1"];
    return typeof value === "string" ? value : "";
  }
  get productName() {
    const value = this.attributes["0/40/3"];
    return typeof value === "string" ? value : "";
  }
  get serialNumber() {
    const value = this.attributes["0/40/15"];
    return typeof value === "string" ? value : "";
  }
  get updateState() {
    const value = this.attributes["0/42/2"];
    return typeof value === "number" ? value : void 0;
  }
  get updateStateProgress() {
    const value = this.attributes["0/42/3"];
    return typeof value === "number" ? value : void 0;
  }
  update(data) {
    return new MatterNode({
      ...this.data,
      ...data
    });
  }
}

/**
 * @license
 * Copyright 2025-2026 Open Home Foundation
 * SPDX-License-Identifier: Apache-2.0
 */
function toNodeKey(nodeId) {
  return String(nodeId);
}
const DEFAULT_COMMAND_TIMEOUT = 5 * 60 * 1e3;
class MatterClient {
  /**
   * Create a new MatterClient.
   * @param url WebSocket URL to connect to
   * @param wsFactory Optional factory function to create WebSocket instances.
   *                  For Node.js, pass: (url) => new WebSocket(url) from the 'ws' package.
   *                  For browser, leave undefined to use native WebSocket.
   */
  constructor(url, wsFactory) {
    this.url = url;
    this.url = url;
    this.connection = new Connection(this.url, wsFactory);
    this.serverBaseAddress = this.url.split("://")[1].split(":")[0] ?? "";
  }
  url;
  connection;
  nodes = {};
  serverBaseAddress;
  /** Whether this client is connected to a production server (optional, for UI purposes) */
  isProduction = false;
  /** Default timeout for commands in milliseconds. Set to 0 to disable timeouts. */
  commandTimeout = DEFAULT_COMMAND_TIMEOUT;
  // Using 'unknown' for resolve since the actual types vary by command
  result_futures = {};
  // Start with random offset for defense-in-depth and easier debugging across sessions
  msgId = Math.floor(Math.random() * 2147483647);
  eventListeners = {};
  webrtcCallbackListeners = [];
  nodeEventListeners = [];
  get serverInfo() {
    return this.connection.serverInfo;
  }
  addEventListener(event, listener) {
    if (!this.eventListeners[event]) {
      this.eventListeners[event] = [];
    }
    this.eventListeners[event].push(listener);
    return () => {
      this.eventListeners[event] = this.eventListeners[event].filter(l => l !== listener);
    };
  }
  /**
   * Subscribe to webrtc_callback events with the typed payload.
   * Returns an unsubscribe function.
   */
  addWebRtcCallbackListener(listener) {
    this.webrtcCallbackListeners.push(listener);
    return () => {
      this.webrtcCallbackListeners = this.webrtcCallbackListeners.filter(l => l !== listener);
    };
  }
  addNodeEventListener(listener) {
    this.nodeEventListeners.push(listener);
    return () => {
      this.nodeEventListeners = this.nodeEventListeners.filter(l => l !== listener);
    };
  }
  async commissionWithCode(code, networkOnly = true, timeout) {
    const data = await this.sendCommand("commission_with_code", 0, {
      code,
      network_only: networkOnly
    }, timeout);
    return new MatterNode(data);
  }
  async setWifiCredentials(ssid, credentials, timeout) {
    await this.sendCommand("set_wifi_credentials", 0, {
      ssid,
      credentials
    }, timeout);
  }
  async setThreadOperationalDataset(dataset, timeout) {
    await this.sendCommand("set_thread_dataset", 0, {
      dataset
    }, timeout);
  }
  async removeWifiCredentials(timeout) {
    await this.sendCommand("remove_wifi_credentials", 0, {}, timeout);
  }
  async removeThreadDataset(timeout) {
    await this.sendCommand("remove_thread_dataset", 0, {}, timeout);
  }
  async openCommissioningWindow(nodeId, windowTimeout, iteration, option, discriminator, timeout) {
    return await this.sendCommand("open_commissioning_window", 0, {
      node_id: nodeId,
      timeout: windowTimeout,
      iteration,
      option,
      discriminator
    }, timeout);
  }
  async discoverCommissionableNodes(timeout) {
    return await this.sendCommand("discover_commissionable_nodes", 0, {}, timeout);
  }
  async getMatterFabrics(nodeId, timeout) {
    return await this.sendCommand("get_matter_fabrics", 3, {
      node_id: nodeId
    }, timeout);
  }
  async removeMatterFabric(nodeId, fabricIndex, timeout) {
    await this.sendCommand("remove_matter_fabric", 3, {
      node_id: nodeId,
      fabric_index: fabricIndex
    }, timeout);
  }
  async pingNode(nodeId, attempts = 1, timeout) {
    return await this.sendCommand("ping_node", 0, {
      node_id: nodeId,
      attempts
    }, timeout);
  }
  async getNodeIPAddresses(nodeId, preferCache, scoped, timeout) {
    return await this.sendCommand("get_node_ip_addresses", 8, {
      node_id: nodeId,
      prefer_cache: preferCache,
      scoped
    }, timeout);
  }
  async removeNode(nodeId, timeout) {
    await this.sendCommand("remove_node", 0, {
      node_id: nodeId
    }, timeout);
  }
  async interviewNode(nodeId, timeout) {
    await this.sendCommand("interview_node", 0, {
      node_id: nodeId
    }, timeout);
  }
  async importTestNode(dump, timeout) {
    await this.sendCommand("import_test_node", 0, {
      dump
    }, timeout);
  }
  async readAttribute(nodeId, attributePath, timeout) {
    return await this.sendCommand("read_attribute", 0, {
      node_id: nodeId,
      attribute_path: attributePath
    }, timeout);
  }
  async writeAttribute(nodeId, attributePath, value, timeout) {
    return await this.sendCommand("write_attribute", 0, {
      node_id: nodeId,
      attribute_path: attributePath,
      value
    }, timeout);
  }
  async checkNodeUpdate(nodeId, timeout) {
    return await this.sendCommand("check_node_update", 10, {
      node_id: nodeId
    }, timeout);
  }
  async updateNode(nodeId, softwareVersion, timeout) {
    await this.sendCommand("update_node", 10, {
      node_id: nodeId,
      software_version: softwareVersion
    }, timeout);
  }
  async setACLEntry(nodeId, entry, timeout) {
    return await this.sendCommand("set_acl_entry", 0, {
      node_id: nodeId,
      entry
    }, timeout);
  }
  async setNodeBinding(nodeId, endpoint, bindings, timeout) {
    return await this.sendCommand("set_node_binding", 0, {
      node_id: nodeId,
      endpoint,
      bindings
    }, timeout);
  }
  async deviceCommand(nodeId, endpointId, clusterId, commandName, payload = {}, timeout) {
    return await this.sendCommand("device_command", 0, {
      node_id: nodeId,
      endpoint_id: endpointId,
      cluster_id: clusterId,
      command_name: commandName,
      payload,
      response_type: null
    }, timeout);
  }
  async sendWebRtcProviderCommand(nodeId, endpointId, commandName, payload, timeout) {
    return await this.sendCommand("send_webrtc_provider_command", 0, {
      node_id: nodeId,
      endpoint_id: endpointId,
      command_name: commandName,
      payload
    }, timeout);
  }
  async getNodes(onlyAvailable = false, timeout) {
    const data = await this.sendCommand("get_nodes", 0, {
      only_available: onlyAvailable
    }, timeout);
    return data.map(n => new MatterNode(n));
  }
  async getNode(nodeId, timeout) {
    const data = await this.sendCommand("get_node", 0, {
      node_id: nodeId
    }, timeout);
    return new MatterNode(data);
  }
  async getVendorNames(filterVendors, timeout) {
    return await this.sendCommand("get_vendor_names", 0, {
      filter_vendors: filterVendors
    }, timeout);
  }
  async fetchServerInfo(timeout) {
    return await this.sendCommand("server_info", 0, {}, timeout);
  }
  async setDefaultFabricLabel(label, timeout) {
    await this.sendCommand("set_default_fabric_label", 0, {
      label
    }, timeout);
  }
  /**
   * Get the current log levels for console and file logging.
   * @param timeout Optional command timeout in milliseconds
   * @returns The current log level configuration
   */
  async getLogLevel(timeout) {
    return await this.sendCommand("get_loglevel", 0, {}, timeout);
  }
  /**
   * Set the log level for console and/or file logging.
   * Changes are temporary and will be reset when the server restarts.
   * @param consoleLoglevel Console log level to set (optional)
   * @param fileLoglevel File log level to set, only applied if file logging is enabled (optional)
   * @param timeout Optional command timeout in milliseconds
   * @returns The log level configuration after the change
   */
  async setLogLevel(consoleLoglevel, fileLoglevel, timeout) {
    return await this.sendCommand("set_loglevel", 0, {
      console_loglevel: consoleLoglevel,
      file_loglevel: fileLoglevel
    }, timeout);
  }
  /**
   * Send a command to the Matter server.
   * @param command The command name
   * @param require_schema Minimum schema version required (0 for any version)
   * @param args Command arguments
   * @param timeout Optional timeout in milliseconds. Defaults to `commandTimeout`. Set to 0 to disable.
   * @returns Promise that resolves with the command result
   * @throws Error if the command times out or fails
   */
  sendCommand(command, require_schema = void 0, args, timeout = this.commandTimeout) {
    if (require_schema && this.serverInfo.schema_version < require_schema) {
      throw new InvalidServerVersion(`Command not available due to incompatible server version. Update the Matter Server to a version that supports at least api schema ${require_schema}.`);
    }
    if (this.msgId >= Number.MAX_SAFE_INTEGER) {
      this.msgId = 0;
    }
    const messageId = String(++this.msgId);
    const message = {
      message_id: messageId,
      command,
      args
    };
    return new Promise((resolve, reject) => {
      let timeoutId;
      if (timeout > 0) {
        timeoutId = setTimeout(() => {
          const pending = this.result_futures[messageId];
          if (pending) {
            if (pending.timeoutId) {
              clearTimeout(pending.timeoutId);
            }
            delete this.result_futures[messageId];
            reject(new CommandTimeoutError(command, timeout));
          }
        }, timeout);
      }
      this.result_futures[messageId] = {
        resolve,
        reject,
        timeoutId
      };
      this.connection.sendMessage(message);
    });
  }
  /**
   * Safely resolve a pending command, ensuring it's only resolved once.
   * Clears timeout and removes from pending futures before resolving.
   */
  _resolvePendingCommand(messageId, result) {
    const pending = this.result_futures[messageId];
    if (pending) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      delete this.result_futures[messageId];
      pending.resolve(result);
    }
  }
  /**
   * Safely reject a pending command, ensuring it's only rejected once.
   * Clears timeout and removes from pending futures before rejecting.
   */
  _rejectPendingCommand(messageId, error) {
    const pending = this.result_futures[messageId];
    if (pending) {
      if (pending.timeoutId) {
        clearTimeout(pending.timeoutId);
      }
      delete this.result_futures[messageId];
      pending.reject(error);
    }
  }
  /**
   * Reject all pending commands with a ConnectionClosedError.
   * Called when the connection is closed or lost.
   */
  _rejectAllPendingCommands() {
    const error = new ConnectionClosedError();
    const pendingIds = Object.keys(this.result_futures);
    for (const messageId of pendingIds) {
      this._rejectPendingCommand(messageId, error);
    }
  }
  async connect() {
    if (this.connection.connected) {
      return;
    }
    await this.connection.connect(msg => this._handleIncomingMessage(msg), () => {
      this._rejectAllPendingCommands();
      this.fireEvent("connection_lost");
    });
  }
  disconnect(clearStorage = false) {
    this._rejectAllPendingCommands();
    if (this.connection && this.connection.connected) {
      this.connection.disconnect();
    }
    if (clearStorage && typeof localStorage !== "undefined") {
      localStorage.removeItem("matterURL");
      location.reload();
    }
  }
  async startListening() {
    await this.connect();
    const nodesArray = await this.sendCommand("start_listening", 0, {});
    const nodes = {};
    for (const node of nodesArray) {
      nodes[toNodeKey(node.node_id)] = new MatterNode(node);
    }
    this.nodes = nodes;
  }
  _handleIncomingMessage(msg) {
    if ("event" in msg) {
      this._handleEventMessage(msg);
      return;
    }
    if ("error_code" in msg) {
      this._rejectPendingCommand(msg.message_id, new Error(msg.details));
      return;
    }
    if ("result" in msg) {
      this._resolvePendingCommand(msg.message_id, msg.result);
      return;
    }
    console.warn("Received message with unknown format", msg);
  }
  _handleEventMessage(event) {
    console.debug("Incoming event", event);
    this.onRawEvent(event);
    if (event.event === "node_added") {
      const node = new MatterNode(event.data);
      this.nodes = {
        ...this.nodes,
        [toNodeKey(node.node_id)]: node
      };
      this.fireEvent("nodes_changed");
      return;
    }
    if (event.event === "node_removed") {
      delete this.nodes[toNodeKey(event.data)];
      this.nodes = {
        ...this.nodes
      };
      this.fireEvent("nodes_changed");
      return;
    }
    if (event.event === "node_updated") {
      const node = new MatterNode(event.data);
      this.nodes = {
        ...this.nodes,
        [toNodeKey(node.node_id)]: node
      };
      this.fireEvent("nodes_changed");
      return;
    }
    if (event.event === "attribute_updated") {
      const [nodeId, attributeKey, attributeValue] = event.data;
      const nodeKey = toNodeKey(nodeId);
      const existingNode = this.nodes[nodeKey];
      if (existingNode) {
        const node = new MatterNode(existingNode.data);
        node.attributes[attributeKey] = attributeValue;
        this.nodes = {
          ...this.nodes,
          [nodeKey]: node
        };
        this.fireEvent("nodes_changed");
      }
      return;
    }
    if (event.event === "server_info_updated") {
      this.connection.serverInfo = event.data;
      this.fireEvent("server_info_updated");
      return;
    }
    if (event.event === "server_shutdown") {
      this.fireEvent("server_shutdown");
      this.disconnect();
      return;
    }
    if (event.event === "webrtc_callback") {
      for (const listener of this.webrtcCallbackListeners) {
        listener(event.data);
      }
      return;
    }
    if (event.event === "node_event") {
      for (const listener of this.nodeEventListeners) {
        listener(event.data);
      }
      return;
    }
  }
  fireEvent(event) {
    const listeners = this.eventListeners[event];
    if (listeners) {
      for (const listener of listeners) {
        listener();
      }
    }
  }
  /**
   * Hook for subclasses to receive raw events.
   * Override this method to intercept all incoming events.
   * @param event The raw event message
   */
  onRawEvent(_event) {}
}

/**
 * @license
 * Copyright 2025-2026 Open Home Foundation
 * SPDX-License-Identifier: Apache-2.0
 */
const STORAGE_KEY = "matterTheme";
class ThemeServiceImpl {
  constructor() {
    this._preference = "system";
    this._listeners = /* @__PURE__ */new Set();
    this._mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
    this._mediaQuery.addEventListener("change", () => this._applyTheme());
    this._loadPreference();
    this._applyTheme();
  }
  get preference() {
    return this._preference;
  }
  get effectiveTheme() {
    if (this._preference === "system") {
      return this._mediaQuery.matches ? "dark" : "light";
    }
    return this._preference;
  }
  setPreference(pref) {
    this._preference = pref;
    localStorage.setItem(STORAGE_KEY, pref);
    this._applyTheme();
  }
  cycleTheme() {
    const cycle = ["light", "dark", "system"];
    const currentIndex = cycle.indexOf(this._preference);
    const nextIndex = (currentIndex + 1) % cycle.length;
    this.setPreference(cycle[nextIndex]);
    return this._preference;
  }
  subscribe(callback) {
    this._listeners.add(callback);
    return () => this._listeners.delete(callback);
  }
  _loadPreference() {
    const urlParams = new URLSearchParams(window.location.search);
    const themeParam = urlParams.get("theme");
    if (themeParam && ["light", "dark", "system"].includes(themeParam)) {
      this._preference = themeParam;
      localStorage.setItem(STORAGE_KEY, themeParam);
      urlParams.delete("theme");
      const newUrl = urlParams.toString() ? `${window.location.pathname}?${urlParams.toString()}${window.location.hash}` : `${window.location.pathname}${window.location.hash}`;
      history.replaceState({}, "", newUrl);
      return;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored && ["light", "dark", "system"].includes(stored)) {
      this._preference = stored;
    }
  }
  _applyTheme() {
    const effective = this.effectiveTheme;
    document.documentElement.classList.toggle("dark-theme", effective === "dark");
    const metaThemeColor = document.querySelector('meta[name="theme-color"]');
    if (metaThemeColor) {
      metaThemeColor.setAttribute("content", effective === "dark" ? "#1e1e1e" : "#03a9f4");
    }
    this._listeners.forEach(cb => cb(effective));
  }
}
const ThemeService = new ThemeServiceImpl();

/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const t$3 = globalThis,
  e$6 = t$3.ShadowRoot && (void 0 === t$3.ShadyCSS || t$3.ShadyCSS.nativeShadow) && "adoptedStyleSheets" in Document.prototype && "replace" in CSSStyleSheet.prototype,
  s$2 = Symbol(),
  o$7 = new WeakMap();
let n$5 = class n {
  constructor(t, e, o) {
    if (this._$cssResult$ = true, o !== s$2) throw Error("CSSResult is not constructable. Use `unsafeCSS` or `css` instead.");
    this.cssText = t, this.t = e;
  }
  get styleSheet() {
    let t = this.o;
    const s = this.t;
    if (e$6 && void 0 === t) {
      const e = void 0 !== s && 1 === s.length;
      e && (t = o$7.get(s)), void 0 === t && ((this.o = t = new CSSStyleSheet()).replaceSync(this.cssText), e && o$7.set(s, t));
    }
    return t;
  }
  toString() {
    return this.cssText;
  }
};
const r$5 = t => new n$5("string" == typeof t ? t : t + "", void 0, s$2),
  i$6 = (t, ...e) => {
    const o = 1 === t.length ? t[0] : e.reduce((e, s, o) => e + (t => {
      if (true === t._$cssResult$) return t.cssText;
      if ("number" == typeof t) return t;
      throw Error("Value passed to 'css' function must be a 'css' function result: " + t + ". Use 'unsafeCSS' to pass non-literal values, but take care to ensure page security.");
    })(s) + t[o + 1], t[0]);
    return new n$5(o, t, s$2);
  },
  S$1 = (s, o) => {
    if (e$6) s.adoptedStyleSheets = o.map(t => t instanceof CSSStyleSheet ? t : t.styleSheet);else for (const e of o) {
      const o = document.createElement("style"),
        n = t$3.litNonce;
      void 0 !== n && o.setAttribute("nonce", n), o.textContent = e.cssText, s.appendChild(o);
    }
  },
  c$2 = e$6 ? t => t : t => t instanceof CSSStyleSheet ? (t => {
    let e = "";
    for (const s of t.cssRules) e += s.cssText;
    return r$5(e);
  })(t) : t;

/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const {
    is: i$5,
    defineProperty: e$5,
    getOwnPropertyDescriptor: h$1,
    getOwnPropertyNames: r$4,
    getOwnPropertySymbols: o$6,
    getPrototypeOf: n$4
  } = Object,
  a$2 = globalThis,
  c$1 = a$2.trustedTypes,
  l$3 = c$1 ? c$1.emptyScript : "",
  p$2 = a$2.reactiveElementPolyfillSupport,
  d$1 = (t, s) => t,
  u$2 = {
    toAttribute(t, s) {
      switch (s) {
        case Boolean:
          t = t ? l$3 : null;
          break;
        case Object:
        case Array:
          t = null == t ? t : JSON.stringify(t);
      }
      return t;
    },
    fromAttribute(t, s) {
      let i = t;
      switch (s) {
        case Boolean:
          i = null !== t;
          break;
        case Number:
          i = null === t ? null : Number(t);
          break;
        case Object:
        case Array:
          try {
            i = JSON.parse(t);
          } catch (t) {
            i = null;
          }
      }
      return i;
    }
  },
  f$1 = (t, s) => !i$5(t, s),
  b$1 = {
    attribute: true,
    type: String,
    converter: u$2,
    reflect: false,
    useDefault: false,
    hasChanged: f$1
  };
Symbol.metadata ?? (Symbol.metadata = Symbol("metadata")), a$2.litPropertyMetadata ?? (a$2.litPropertyMetadata = new WeakMap());
let y$1 = class y extends HTMLElement {
  static addInitializer(t) {
    this._$Ei(), (this.l ?? (this.l = [])).push(t);
  }
  static get observedAttributes() {
    return this.finalize(), this._$Eh && [...this._$Eh.keys()];
  }
  static createProperty(t, s = b$1) {
    if (s.state && (s.attribute = false), this._$Ei(), this.prototype.hasOwnProperty(t) && ((s = Object.create(s)).wrapped = true), this.elementProperties.set(t, s), !s.noAccessor) {
      const i = Symbol(),
        h = this.getPropertyDescriptor(t, i, s);
      void 0 !== h && e$5(this.prototype, t, h);
    }
  }
  static getPropertyDescriptor(t, s, i) {
    const {
      get: e,
      set: r
    } = h$1(this.prototype, t) ?? {
      get() {
        return this[s];
      },
      set(t) {
        this[s] = t;
      }
    };
    return {
      get: e,
      set(s) {
        const h = e?.call(this);
        r?.call(this, s), this.requestUpdate(t, h, i);
      },
      configurable: true,
      enumerable: true
    };
  }
  static getPropertyOptions(t) {
    return this.elementProperties.get(t) ?? b$1;
  }
  static _$Ei() {
    if (this.hasOwnProperty(d$1("elementProperties"))) return;
    const t = n$4(this);
    t.finalize(), void 0 !== t.l && (this.l = [...t.l]), this.elementProperties = new Map(t.elementProperties);
  }
  static finalize() {
    if (this.hasOwnProperty(d$1("finalized"))) return;
    if (this.finalized = true, this._$Ei(), this.hasOwnProperty(d$1("properties"))) {
      const t = this.properties,
        s = [...r$4(t), ...o$6(t)];
      for (const i of s) this.createProperty(i, t[i]);
    }
    const t = this[Symbol.metadata];
    if (null !== t) {
      const s = litPropertyMetadata.get(t);
      if (void 0 !== s) for (const [t, i] of s) this.elementProperties.set(t, i);
    }
    this._$Eh = new Map();
    for (const [t, s] of this.elementProperties) {
      const i = this._$Eu(t, s);
      void 0 !== i && this._$Eh.set(i, t);
    }
    this.elementStyles = this.finalizeStyles(this.styles);
  }
  static finalizeStyles(s) {
    const i = [];
    if (Array.isArray(s)) {
      const e = new Set(s.flat(1 / 0).reverse());
      for (const s of e) i.unshift(c$2(s));
    } else void 0 !== s && i.push(c$2(s));
    return i;
  }
  static _$Eu(t, s) {
    const i = s.attribute;
    return false === i ? void 0 : "string" == typeof i ? i : "string" == typeof t ? t.toLowerCase() : void 0;
  }
  constructor() {
    super(), this._$Ep = void 0, this.isUpdatePending = false, this.hasUpdated = false, this._$Em = null, this._$Ev();
  }
  _$Ev() {
    this._$ES = new Promise(t => this.enableUpdating = t), this._$AL = new Map(), this._$E_(), this.requestUpdate(), this.constructor.l?.forEach(t => t(this));
  }
  addController(t) {
    (this._$EO ?? (this._$EO = new Set())).add(t), void 0 !== this.renderRoot && this.isConnected && t.hostConnected?.();
  }
  removeController(t) {
    this._$EO?.delete(t);
  }
  _$E_() {
    const t = new Map(),
      s = this.constructor.elementProperties;
    for (const i of s.keys()) this.hasOwnProperty(i) && (t.set(i, this[i]), delete this[i]);
    t.size > 0 && (this._$Ep = t);
  }
  createRenderRoot() {
    const t = this.shadowRoot ?? this.attachShadow(this.constructor.shadowRootOptions);
    return S$1(t, this.constructor.elementStyles), t;
  }
  connectedCallback() {
    this.renderRoot ?? (this.renderRoot = this.createRenderRoot()), this.enableUpdating(true), this._$EO?.forEach(t => t.hostConnected?.());
  }
  enableUpdating(t) {}
  disconnectedCallback() {
    this._$EO?.forEach(t => t.hostDisconnected?.());
  }
  attributeChangedCallback(t, s, i) {
    this._$AK(t, i);
  }
  _$ET(t, s) {
    const i = this.constructor.elementProperties.get(t),
      e = this.constructor._$Eu(t, i);
    if (void 0 !== e && true === i.reflect) {
      const h = (void 0 !== i.converter?.toAttribute ? i.converter : u$2).toAttribute(s, i.type);
      this._$Em = t, null == h ? this.removeAttribute(e) : this.setAttribute(e, h), this._$Em = null;
    }
  }
  _$AK(t, s) {
    const i = this.constructor,
      e = i._$Eh.get(t);
    if (void 0 !== e && this._$Em !== e) {
      const t = i.getPropertyOptions(e),
        h = "function" == typeof t.converter ? {
          fromAttribute: t.converter
        } : void 0 !== t.converter?.fromAttribute ? t.converter : u$2;
      this._$Em = e;
      const r = h.fromAttribute(s, t.type);
      this[e] = r ?? this._$Ej?.get(e) ?? r, this._$Em = null;
    }
  }
  requestUpdate(t, s, i, e = false, h) {
    if (void 0 !== t) {
      const r = this.constructor;
      if (false === e && (h = this[t]), i ?? (i = r.getPropertyOptions(t)), !((i.hasChanged ?? f$1)(h, s) || i.useDefault && i.reflect && h === this._$Ej?.get(t) && !this.hasAttribute(r._$Eu(t, i)))) return;
      this.C(t, s, i);
    }
    false === this.isUpdatePending && (this._$ES = this._$EP());
  }
  C(t, s, {
    useDefault: i,
    reflect: e,
    wrapped: h
  }, r) {
    i && !(this._$Ej ?? (this._$Ej = new Map())).has(t) && (this._$Ej.set(t, r ?? s ?? this[t]), true !== h || void 0 !== r) || (this._$AL.has(t) || (this.hasUpdated || i || (s = void 0), this._$AL.set(t, s)), true === e && this._$Em !== t && (this._$Eq ?? (this._$Eq = new Set())).add(t));
  }
  async _$EP() {
    this.isUpdatePending = true;
    try {
      await this._$ES;
    } catch (t) {
      Promise.reject(t);
    }
    const t = this.scheduleUpdate();
    return null != t && (await t), !this.isUpdatePending;
  }
  scheduleUpdate() {
    return this.performUpdate();
  }
  performUpdate() {
    if (!this.isUpdatePending) return;
    if (!this.hasUpdated) {
      if (this.renderRoot ?? (this.renderRoot = this.createRenderRoot()), this._$Ep) {
        for (const [t, s] of this._$Ep) this[t] = s;
        this._$Ep = void 0;
      }
      const t = this.constructor.elementProperties;
      if (t.size > 0) for (const [s, i] of t) {
        const {
            wrapped: t
          } = i,
          e = this[s];
        true !== t || this._$AL.has(s) || void 0 === e || this.C(s, void 0, i, e);
      }
    }
    let t = false;
    const s = this._$AL;
    try {
      t = this.shouldUpdate(s), t ? (this.willUpdate(s), this._$EO?.forEach(t => t.hostUpdate?.()), this.update(s)) : this._$EM();
    } catch (s) {
      throw t = false, this._$EM(), s;
    }
    t && this._$AE(s);
  }
  willUpdate(t) {}
  _$AE(t) {
    this._$EO?.forEach(t => t.hostUpdated?.()), this.hasUpdated || (this.hasUpdated = true, this.firstUpdated(t)), this.updated(t);
  }
  _$EM() {
    this._$AL = new Map(), this.isUpdatePending = false;
  }
  get updateComplete() {
    return this.getUpdateComplete();
  }
  getUpdateComplete() {
    return this._$ES;
  }
  shouldUpdate(t) {
    return true;
  }
  update(t) {
    this._$Eq && (this._$Eq = this._$Eq.forEach(t => this._$ET(t, this[t]))), this._$EM();
  }
  updated(t) {}
  firstUpdated(t) {}
};
y$1.elementStyles = [], y$1.shadowRootOptions = {
  mode: "open"
}, y$1[d$1("elementProperties")] = new Map(), y$1[d$1("finalized")] = new Map(), p$2?.({
  ReactiveElement: y$1
}), (a$2.reactiveElementVersions ?? (a$2.reactiveElementVersions = [])).push("2.1.2");

/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const t$2 = globalThis,
  i$4 = t => t,
  s$1 = t$2.trustedTypes,
  e$4 = s$1 ? s$1.createPolicy("lit-html", {
    createHTML: t => t
  }) : void 0,
  h = "$lit$",
  o$5 = `lit$${Math.random().toFixed(9).slice(2)}$`,
  n$3 = "?" + o$5,
  r$3 = `<${n$3}>`,
  l$2 = document,
  c = () => l$2.createComment(""),
  a$1 = t => null === t || "object" != typeof t && "function" != typeof t,
  u$1 = Array.isArray,
  d = t => u$1(t) || "function" == typeof t?.[Symbol.iterator],
  f = "[ \t\n\f\r]",
  v = /<(?:(!--|\/[^a-zA-Z])|(\/?[a-zA-Z][^>\s]*)|(\/?$))/g,
  _ = /-->/g,
  m$1 = />/g,
  p$1 = RegExp(`>|${f}(?:([^\\s"'>=/]+)(${f}*=${f}*(?:[^ \t\n\f\r"'\`<>=]|("|')|))|$)`, "g"),
  g = /'/g,
  $ = /"/g,
  y = /^(?:script|style|textarea|title)$/i,
  x = t => (i, ...s) => ({
    _$litType$: t,
    strings: i,
    values: s
  }),
  b = x(1),
  w = x(2),
  E = Symbol.for("lit-noChange"),
  A = Symbol.for("lit-nothing"),
  C = new WeakMap(),
  P = l$2.createTreeWalker(l$2, 129);
function V(t, i) {
  if (!u$1(t) || !t.hasOwnProperty("raw")) throw Error("invalid template strings array");
  return void 0 !== e$4 ? e$4.createHTML(i) : i;
}
const N = (t, i) => {
  const s = t.length - 1,
    e = [];
  let n,
    l = 2 === i ? "<svg>" : 3 === i ? "<math>" : "",
    c = v;
  for (let i = 0; i < s; i++) {
    const s = t[i];
    let a,
      u,
      d = -1,
      f = 0;
    for (; f < s.length && (c.lastIndex = f, u = c.exec(s), null !== u);) f = c.lastIndex, c === v ? "!--" === u[1] ? c = _ : void 0 !== u[1] ? c = m$1 : void 0 !== u[2] ? (y.test(u[2]) && (n = RegExp("</" + u[2], "g")), c = p$1) : void 0 !== u[3] && (c = p$1) : c === p$1 ? ">" === u[0] ? (c = n ?? v, d = -1) : void 0 === u[1] ? d = -2 : (d = c.lastIndex - u[2].length, a = u[1], c = void 0 === u[3] ? p$1 : '"' === u[3] ? $ : g) : c === $ || c === g ? c = p$1 : c === _ || c === m$1 ? c = v : (c = p$1, n = void 0);
    const x = c === p$1 && t[i + 1].startsWith("/>") ? " " : "";
    l += c === v ? s + r$3 : d >= 0 ? (e.push(a), s.slice(0, d) + h + s.slice(d) + o$5 + x) : s + o$5 + (-2 === d ? i : x);
  }
  return [V(t, l + (t[s] || "<?>") + (2 === i ? "</svg>" : 3 === i ? "</math>" : "")), e];
};
class S {
  constructor({
    strings: t,
    _$litType$: i
  }, e) {
    let r;
    this.parts = [];
    let l = 0,
      a = 0;
    const u = t.length - 1,
      d = this.parts,
      [f, v] = N(t, i);
    if (this.el = S.createElement(f, e), P.currentNode = this.el.content, 2 === i || 3 === i) {
      const t = this.el.content.firstChild;
      t.replaceWith(...t.childNodes);
    }
    for (; null !== (r = P.nextNode()) && d.length < u;) {
      if (1 === r.nodeType) {
        if (r.hasAttributes()) for (const t of r.getAttributeNames()) if (t.endsWith(h)) {
          const i = v[a++],
            s = r.getAttribute(t).split(o$5),
            e = /([.?@])?(.*)/.exec(i);
          d.push({
            type: 1,
            index: l,
            name: e[2],
            strings: s,
            ctor: "." === e[1] ? I : "?" === e[1] ? L : "@" === e[1] ? z : H
          }), r.removeAttribute(t);
        } else t.startsWith(o$5) && (d.push({
          type: 6,
          index: l
        }), r.removeAttribute(t));
        if (y.test(r.tagName)) {
          const t = r.textContent.split(o$5),
            i = t.length - 1;
          if (i > 0) {
            r.textContent = s$1 ? s$1.emptyScript : "";
            for (let s = 0; s < i; s++) r.append(t[s], c()), P.nextNode(), d.push({
              type: 2,
              index: ++l
            });
            r.append(t[i], c());
          }
        }
      } else if (8 === r.nodeType) if (r.data === n$3) d.push({
        type: 2,
        index: l
      });else {
        let t = -1;
        for (; -1 !== (t = r.data.indexOf(o$5, t + 1));) d.push({
          type: 7,
          index: l
        }), t += o$5.length - 1;
      }
      l++;
    }
  }
  static createElement(t, i) {
    const s = l$2.createElement("template");
    return s.innerHTML = t, s;
  }
}
function M(t, i, s = t, e) {
  if (i === E) return i;
  let h = void 0 !== e ? s._$Co?.[e] : s._$Cl;
  const o = a$1(i) ? void 0 : i._$litDirective$;
  return h?.constructor !== o && (h?._$AO?.(false), void 0 === o ? h = void 0 : (h = new o(t), h._$AT(t, s, e)), void 0 !== e ? (s._$Co ?? (s._$Co = []))[e] = h : s._$Cl = h), void 0 !== h && (i = M(t, h._$AS(t, i.values), h, e)), i;
}
class R {
  constructor(t, i) {
    this._$AV = [], this._$AN = void 0, this._$AD = t, this._$AM = i;
  }
  get parentNode() {
    return this._$AM.parentNode;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  u(t) {
    const {
        el: {
          content: i
        },
        parts: s
      } = this._$AD,
      e = (t?.creationScope ?? l$2).importNode(i, true);
    P.currentNode = e;
    let h = P.nextNode(),
      o = 0,
      n = 0,
      r = s[0];
    for (; void 0 !== r;) {
      if (o === r.index) {
        let i;
        2 === r.type ? i = new k(h, h.nextSibling, this, t) : 1 === r.type ? i = new r.ctor(h, r.name, r.strings, this, t) : 6 === r.type && (i = new Z(h, this, t)), this._$AV.push(i), r = s[++n];
      }
      o !== r?.index && (h = P.nextNode(), o++);
    }
    return P.currentNode = l$2, e;
  }
  p(t) {
    let i = 0;
    for (const s of this._$AV) void 0 !== s && (void 0 !== s.strings ? (s._$AI(t, s, i), i += s.strings.length - 2) : s._$AI(t[i])), i++;
  }
}
class k {
  get _$AU() {
    return this._$AM?._$AU ?? this._$Cv;
  }
  constructor(t, i, s, e) {
    this.type = 2, this._$AH = A, this._$AN = void 0, this._$AA = t, this._$AB = i, this._$AM = s, this.options = e, this._$Cv = e?.isConnected ?? true;
  }
  get parentNode() {
    let t = this._$AA.parentNode;
    const i = this._$AM;
    return void 0 !== i && 11 === t?.nodeType && (t = i.parentNode), t;
  }
  get startNode() {
    return this._$AA;
  }
  get endNode() {
    return this._$AB;
  }
  _$AI(t, i = this) {
    t = M(this, t, i), a$1(t) ? t === A || null == t || "" === t ? (this._$AH !== A && this._$AR(), this._$AH = A) : t !== this._$AH && t !== E && this._(t) : void 0 !== t._$litType$ ? this.$(t) : void 0 !== t.nodeType ? this.T(t) : d(t) ? this.k(t) : this._(t);
  }
  O(t) {
    return this._$AA.parentNode.insertBefore(t, this._$AB);
  }
  T(t) {
    this._$AH !== t && (this._$AR(), this._$AH = this.O(t));
  }
  _(t) {
    this._$AH !== A && a$1(this._$AH) ? this._$AA.nextSibling.data = t : this.T(l$2.createTextNode(t)), this._$AH = t;
  }
  $(t) {
    const {
        values: i,
        _$litType$: s
      } = t,
      e = "number" == typeof s ? this._$AC(t) : (void 0 === s.el && (s.el = S.createElement(V(s.h, s.h[0]), this.options)), s);
    if (this._$AH?._$AD === e) this._$AH.p(i);else {
      const t = new R(e, this),
        s = t.u(this.options);
      t.p(i), this.T(s), this._$AH = t;
    }
  }
  _$AC(t) {
    let i = C.get(t.strings);
    return void 0 === i && C.set(t.strings, i = new S(t)), i;
  }
  k(t) {
    u$1(this._$AH) || (this._$AH = [], this._$AR());
    const i = this._$AH;
    let s,
      e = 0;
    for (const h of t) e === i.length ? i.push(s = new k(this.O(c()), this.O(c()), this, this.options)) : s = i[e], s._$AI(h), e++;
    e < i.length && (this._$AR(s && s._$AB.nextSibling, e), i.length = e);
  }
  _$AR(t = this._$AA.nextSibling, s) {
    for (this._$AP?.(false, true, s); t !== this._$AB;) {
      const s = i$4(t).nextSibling;
      i$4(t).remove(), t = s;
    }
  }
  setConnected(t) {
    void 0 === this._$AM && (this._$Cv = t, this._$AP?.(t));
  }
}
class H {
  get tagName() {
    return this.element.tagName;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  constructor(t, i, s, e, h) {
    this.type = 1, this._$AH = A, this._$AN = void 0, this.element = t, this.name = i, this._$AM = e, this.options = h, s.length > 2 || "" !== s[0] || "" !== s[1] ? (this._$AH = Array(s.length - 1).fill(new String()), this.strings = s) : this._$AH = A;
  }
  _$AI(t, i = this, s, e) {
    const h = this.strings;
    let o = false;
    if (void 0 === h) t = M(this, t, i, 0), o = !a$1(t) || t !== this._$AH && t !== E, o && (this._$AH = t);else {
      const e = t;
      let n, r;
      for (t = h[0], n = 0; n < h.length - 1; n++) r = M(this, e[s + n], i, n), r === E && (r = this._$AH[n]), o || (o = !a$1(r) || r !== this._$AH[n]), r === A ? t = A : t !== A && (t += (r ?? "") + h[n + 1]), this._$AH[n] = r;
    }
    o && !e && this.j(t);
  }
  j(t) {
    t === A ? this.element.removeAttribute(this.name) : this.element.setAttribute(this.name, t ?? "");
  }
}
class I extends H {
  constructor() {
    super(...arguments), this.type = 3;
  }
  j(t) {
    this.element[this.name] = t === A ? void 0 : t;
  }
}
class L extends H {
  constructor() {
    super(...arguments), this.type = 4;
  }
  j(t) {
    this.element.toggleAttribute(this.name, !!t && t !== A);
  }
}
class z extends H {
  constructor(t, i, s, e, h) {
    super(t, i, s, e, h), this.type = 5;
  }
  _$AI(t, i = this) {
    if ((t = M(this, t, i, 0) ?? A) === E) return;
    const s = this._$AH,
      e = t === A && s !== A || t.capture !== s.capture || t.once !== s.once || t.passive !== s.passive,
      h = t !== A && (s === A || e);
    e && this.element.removeEventListener(this.name, this, s), h && this.element.addEventListener(this.name, this, t), this._$AH = t;
  }
  handleEvent(t) {
    "function" == typeof this._$AH ? this._$AH.call(this.options?.host ?? this.element, t) : this._$AH.handleEvent(t);
  }
}
class Z {
  constructor(t, i, s) {
    this.element = t, this.type = 6, this._$AN = void 0, this._$AM = i, this.options = s;
  }
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AI(t) {
    M(this, t);
  }
}
const B = t$2.litHtmlPolyfillSupport;
B?.(S, k), (t$2.litHtmlVersions ?? (t$2.litHtmlVersions = [])).push("3.3.3");
const D = (t, i, s) => {
  const e = s?.renderBefore ?? i;
  let h = e._$litPart$;
  if (void 0 === h) {
    const t = s?.renderBefore ?? null;
    e._$litPart$ = h = new k(i.insertBefore(c(), t), t, void 0, s ?? {});
  }
  return h._$AI(t), h;
};

/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const s = globalThis;
let i$3 = class i extends y$1 {
  constructor() {
    super(...arguments), this.renderOptions = {
      host: this
    }, this._$Do = void 0;
  }
  createRenderRoot() {
    var _this$renderOptions;
    const t = super.createRenderRoot();
    return (_this$renderOptions = this.renderOptions).renderBefore ?? (_this$renderOptions.renderBefore = t.firstChild), t;
  }
  update(t) {
    const r = this.render();
    this.hasUpdated || (this.renderOptions.isConnected = this.isConnected), super.update(t), this._$Do = D(r, this.renderRoot, this.renderOptions);
  }
  connectedCallback() {
    super.connectedCallback(), this._$Do?.setConnected(true);
  }
  disconnectedCallback() {
    super.disconnectedCallback(), this._$Do?.setConnected(false);
  }
  render() {
    return E;
  }
};
i$3._$litElement$ = true, i$3["finalized"] = true, s.litElementHydrateSupport?.({
  LitElement: i$3
});
const o$4 = s.litElementPolyfillSupport;
o$4?.({
  LitElement: i$3
});
(s.litElementVersions ?? (s.litElementVersions = [])).push("4.2.2");

/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const t$1 = t => (e, o) => {
  void 0 !== o ? o.addInitializer(() => {
    customElements.define(t, e);
  }) : customElements.define(t, e);
};

/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const o$3 = {
    attribute: true,
    type: String,
    converter: u$2,
    reflect: false,
    hasChanged: f$1
  },
  r$2 = (t = o$3, e, r) => {
    const {
      kind: n,
      metadata: i
    } = r;
    let s = globalThis.litPropertyMetadata.get(i);
    if (void 0 === s && globalThis.litPropertyMetadata.set(i, s = new Map()), "setter" === n && ((t = Object.create(t)).wrapped = true), s.set(r.name, t), "accessor" === n) {
      const {
        name: o
      } = r;
      return {
        set(r) {
          const n = e.get.call(this);
          e.set.call(this, r), this.requestUpdate(o, n, t, true, r);
        },
        init(e) {
          return void 0 !== e && this.C(o, void 0, t, e), e;
        }
      };
    }
    if ("setter" === n) {
      const {
        name: o
      } = r;
      return function (r) {
        const n = this[o];
        e.call(this, r), this.requestUpdate(o, n, t, true, r);
      };
    }
    throw Error("Unsupported decorator location: " + n);
  };
function n$2(t) {
  return (e, o) => "object" == typeof o ? r$2(t, e, o) : ((t, e, o) => {
    const r = e.hasOwnProperty(o);
    return e.constructor.createProperty(o, t), r ? Object.getOwnPropertyDescriptor(e, o) : void 0;
  })(t, e, o);
}

/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
function r$1(r) {
  return n$2({
    ...r,
    state: true,
    attribute: false
  });
}

/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const e$3 = (e, t, c) => (c.configurable = true, c.enumerable = true, Reflect.decorate && "object" != typeof t && Object.defineProperty(e, t, c), c);

/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
function e$2(e, r) {
  return (n, s, i) => {
    const o = t => t.renderRoot?.querySelector(e) ?? null;
    return e$3(n, s, {
      get() {
        return o(this);
      }
    });
  };
}

/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
function o$2(o) {
  return (e, n) => {
    const {
        slot: r,
        selector: s
      } = o ?? {},
      c = "slot" + (r ? `[name=${r}]` : ":not([name])");
    return e$3(e, n, {
      get() {
        const t = this.renderRoot?.querySelector(c),
          e = t?.assignedElements(o) ?? [];
        return void 0 === s ? e : e.filter(t => t.matches(s));
      }
    });
  };
}

/******************************************************************************
Copyright (c) Microsoft Corporation.

Permission to use, copy, modify, and/or distribute this software for any
purpose with or without fee is hereby granted.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY
AND FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM
LOSS OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR
OTHER TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR
PERFORMANCE OF THIS SOFTWARE.
***************************************************************************** */
/* global Reflect, Promise, SuppressedError, Symbol, Iterator */

function __decorate(decorators, target, key, desc) {
  var c = arguments.length,
    r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc,
    d;
  if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
  return c > 3 && r && Object.defineProperty(target, key, r), r;
}
typeof SuppressedError === "function" ? SuppressedError : function (error, suppressed, message) {
  var e = new Error(message);
  return e.name = "SuppressedError", e.error = error, e.suppressed = suppressed, e;
};

/**
 * @license
 * Copyright 2022 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * A component for elevation.
 */
class Elevation extends i$3 {
  connectedCallback() {
    super.connectedCallback();
    // Needed for VoiceOver, which will create a "group" if the element is a
    // sibling to other content.
    this.setAttribute('aria-hidden', 'true');
  }
  render() {
    return b`<span class="shadow"></span>`;
  }
}

/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// Generated stylesheet for ./elevation/internal/elevation-styles.css.
const styles$a = i$6`:host,.shadow,.shadow::before,.shadow::after{border-radius:inherit;inset:0;position:absolute;transition-duration:inherit;transition-property:inherit;transition-timing-function:inherit}:host{display:flex;pointer-events:none;transition-property:box-shadow,opacity}.shadow::before,.shadow::after{content:"";transition-property:box-shadow,opacity;--_level: var(--md-elevation-level, 0);--_shadow-color: var(--md-elevation-shadow-color, var(--md-sys-color-shadow, #000))}.shadow::before{box-shadow:0px calc(1px*(clamp(0,var(--_level),1) + clamp(0,var(--_level) - 3,1) + 2*clamp(0,var(--_level) - 4,1))) calc(1px*(2*clamp(0,var(--_level),1) + clamp(0,var(--_level) - 2,1) + clamp(0,var(--_level) - 4,1))) 0px var(--_shadow-color);opacity:.3}.shadow::after{box-shadow:0px calc(1px*(clamp(0,var(--_level),1) + clamp(0,var(--_level) - 1,1) + 2*clamp(0,var(--_level) - 2,3))) calc(1px*(3*clamp(0,var(--_level),2) + 2*clamp(0,var(--_level) - 2,3))) calc(1px*(clamp(0,var(--_level),4) + 2*clamp(0,var(--_level) - 4,1))) var(--_shadow-color);opacity:.15}
`;

/**
 * @license
 * Copyright 2022 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * The `<md-elevation>` custom element with default styles.
 *
 * Elevation is the relative distance between two surfaces along the z-axis.
 *
 * @final
 * @suppress {visibility}
 */
let MdElevation = class MdElevation extends Elevation {};
MdElevation.styles = [styles$a];
MdElevation = __decorate([t$1('md-elevation')], MdElevation);

/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * A key to retrieve an `Attachable` element's `AttachableController` from a
 * global `MutationObserver`.
 */
const ATTACHABLE_CONTROLLER = Symbol('attachableController');
let FOR_ATTRIBUTE_OBSERVER;
{
  /**
   * A global `MutationObserver` that reacts to `for` attribute changes on
   * `Attachable` elements. If the `for` attribute changes, the controller will
   * re-attach to the new referenced element.
   */
  FOR_ATTRIBUTE_OBSERVER = new MutationObserver(records => {
    for (const record of records) {
      // When a control's `for` attribute changes, inform its
      // `AttachableController` to update to a new control.
      record.target[ATTACHABLE_CONTROLLER]?.hostConnected();
    }
  });
}
/**
 * A controller that provides an implementation for `Attachable` elements.
 *
 * @example
 * ```ts
 * class MyElement extends LitElement implements Attachable {
 *   get control() { return this.attachableController.control; }
 *
 *   private readonly attachableController = new AttachableController(
 *     this,
 *     (previousControl, newControl) => {
 *       previousControl?.removeEventListener('click', this.handleClick);
 *       newControl?.addEventListener('click', this.handleClick);
 *     }
 *   );
 *
 *   // Implement remaining `Attachable` properties/methods that call the
 *   // controller's properties/methods.
 * }
 * ```
 */
class AttachableController {
  get htmlFor() {
    return this.host.getAttribute('for');
  }
  set htmlFor(htmlFor) {
    if (htmlFor === null) {
      this.host.removeAttribute('for');
    } else {
      this.host.setAttribute('for', htmlFor);
    }
  }
  get control() {
    if (this.host.hasAttribute('for')) {
      if (!this.htmlFor || !this.host.isConnected) {
        return null;
      }
      return this.host.getRootNode().querySelector(`#${this.htmlFor}`);
    }
    return this.currentControl || this.host.parentElement;
  }
  set control(control) {
    if (control) {
      this.attach(control);
    } else {
      this.detach();
    }
  }
  /**
   * Creates a new controller for an `Attachable` element.
   *
   * @param host The `Attachable` element.
   * @param onControlChange A callback with two parameters for the previous and
   *     next control. An `Attachable` element may perform setup or teardown
   *     logic whenever the control changes.
   */
  constructor(host, onControlChange) {
    this.host = host;
    this.onControlChange = onControlChange;
    this.currentControl = null;
    host.addController(this);
    host[ATTACHABLE_CONTROLLER] = this;
    FOR_ATTRIBUTE_OBSERVER?.observe(host, {
      attributeFilter: ['for']
    });
  }
  attach(control) {
    if (control === this.currentControl) {
      return;
    }
    this.setCurrentControl(control);
    // When imperatively attaching, remove the `for` attribute so
    // that the attached control is used instead of a referenced one.
    this.host.removeAttribute('for');
  }
  detach() {
    this.setCurrentControl(null);
    // When imperatively detaching, add an empty `for=""` attribute. This will
    // ensure the control is `null` rather than the `parentElement`.
    this.host.setAttribute('for', '');
  }
  /** @private */
  hostConnected() {
    this.setCurrentControl(this.control);
  }
  /** @private */
  hostDisconnected() {
    this.setCurrentControl(null);
  }
  setCurrentControl(control) {
    this.onControlChange(this.currentControl, control);
    this.currentControl = control;
  }
}

/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Events that the focus ring listens to.
 */
const EVENTS$1 = ['focusin', 'focusout', 'pointerdown'];
/**
 * A focus ring component.
 *
 * @fires visibility-changed {Event} Fired whenever `visible` changes.
 */
class FocusRing extends i$3 {
  constructor() {
    super(...arguments);
    /**
     * Makes the focus ring visible.
     */
    this.visible = false;
    /**
     * Makes the focus ring animate inwards instead of outwards.
     */
    this.inward = false;
    this.attachableController = new AttachableController(this, this.onControlChange.bind(this));
  }
  get htmlFor() {
    return this.attachableController.htmlFor;
  }
  set htmlFor(htmlFor) {
    this.attachableController.htmlFor = htmlFor;
  }
  get control() {
    return this.attachableController.control;
  }
  set control(control) {
    this.attachableController.control = control;
  }
  attach(control) {
    this.attachableController.attach(control);
  }
  detach() {
    this.attachableController.detach();
  }
  connectedCallback() {
    super.connectedCallback();
    // Needed for VoiceOver, which will create a "group" if the element is a
    // sibling to other content.
    this.setAttribute('aria-hidden', 'true');
  }
  /** @private */
  handleEvent(event) {
    if (event[HANDLED_BY_FOCUS_RING]) {
      // This ensures the focus ring does not activate when multiple focus rings
      // are used within a single component.
      return;
    }
    switch (event.type) {
      default:
        return;
      case 'focusin':
        this.visible = this.control?.matches(':focus-visible') ?? false;
        break;
      case 'focusout':
      case 'pointerdown':
        this.visible = false;
        break;
    }
    event[HANDLED_BY_FOCUS_RING] = true;
  }
  onControlChange(prev, next) {
    for (const event of EVENTS$1) {
      prev?.removeEventListener(event, this);
      next?.addEventListener(event, this);
    }
  }
  update(changed) {
    if (changed.has('visible')) {
      // This logic can be removed once the `:has` selector has been introduced
      // to Firefox. This is necessary to allow correct submenu styles.
      this.dispatchEvent(new Event('visibility-changed'));
    }
    super.update(changed);
  }
}
__decorate([n$2({
  type: Boolean,
  reflect: true
})], FocusRing.prototype, "visible", void 0);
__decorate([n$2({
  type: Boolean,
  reflect: true
})], FocusRing.prototype, "inward", void 0);
const HANDLED_BY_FOCUS_RING = Symbol('handledByFocusRing');

/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// Generated stylesheet for ./focus/internal/focus-ring-styles.css.
const styles$9 = i$6`:host{animation-delay:0s,calc(var(--md-focus-ring-duration, 600ms)*.25);animation-duration:calc(var(--md-focus-ring-duration, 600ms)*.25),calc(var(--md-focus-ring-duration, 600ms)*.75);animation-timing-function:cubic-bezier(0.2, 0, 0, 1);box-sizing:border-box;color:var(--md-focus-ring-color, var(--md-sys-color-secondary, #625b71));display:none;pointer-events:none;position:absolute}:host([visible]){display:flex}:host(:not([inward])){animation-name:outward-grow,outward-shrink;border-end-end-radius:calc(var(--md-focus-ring-shape-end-end, var(--md-focus-ring-shape, var(--md-sys-shape-corner-full, 9999px))) + var(--md-focus-ring-outward-offset, 2px));border-end-start-radius:calc(var(--md-focus-ring-shape-end-start, var(--md-focus-ring-shape, var(--md-sys-shape-corner-full, 9999px))) + var(--md-focus-ring-outward-offset, 2px));border-start-end-radius:calc(var(--md-focus-ring-shape-start-end, var(--md-focus-ring-shape, var(--md-sys-shape-corner-full, 9999px))) + var(--md-focus-ring-outward-offset, 2px));border-start-start-radius:calc(var(--md-focus-ring-shape-start-start, var(--md-focus-ring-shape, var(--md-sys-shape-corner-full, 9999px))) + var(--md-focus-ring-outward-offset, 2px));inset:calc(-1*var(--md-focus-ring-outward-offset, 2px));outline:var(--md-focus-ring-width, 3px) solid currentColor}:host([inward]){animation-name:inward-grow,inward-shrink;border-end-end-radius:calc(var(--md-focus-ring-shape-end-end, var(--md-focus-ring-shape, var(--md-sys-shape-corner-full, 9999px))) - var(--md-focus-ring-inward-offset, 0px));border-end-start-radius:calc(var(--md-focus-ring-shape-end-start, var(--md-focus-ring-shape, var(--md-sys-shape-corner-full, 9999px))) - var(--md-focus-ring-inward-offset, 0px));border-start-end-radius:calc(var(--md-focus-ring-shape-start-end, var(--md-focus-ring-shape, var(--md-sys-shape-corner-full, 9999px))) - var(--md-focus-ring-inward-offset, 0px));border-start-start-radius:calc(var(--md-focus-ring-shape-start-start, var(--md-focus-ring-shape, var(--md-sys-shape-corner-full, 9999px))) - var(--md-focus-ring-inward-offset, 0px));border:var(--md-focus-ring-width, 3px) solid currentColor;inset:var(--md-focus-ring-inward-offset, 0px)}@keyframes outward-grow{from{outline-width:0}to{outline-width:var(--md-focus-ring-active-width, 8px)}}@keyframes outward-shrink{from{outline-width:var(--md-focus-ring-active-width, 8px)}}@keyframes inward-grow{from{border-width:0}to{border-width:var(--md-focus-ring-active-width, 8px)}}@keyframes inward-shrink{from{border-width:var(--md-focus-ring-active-width, 8px)}}@media(prefers-reduced-motion){:host{animation:none}}
`;

/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * TODO(b/267336424): add docs
 *
 * @final
 * @suppress {visibility}
 */
let MdFocusRing = class MdFocusRing extends FocusRing {};
MdFocusRing.styles = [styles$9];
MdFocusRing = __decorate([t$1('md-focus-ring')], MdFocusRing);

/**
 * @license
 * Copyright 2017 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const t = {
    ATTRIBUTE: 1,
    CHILD: 2,
    PROPERTY: 3,
    BOOLEAN_ATTRIBUTE: 4},
  e$1 = t => (...e) => ({
    _$litDirective$: t,
    values: e
  });
let i$2 = class i {
  constructor(t) {}
  get _$AU() {
    return this._$AM._$AU;
  }
  _$AT(t, e, i) {
    this._$Ct = t, this._$AM = e, this._$Ci = i;
  }
  _$AS(t, e) {
    return this.update(t, e);
  }
  update(t, e) {
    return this.render(...e);
  }
};

/**
 * @license
 * Copyright 2018 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const e = e$1(class extends i$2 {
  constructor(t$1) {
    if (super(t$1), t$1.type !== t.ATTRIBUTE || "class" !== t$1.name || t$1.strings?.length > 2) throw Error("`classMap()` can only be used in the `class` attribute and must be the only part in the attribute.");
  }
  render(t) {
    return " " + Object.keys(t).filter(s => t[s]).join(" ") + " ";
  }
  update(s, [i]) {
    if (void 0 === this.st) {
      this.st = new Set(), void 0 !== s.strings && (this.nt = new Set(s.strings.join(" ").split(/\s/).filter(t => "" !== t)));
      for (const t in i) i[t] && !this.nt?.has(t) && this.st.add(t);
      return this.render(i);
    }
    const r = s.element.classList;
    for (const t of this.st) t in i || (r.remove(t), this.st.delete(t));
    for (const t in i) {
      const s = !!i[t];
      s === this.st.has(t) || this.nt?.has(t) || (s ? (r.add(t), this.st.add(t)) : (r.remove(t), this.st.delete(t)));
    }
    return E;
  }
});

/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Easing functions to use for web animations.
 *
 * **NOTE:** `EASING.EMPHASIZED` is approximated with unknown accuracy.
 *
 * TODO(b/241113345): replace with tokens
 */
const EASING = {
  STANDARD: 'cubic-bezier(0.2, 0, 0, 1)',
  EMPHASIZED: 'cubic-bezier(.3,0,0,1)',
  EMPHASIZED_ACCELERATE: 'cubic-bezier(.3,0,.8,.15)'};
/**
 * Creates an `AnimationSignal` that can be used to cancel a previous task.
 *
 * @example
 * class MyClass {
 *   private labelAnimationSignal = createAnimationSignal();
 *
 *   private async animateLabel() {
 *     // Start of the task. Previous tasks will be canceled.
 *     const signal = this.labelAnimationSignal.start();
 *
 *     // Do async work...
 *     if (signal.aborted) {
 *       // Use AbortSignal to check if a request was made to abort after some
 *       // asynchronous work.
 *       return;
 *     }
 *
 *     const animation = this.animate(...);
 *     // Add event listeners to be notified when the task should be canceled.
 *     signal.addEventListener('abort', () => {
 *       animation.cancel();
 *     });
 *
 *     animation.addEventListener('finish', () => {
 *       // Tell the signal that the current task is finished.
 *       this.labelAnimationSignal.finish();
 *     });
 *   }
 * }
 *
 * @return An `AnimationSignal`.
 */
function createAnimationSignal() {
  // The current animation's AbortController
  let animationAbortController = null;
  return {
    start() {
      // Tell the previous animation to cancel.
      animationAbortController?.abort();
      // Set up a new AbortController for the current animation.
      animationAbortController = new AbortController();
      // Provide the AbortSignal so that the caller can check aborted status
      // and add listeners.
      return animationAbortController.signal;
    },
    finish() {
      animationAbortController = null;
    }
  };
}

/**
 * @license
 * Copyright 2022 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
const PRESS_GROW_MS = 450;
const MINIMUM_PRESS_MS = 225;
const INITIAL_ORIGIN_SCALE = 0.2;
const PADDING = 10;
const SOFT_EDGE_MINIMUM_SIZE = 75;
const SOFT_EDGE_CONTAINER_RATIO = 0.35;
const PRESS_PSEUDO = '::after';
const ANIMATION_FILL = 'forwards';
/**
 * Interaction states for the ripple.
 *
 * On Touch:
 *  - `INACTIVE -> TOUCH_DELAY -> WAITING_FOR_CLICK -> INACTIVE`
 *  - `INACTIVE -> TOUCH_DELAY -> HOLDING -> WAITING_FOR_CLICK -> INACTIVE`
 *
 * On Mouse or Pen:
 *   - `INACTIVE -> WAITING_FOR_CLICK -> INACTIVE`
 */
var State;
(function (State) {
  /**
   * Initial state of the control, no touch in progress.
   *
   * Transitions:
   *   - on touch down: transition to `TOUCH_DELAY`.
   *   - on mouse down: transition to `WAITING_FOR_CLICK`.
   */
  State[State["INACTIVE"] = 0] = "INACTIVE";
  /**
   * Touch down has been received, waiting to determine if it's a swipe or
   * scroll.
   *
   * Transitions:
   *   - on touch up: begin press; transition to `WAITING_FOR_CLICK`.
   *   - on cancel: transition to `INACTIVE`.
   *   - after `TOUCH_DELAY_MS`: begin press; transition to `HOLDING`.
   */
  State[State["TOUCH_DELAY"] = 1] = "TOUCH_DELAY";
  /**
   * A touch has been deemed to be a press
   *
   * Transitions:
   *  - on up: transition to `WAITING_FOR_CLICK`.
   */
  State[State["HOLDING"] = 2] = "HOLDING";
  /**
   * The user touch has finished, transition into rest state.
   *
   * Transitions:
   *   - on click end press; transition to `INACTIVE`.
   */
  State[State["WAITING_FOR_CLICK"] = 3] = "WAITING_FOR_CLICK";
})(State || (State = {}));
/**
 * Events that the ripple listens to.
 */
const EVENTS = ['click', 'contextmenu', 'pointercancel', 'pointerdown', 'pointerenter', 'pointerleave', 'pointerup'];
/**
 * Delay reacting to touch so that we do not show the ripple for a swipe or
 * scroll interaction.
 */
const TOUCH_DELAY_MS = 150;
/**
 * Used to detect if HCM is active. Events do not process during HCM when the
 * ripple is not displayed.
 */
const FORCED_COLORS = window.matchMedia('(forced-colors: active)');
/**
 * A ripple component.
 */
class Ripple extends i$3 {
  constructor() {
    super(...arguments);
    /**
     * Disables the ripple.
     */
    this.disabled = false;
    this.hovered = false;
    this.pressed = false;
    this.rippleSize = '';
    this.rippleScale = '';
    this.initialSize = 0;
    this.state = State.INACTIVE;
    this.attachableController = new AttachableController(this, this.onControlChange.bind(this));
  }
  get htmlFor() {
    return this.attachableController.htmlFor;
  }
  set htmlFor(htmlFor) {
    this.attachableController.htmlFor = htmlFor;
  }
  get control() {
    return this.attachableController.control;
  }
  set control(control) {
    this.attachableController.control = control;
  }
  attach(control) {
    this.attachableController.attach(control);
  }
  detach() {
    this.attachableController.detach();
  }
  connectedCallback() {
    super.connectedCallback();
    // Needed for VoiceOver, which will create a "group" if the element is a
    // sibling to other content.
    this.setAttribute('aria-hidden', 'true');
  }
  render() {
    const classes = {
      'hovered': this.hovered,
      'pressed': this.pressed
    };
    return b`<div class="surface ${e(classes)}"></div>`;
  }
  update(changedProps) {
    if (changedProps.has('disabled') && this.disabled) {
      this.hovered = false;
      this.pressed = false;
    }
    super.update(changedProps);
  }
  /**
   * TODO(b/269799771): make private
   * @private only public for slider
   */
  handlePointerenter(event) {
    if (!this.shouldReactToEvent(event)) {
      return;
    }
    this.hovered = true;
  }
  /**
   * TODO(b/269799771): make private
   * @private only public for slider
   */
  handlePointerleave(event) {
    if (!this.shouldReactToEvent(event)) {
      return;
    }
    this.hovered = false;
    // release a held mouse or pen press that moves outside the element
    if (this.state !== State.INACTIVE) {
      this.endPressAnimation();
    }
  }
  handlePointerup(event) {
    if (!this.shouldReactToEvent(event)) {
      return;
    }
    if (this.state === State.HOLDING) {
      this.state = State.WAITING_FOR_CLICK;
      return;
    }
    if (this.state === State.TOUCH_DELAY) {
      this.state = State.WAITING_FOR_CLICK;
      this.startPressAnimation(this.rippleStartEvent);
      return;
    }
  }
  async handlePointerdown(event) {
    if (!this.shouldReactToEvent(event)) {
      return;
    }
    this.rippleStartEvent = event;
    if (!this.isTouch(event)) {
      this.state = State.WAITING_FOR_CLICK;
      this.startPressAnimation(event);
      return;
    }
    // Wait for a hold after touch delay
    this.state = State.TOUCH_DELAY;
    await new Promise(resolve => {
      setTimeout(resolve, TOUCH_DELAY_MS);
    });
    if (this.state !== State.TOUCH_DELAY) {
      return;
    }
    this.state = State.HOLDING;
    this.startPressAnimation(event);
  }
  handleClick() {
    // Click is a MouseEvent in Firefox and Safari, so we cannot use
    // `shouldReactToEvent`
    if (this.disabled) {
      return;
    }
    if (this.state === State.WAITING_FOR_CLICK) {
      this.endPressAnimation();
      return;
    }
    if (this.state === State.INACTIVE) {
      // keyboard synthesized click event
      this.startPressAnimation();
      this.endPressAnimation();
    }
  }
  handlePointercancel(event) {
    if (!this.shouldReactToEvent(event)) {
      return;
    }
    this.endPressAnimation();
  }
  handleContextmenu() {
    if (this.disabled) {
      return;
    }
    this.endPressAnimation();
  }
  determineRippleSize() {
    const {
      height,
      width
    } = this.getBoundingClientRect();
    const maxDim = Math.max(height, width);
    const softEdgeSize = Math.max(SOFT_EDGE_CONTAINER_RATIO * maxDim, SOFT_EDGE_MINIMUM_SIZE);
    // `?? 1` may be removed once `currentCSSZoom` is widely available.
    const zoom = this.currentCSSZoom ?? 1;
    const initialSize = Math.floor(maxDim * INITIAL_ORIGIN_SCALE / zoom);
    const hypotenuse = Math.sqrt(width ** 2 + height ** 2);
    const maxRadius = hypotenuse + PADDING;
    this.initialSize = initialSize;
    // The dimensions may be altered by CSS `zoom`, which needs to be
    // compensated for in the final scale() value.
    const maybeZoomedScale = (maxRadius + softEdgeSize) / initialSize;
    this.rippleScale = `${maybeZoomedScale / zoom}`;
    this.rippleSize = `${initialSize}px`;
  }
  getNormalizedPointerEventCoords(pointerEvent) {
    const {
      scrollX,
      scrollY
    } = window;
    const {
      left,
      top
    } = this.getBoundingClientRect();
    const documentX = scrollX + left;
    const documentY = scrollY + top;
    const {
      pageX,
      pageY
    } = pointerEvent;
    // `?? 1` may be removed once `currentCSSZoom` is widely available.
    const zoom = this.currentCSSZoom ?? 1;
    return {
      x: (pageX - documentX) / zoom,
      y: (pageY - documentY) / zoom
    };
  }
  getTranslationCoordinates(positionEvent) {
    const {
      height,
      width
    } = this.getBoundingClientRect();
    // `?? 1` may be removed once `currentCSSZoom` is widely available.
    const zoom = this.currentCSSZoom ?? 1;
    // end in the center
    const endPoint = {
      x: (width / zoom - this.initialSize) / 2,
      y: (height / zoom - this.initialSize) / 2
    };
    let startPoint;
    if (positionEvent instanceof PointerEvent) {
      startPoint = this.getNormalizedPointerEventCoords(positionEvent);
    } else {
      startPoint = {
        x: width / zoom / 2,
        y: height / zoom / 2
      };
    }
    // center around start point
    startPoint = {
      x: startPoint.x - this.initialSize / 2,
      y: startPoint.y - this.initialSize / 2
    };
    return {
      startPoint,
      endPoint
    };
  }
  startPressAnimation(positionEvent) {
    if (!this.mdRoot) {
      return;
    }
    this.pressed = true;
    this.growAnimation?.cancel();
    this.determineRippleSize();
    const {
      startPoint,
      endPoint
    } = this.getTranslationCoordinates(positionEvent);
    const translateStart = `${startPoint.x}px, ${startPoint.y}px`;
    const translateEnd = `${endPoint.x}px, ${endPoint.y}px`;
    this.growAnimation = this.mdRoot.animate({
      top: [0, 0],
      left: [0, 0],
      height: [this.rippleSize, this.rippleSize],
      width: [this.rippleSize, this.rippleSize],
      transform: [`translate(${translateStart}) scale(1)`, `translate(${translateEnd}) scale(${this.rippleScale})`]
    }, {
      pseudoElement: PRESS_PSEUDO,
      duration: PRESS_GROW_MS,
      easing: EASING.STANDARD,
      fill: ANIMATION_FILL
    });
  }
  async endPressAnimation() {
    this.rippleStartEvent = undefined;
    this.state = State.INACTIVE;
    const animation = this.growAnimation;
    let pressAnimationPlayState = Infinity;
    if (typeof animation?.currentTime === 'number') {
      pressAnimationPlayState = animation.currentTime;
    } else if (animation?.currentTime) {
      pressAnimationPlayState = animation.currentTime.to('ms').value;
    }
    if (pressAnimationPlayState >= MINIMUM_PRESS_MS) {
      this.pressed = false;
      return;
    }
    await new Promise(resolve => {
      setTimeout(resolve, MINIMUM_PRESS_MS - pressAnimationPlayState);
    });
    if (this.growAnimation !== animation) {
      // A new press animation was started. The old animation was canceled and
      // should not finish the pressed state.
      return;
    }
    this.pressed = false;
  }
  /**
   * Returns `true` if
   *  - the ripple element is enabled
   *  - the pointer is primary for the input type
   *  - the pointer is the pointer that started the interaction, or will start
   * the interaction
   *  - the pointer is a touch, or the pointer state has the primary button
   * held, or the pointer is hovering
   */
  shouldReactToEvent(event) {
    if (this.disabled || !event.isPrimary) {
      return false;
    }
    if (this.rippleStartEvent && this.rippleStartEvent.pointerId !== event.pointerId) {
      return false;
    }
    if (event.type === 'pointerenter' || event.type === 'pointerleave') {
      return !this.isTouch(event);
    }
    const isPrimaryButton = event.buttons === 1;
    return this.isTouch(event) || isPrimaryButton;
  }
  isTouch({
    pointerType
  }) {
    return pointerType === 'touch';
  }
  /** @private */
  async handleEvent(event) {
    if (FORCED_COLORS?.matches) {
      // Skip event logic since the ripple is `display: none`.
      return;
    }
    switch (event.type) {
      case 'click':
        this.handleClick();
        break;
      case 'contextmenu':
        this.handleContextmenu();
        break;
      case 'pointercancel':
        this.handlePointercancel(event);
        break;
      case 'pointerdown':
        await this.handlePointerdown(event);
        break;
      case 'pointerenter':
        this.handlePointerenter(event);
        break;
      case 'pointerleave':
        this.handlePointerleave(event);
        break;
      case 'pointerup':
        this.handlePointerup(event);
        break;
    }
  }
  onControlChange(prev, next) {
    for (const event of EVENTS) {
      prev?.removeEventListener(event, this);
      next?.addEventListener(event, this);
    }
  }
}
__decorate([n$2({
  type: Boolean,
  reflect: true
})], Ripple.prototype, "disabled", void 0);
__decorate([r$1()], Ripple.prototype, "hovered", void 0);
__decorate([r$1()], Ripple.prototype, "pressed", void 0);
__decorate([e$2('.surface')], Ripple.prototype, "mdRoot", void 0);

/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// Generated stylesheet for ./ripple/internal/ripple-styles.css.
const styles$8 = i$6`:host{display:flex;margin:auto;pointer-events:none}:host([disabled]){display:none}@media(forced-colors: active){:host{display:none}}:host,.surface{border-radius:inherit;position:absolute;inset:0;overflow:hidden}.surface{-webkit-tap-highlight-color:rgba(0,0,0,0)}.surface::before,.surface::after{content:"";opacity:0;position:absolute}.surface::before{background-color:var(--md-ripple-hover-color, var(--md-sys-color-on-surface, #1d1b20));inset:0;transition:opacity 15ms linear,background-color 15ms linear}.surface::after{background:radial-gradient(closest-side, var(--md-ripple-pressed-color, var(--md-sys-color-on-surface, #1d1b20)) max(100% - 70px, 65%), transparent 100%);transform-origin:center center;transition:opacity 375ms linear}.hovered::before{background-color:var(--md-ripple-hover-color, var(--md-sys-color-on-surface, #1d1b20));opacity:var(--md-ripple-hover-opacity, 0.08)}.pressed::after{opacity:var(--md-ripple-pressed-opacity, 0.12);transition-duration:105ms}
`;

/**
 * @license
 * Copyright 2022 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @summary Ripples, also known as state layers, are visual indicators used to
 * communicate the status of a component or interactive element.
 *
 * @description A state layer is a semi-transparent covering on an element that
 * indicates its state. State layers provide a systematic approach to
 * visualizing states by using opacity. A layer can be applied to an entire
 * element or in a circular shape and only one state layer can be applied at a
 * given time.
 *
 * @final
 * @suppress {visibility}
 */
let MdRipple = class MdRipple extends Ripple {};
MdRipple.styles = [styles$8];
MdRipple = __decorate([t$1('md-ripple')], MdRipple);

/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Accessibility Object Model reflective aria properties.
 */
const ARIA_PROPERTIES = ['role', 'ariaAtomic', 'ariaAutoComplete', 'ariaBusy', 'ariaChecked', 'ariaColCount', 'ariaColIndex', 'ariaColSpan', 'ariaCurrent', 'ariaDisabled', 'ariaExpanded', 'ariaHasPopup', 'ariaHidden', 'ariaInvalid', 'ariaKeyShortcuts', 'ariaLabel', 'ariaLevel', 'ariaLive', 'ariaModal', 'ariaMultiLine', 'ariaMultiSelectable', 'ariaOrientation', 'ariaPlaceholder', 'ariaPosInSet', 'ariaPressed', 'ariaReadOnly', 'ariaRequired', 'ariaRoleDescription', 'ariaRowCount', 'ariaRowIndex', 'ariaRowSpan', 'ariaSelected', 'ariaSetSize', 'ariaSort', 'ariaValueMax', 'ariaValueMin', 'ariaValueNow', 'ariaValueText'];
/**
 * Accessibility Object Model aria attributes.
 */
const ARIA_ATTRIBUTES = ARIA_PROPERTIES.map(ariaPropertyToAttribute);
/**
 * Checks if an attribute is one of the AOM aria attributes.
 *
 * @example
 * isAriaAttribute('aria-label'); // true
 *
 * @param attribute The attribute to check.
 * @return True if the attribute is an aria attribute, or false if not.
 */
function isAriaAttribute(attribute) {
  return ARIA_ATTRIBUTES.includes(attribute);
}
/**
 * Converts an AOM aria property into its corresponding attribute.
 *
 * @example
 * ariaPropertyToAttribute('ariaLabel'); // 'aria-label'
 *
 * @param property The aria property.
 * @return The aria attribute.
 */
function ariaPropertyToAttribute(property) {
  return property.replace('aria', 'aria-')
  // IDREF attributes also include an "Element" or "Elements" suffix
  .replace(/Elements?/g, '').toLowerCase();
}

/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// Private symbols
const privateIgnoreAttributeChangesFor = Symbol('privateIgnoreAttributeChangesFor');
/**
 * Mixes in aria delegation for elements that delegate focus and aria to inner
 * shadow root elements.
 *
 * This mixin fixes invalid aria announcements with shadow roots, caused by
 * duplicate aria attributes on both the host and the inner shadow root element.
 *
 * Note: this mixin **does not yet support** ID reference attributes, such as
 * `aria-labelledby` or `aria-controls`.
 *
 * @example
 * ```ts
 * class MyButton extends mixinDelegatesAria(LitElement) {
 *   static shadowRootOptions = {mode: 'open', delegatesFocus: true};
 *
 *   render() {
 *     return html`
 *       <button aria-label=${this.ariaLabel || nothing}>
 *         <slot></slot>
 *       </button>
 *     `;
 *   }
 * }
 * ```
 * ```html
 * <my-button aria-label="Plus one">+1</my-button>
 * ```
 *
 * Use `ARIAMixinStrict` for lit analyzer strict types, such as the "role"
 * attribute.
 *
 * @example
 * ```ts
 * return html`
 *   <button role=${(this as ARIAMixinStrict).role || nothing}>
 *     <slot></slot>
 *   </button>
 * `;
 * ```
 *
 * In the future, updates to the Accessibility Object Model (AOM) will provide
 * built-in aria delegation features that will replace this mixin.
 *
 * @param base The class to mix functionality into.
 * @return The provided class with aria delegation mixed in.
 */
function mixinDelegatesAria(base) {
  var _a;
  class WithDelegatesAriaElement extends base {
    constructor() {
      super(...arguments);
      this[_a] = new Set();
    }
    attributeChangedCallback(name, oldValue, newValue) {
      if (!isAriaAttribute(name)) {
        super.attributeChangedCallback(name, oldValue, newValue);
        return;
      }
      if (this[privateIgnoreAttributeChangesFor].has(name)) {
        return;
      }
      // Don't trigger another `attributeChangedCallback` once we remove the
      // aria attribute from the host. We check the explicit name of the
      // attribute to ignore since `attributeChangedCallback` can be called
      // multiple times out of an expected order when hydrating an element with
      // multiple attributes.
      this[privateIgnoreAttributeChangesFor].add(name);
      this.removeAttribute(name);
      this[privateIgnoreAttributeChangesFor].delete(name);
      const dataProperty = ariaAttributeToDataProperty(name);
      if (newValue === null) {
        delete this.dataset[dataProperty];
      } else {
        this.dataset[dataProperty] = newValue;
      }
      this.requestUpdate(ariaAttributeToDataProperty(name), oldValue);
    }
    getAttribute(name) {
      if (isAriaAttribute(name)) {
        return super.getAttribute(ariaAttributeToDataAttribute(name));
      }
      return super.getAttribute(name);
    }
    removeAttribute(name) {
      super.removeAttribute(name);
      if (isAriaAttribute(name)) {
        super.removeAttribute(ariaAttributeToDataAttribute(name));
        // Since `aria-*` attributes are already removed`, we need to request
        // an update because `attributeChangedCallback` will not be called.
        this.requestUpdate();
      }
    }
  }
  _a = privateIgnoreAttributeChangesFor;
  setupDelegatesAriaProperties(WithDelegatesAriaElement);
  return WithDelegatesAriaElement;
}
/**
 * Overrides the constructor's native `ARIAMixin` properties to ensure that
 * aria properties reflect the values that were shifted to a data attribute.
 *
 * @param ctor The `ReactiveElement` constructor to patch.
 */
function setupDelegatesAriaProperties(ctor) {
  for (const ariaProperty of ARIA_PROPERTIES) {
    // The casing between ariaProperty and the dataProperty may be different.
    // ex: aria-haspopup -> ariaHasPopup
    const ariaAttribute = ariaPropertyToAttribute(ariaProperty);
    // ex: aria-haspopup -> data-aria-haspopup
    const dataAttribute = ariaAttributeToDataAttribute(ariaAttribute);
    // ex: aria-haspopup -> dataset.ariaHaspopup
    const dataProperty = ariaAttributeToDataProperty(ariaAttribute);
    // Call `ReactiveElement.createProperty()` so that the `aria-*` and `data-*`
    // attributes are added to the `static observedAttributes` array. This
    // triggers `attributeChangedCallback` for the delegates aria mixin to
    // handle.
    ctor.createProperty(ariaProperty, {
      attribute: ariaAttribute,
      noAccessor: true
    });
    ctor.createProperty(Symbol(dataAttribute), {
      attribute: dataAttribute,
      noAccessor: true
    });
    // Re-define the `ARIAMixin` properties to handle data attribute shifting.
    // It is safe to use `Object.defineProperty` here because the properties
    // are native and not renamed.
    // tslint:disable-next-line:ban-unsafe-reflection
    Object.defineProperty(ctor.prototype, ariaProperty, {
      configurable: true,
      enumerable: true,
      get() {
        return this.dataset[dataProperty] ?? null;
      },
      set(value) {
        const prevValue = this.dataset[dataProperty] ?? null;
        if (value === prevValue) {
          return;
        }
        if (value === null) {
          delete this.dataset[dataProperty];
        } else {
          this.dataset[dataProperty] = value;
        }
        this.requestUpdate(ariaProperty, prevValue);
      }
    });
  }
}
function ariaAttributeToDataAttribute(ariaAttribute) {
  // aria-haspopup -> data-aria-haspopup
  return `data-${ariaAttribute}`;
}
function ariaAttributeToDataProperty(ariaAttribute) {
  // aria-haspopup -> dataset.ariaHaspopup
  return ariaAttribute.replace(/-\w/, dashLetter => dashLetter[1].toUpperCase());
}

/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * A unique symbol used for protected access to an instance's
 * `ElementInternals`.
 *
 * @example
 * ```ts
 * class MyElement extends mixinElementInternals(LitElement) {
 *   constructor() {
 *     super();
 *     this[internals].role = 'button';
 *   }
 * }
 * ```
 */
const internals = Symbol('internals');
// Private symbols
const privateInternals = Symbol('privateInternals');
/**
 * Mixes in an attached `ElementInternals` instance.
 *
 * This mixin is only needed when other shared code needs access to a
 * component's `ElementInternals`, such as form-associated mixins.
 *
 * @param base The class to mix functionality into.
 * @return The provided class with `WithElementInternals` mixed in.
 */
function mixinElementInternals(base) {
  class WithElementInternalsElement extends base {
    get [internals]() {
      // Create internals in getter so that it can be used in methods called on
      // construction in `ReactiveElement`, such as `requestUpdate()`.
      if (!this[privateInternals]) {
        // Cast needed for closure
        this[privateInternals] = this.attachInternals();
      }
      return this[privateInternals];
    }
  }
  return WithElementInternalsElement;
}

/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Sets up an element's constructor to enable form submission. The element
 * instance should be form associated and have a `type` property.
 *
 * A click listener is added to each element instance. If the click is not
 * default prevented, it will submit the element's form, if any.
 *
 * @example
 * ```ts
 * class MyElement extends mixinElementInternals(LitElement) {
 *   static {
 *     setupFormSubmitter(MyElement);
 *   }
 *
 *   static formAssociated = true;
 *
 *   type: FormSubmitterType = 'submit';
 * }
 * ```
 *
 * @param ctor The form submitter element's constructor.
 */
function setupFormSubmitter(ctor) {
  ctor.addInitializer(instance => {
    const submitter = instance;
    submitter.addEventListener('click', async event => {
      const {
        type,
        [internals]: elementInternals
      } = submitter;
      const {
        form
      } = elementInternals;
      if (!form || type === 'button') {
        return;
      }
      // Wait a full task for event bubbling to complete.
      await new Promise(resolve => {
        setTimeout(resolve);
      });
      if (event.defaultPrevented) {
        return;
      }
      if (type === 'reset') {
        form.reset();
        return;
      }
      // form.requestSubmit(submitter) does not work with form associated custom
      // elements. This patches the dispatched submit event to add the correct
      // `submitter`.
      // See https://github.com/WICG/webcomponents/issues/814
      form.addEventListener('submit', submitEvent => {
        Object.defineProperty(submitEvent, 'submitter', {
          configurable: true,
          enumerable: true,
          get: () => submitter
        });
      }, {
        capture: true,
        once: true
      });
      elementInternals.setFormValue(submitter.value);
      form.requestSubmit();
    });
  });
}

/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Dispatches a click event to the given element that triggers a native action,
 * but is not composed and therefore is not seen outside the element.
 *
 * This is useful for responding to an external click event on the host element
 * that should trigger an internal action like a button click.
 *
 * Note, a helper is provided because setting this up correctly is a bit tricky.
 * In particular, calling `click` on an element creates a composed event, which
 * is not desirable, and a manually dispatched event must specifically be a
 * `MouseEvent` to trigger a native action.
 *
 * @example
 * hostClickListener = (event: MouseEvent) {
 *   if (isActivationClick(event)) {
 *     this.dispatchActivationClick(this.buttonElement);
 *   }
 * }
 *
 */
function dispatchActivationClick(element) {
  const event = new MouseEvent('click', {
    bubbles: true
  });
  element.dispatchEvent(event);
  return event;
}
/**
 * Returns true if the click event should trigger an activation behavior. The
 * behavior is defined by the element and is whatever it should do when
 * clicked.
 *
 * Typically when an element needs to handle a click, the click is generated
 * from within the element and an event listener within the element implements
 * the needed behavior; however, it's possible to fire a click directly
 * at the element that the element should handle. This method helps
 * distinguish these "external" clicks.
 *
 * An "external" click can be triggered in a number of ways: via a click
 * on an associated label for a form  associated element, calling
 * `element.click()`, or calling
 * `element.dispatchEvent(new MouseEvent('click', ...))`.
 *
 * Also works around Firefox issue
 * https://bugzilla.mozilla.org/show_bug.cgi?id=1804576 by squelching
 * events for a microtask after called.
 *
 * @example
 * hostClickListener = (event: MouseEvent) {
 *   if (isActivationClick(event)) {
 *     this.dispatchActivationClick(this.buttonElement);
 *   }
 * }
 *
 */
function isActivationClick(event) {
  // Event must start at the event target.
  if (event.currentTarget !== event.target) {
    return false;
  }
  // Event must not be retargeted from shadowRoot.
  if (event.composedPath()[0] !== event.target) {
    return false;
  }
  // Target must not be disabled; this should only occur for a synthetically
  // dispatched click.
  if (event.target.disabled) {
    return false;
  }
  // This is an activation if the event should not be squelched.
  return !squelchEvent(event);
}
// TODO(https://bugzilla.mozilla.org/show_bug.cgi?id=1804576)
//  Remove when Firefox bug is addressed.
function squelchEvent(event) {
  const squelched = isSquelchingEvents;
  if (squelched) {
    event.preventDefault();
    event.stopImmediatePropagation();
  }
  squelchEventsForMicrotask();
  return squelched;
}
// Ignore events for one microtask only.
let isSquelchingEvents = false;
async function squelchEventsForMicrotask() {
  isSquelchingEvents = true;
  // Need to pause for just one microtask.
  // tslint:disable-next-line
  await null;
  isSquelchingEvents = false;
}

/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// Separate variable needed for closure.
const buttonBaseClass = mixinDelegatesAria(mixinElementInternals(i$3));
/**
 * A button component.
 */
class Button extends buttonBaseClass {
  get name() {
    return this.getAttribute('name') ?? '';
  }
  set name(name) {
    this.setAttribute('name', name);
  }
  /**
   * The associated form element with which this element's value will submit.
   */
  get form() {
    return this[internals].form;
  }
  constructor() {
    super();
    /**
     * Whether or not the button is disabled.
     */
    this.disabled = false;
    /**
     * Whether or not the button is "soft-disabled" (disabled but still
     * focusable).
     *
     * Use this when a button needs increased visibility when disabled. See
     * https://www.w3.org/WAI/ARIA/apg/practices/keyboard-interface/#kbd_disabled_controls
     * for more guidance on when this is needed.
     */
    this.softDisabled = false;
    /**
     * The URL that the link button points to.
     */
    this.href = '';
    /**
     * The filename to use when downloading the linked resource.
     * If not specified, the browser will determine a filename.
     * This is only applicable when the button is used as a link (`href` is set).
     */
    this.download = '';
    /**
     * Where to display the linked `href` URL for a link button. Common options
     * include `_blank` to open in a new tab.
     */
    this.target = '';
    /**
     * Whether to render the icon at the inline end of the label rather than the
     * inline start.
     *
     * _Note:_ Link buttons cannot have trailing icons.
     */
    this.trailingIcon = false;
    /**
     * Whether to display the icon or not.
     */
    this.hasIcon = false;
    /**
     * The default behavior of the button. May be "button", "reset", or "submit"
     * (default).
     */
    this.type = 'submit';
    /**
     * The value added to a form with the button's name when the button submits a
     * form.
     */
    this.value = '';
    {
      this.addEventListener('click', this.handleClick.bind(this));
    }
  }
  focus() {
    this.buttonElement?.focus();
  }
  blur() {
    this.buttonElement?.blur();
  }
  render() {
    const isRippleDisabled = this.disabled || this.softDisabled;
    const buttonOrLink = this.href ? this.renderLink() : this.renderButton();
    // TODO(b/310046938): due to a limitation in focus ring/ripple, we can't use
    // the same ID for different elements, so we change the ID instead.
    const buttonId = this.href ? 'link' : 'button';
    return b`
      ${this.renderElevationOrOutline?.()}
      <div class="background"></div>
      <md-focus-ring part="focus-ring" for=${buttonId}></md-focus-ring>
      <md-ripple
        part="ripple"
        for=${buttonId}
        ?disabled="${isRippleDisabled}"></md-ripple>
      ${buttonOrLink}
    `;
  }
  renderButton() {
    // Needed for closure conformance
    const {
      ariaLabel,
      ariaHasPopup,
      ariaExpanded
    } = this;
    return b`<button
      id="button"
      class="button"
      ?disabled=${this.disabled}
      aria-disabled=${this.softDisabled || A}
      aria-label="${ariaLabel || A}"
      aria-haspopup="${ariaHasPopup || A}"
      aria-expanded="${ariaExpanded || A}">
      ${this.renderContent()}
    </button>`;
  }
  renderLink() {
    // Needed for closure conformance
    const {
      ariaLabel,
      ariaHasPopup,
      ariaExpanded
    } = this;
    return b`<a
      id="link"
      class="button"
      aria-label="${ariaLabel || A}"
      aria-haspopup="${ariaHasPopup || A}"
      aria-expanded="${ariaExpanded || A}"
      aria-disabled=${this.disabled || this.softDisabled || A}
      tabindex="${this.disabled && !this.softDisabled ? -1 : A}"
      href=${this.href}
      download=${this.download || A}
      target=${this.target || A}
      >${this.renderContent()}
    </a>`;
  }
  renderContent() {
    const icon = b`<slot
      name="icon"
      @slotchange="${this.handleSlotChange}"></slot>`;
    return b`
      <span class="touch"></span>
      ${this.trailingIcon ? A : icon}
      <span class="label"><slot></slot></span>
      ${this.trailingIcon ? icon : A}
    `;
  }
  handleClick(event) {
    // If the button is soft-disabled or a disabled link, we need to explicitly
    // prevent the click from propagating to other event listeners as well as
    // prevent the default action.
    if (this.softDisabled || this.disabled && this.href) {
      event.stopImmediatePropagation();
      event.preventDefault();
      return;
    }
    if (!isActivationClick(event) || !this.buttonElement) {
      return;
    }
    this.focus();
    dispatchActivationClick(this.buttonElement);
  }
  handleSlotChange() {
    this.hasIcon = this.assignedIcons.length > 0;
  }
}
(() => {
  setupFormSubmitter(Button);
})();
/** @nocollapse */
Button.formAssociated = true;
/** @nocollapse */
Button.shadowRootOptions = {
  mode: 'open',
  delegatesFocus: true
};
__decorate([n$2({
  type: Boolean,
  reflect: true
})], Button.prototype, "disabled", void 0);
__decorate([n$2({
  type: Boolean,
  attribute: 'soft-disabled',
  reflect: true
})], Button.prototype, "softDisabled", void 0);
__decorate([n$2()], Button.prototype, "href", void 0);
__decorate([n$2()], Button.prototype, "download", void 0);
__decorate([n$2()], Button.prototype, "target", void 0);
__decorate([n$2({
  type: Boolean,
  attribute: 'trailing-icon',
  reflect: true
})], Button.prototype, "trailingIcon", void 0);
__decorate([n$2({
  type: Boolean,
  attribute: 'has-icon',
  reflect: true
})], Button.prototype, "hasIcon", void 0);
__decorate([n$2()], Button.prototype, "type", void 0);
__decorate([n$2({
  reflect: true
})], Button.prototype, "value", void 0);
__decorate([e$2('.button')], Button.prototype, "buttonElement", void 0);
__decorate([o$2({
  slot: 'icon',
  flatten: true
})], Button.prototype, "assignedIcons", void 0);

/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * A filled button component.
 */
class FilledButton extends Button {
  renderElevationOrOutline() {
    return b`<md-elevation part="elevation"></md-elevation>`;
  }
}

/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// Generated stylesheet for ./button/internal/filled-styles.css.
const styles$7 = i$6`:host{--_container-color: var(--md-filled-button-container-color, var(--md-sys-color-primary, #6750a4));--_container-elevation: var(--md-filled-button-container-elevation, 0);--_container-height: var(--md-filled-button-container-height, 40px);--_container-shadow-color: var(--md-filled-button-container-shadow-color, var(--md-sys-color-shadow, #000));--_disabled-container-color: var(--md-filled-button-disabled-container-color, var(--md-sys-color-on-surface, #1d1b20));--_disabled-container-elevation: var(--md-filled-button-disabled-container-elevation, 0);--_disabled-container-opacity: var(--md-filled-button-disabled-container-opacity, 0.12);--_disabled-label-text-color: var(--md-filled-button-disabled-label-text-color, var(--md-sys-color-on-surface, #1d1b20));--_disabled-label-text-opacity: var(--md-filled-button-disabled-label-text-opacity, 0.38);--_focus-container-elevation: var(--md-filled-button-focus-container-elevation, 0);--_focus-label-text-color: var(--md-filled-button-focus-label-text-color, var(--md-sys-color-on-primary, #fff));--_hover-container-elevation: var(--md-filled-button-hover-container-elevation, 1);--_hover-label-text-color: var(--md-filled-button-hover-label-text-color, var(--md-sys-color-on-primary, #fff));--_hover-state-layer-color: var(--md-filled-button-hover-state-layer-color, var(--md-sys-color-on-primary, #fff));--_hover-state-layer-opacity: var(--md-filled-button-hover-state-layer-opacity, 0.08);--_label-text-color: var(--md-filled-button-label-text-color, var(--md-sys-color-on-primary, #fff));--_label-text-font: var(--md-filled-button-label-text-font, var(--md-sys-typescale-label-large-font, var(--md-ref-typeface-plain, Roboto)));--_label-text-line-height: var(--md-filled-button-label-text-line-height, var(--md-sys-typescale-label-large-line-height, 1.25rem));--_label-text-size: var(--md-filled-button-label-text-size, var(--md-sys-typescale-label-large-size, 0.875rem));--_label-text-weight: var(--md-filled-button-label-text-weight, var(--md-sys-typescale-label-large-weight, var(--md-ref-typeface-weight-medium, 500)));--_pressed-container-elevation: var(--md-filled-button-pressed-container-elevation, 0);--_pressed-label-text-color: var(--md-filled-button-pressed-label-text-color, var(--md-sys-color-on-primary, #fff));--_pressed-state-layer-color: var(--md-filled-button-pressed-state-layer-color, var(--md-sys-color-on-primary, #fff));--_pressed-state-layer-opacity: var(--md-filled-button-pressed-state-layer-opacity, 0.12);--_disabled-icon-color: var(--md-filled-button-disabled-icon-color, var(--md-sys-color-on-surface, #1d1b20));--_disabled-icon-opacity: var(--md-filled-button-disabled-icon-opacity, 0.38);--_focus-icon-color: var(--md-filled-button-focus-icon-color, var(--md-sys-color-on-primary, #fff));--_hover-icon-color: var(--md-filled-button-hover-icon-color, var(--md-sys-color-on-primary, #fff));--_icon-color: var(--md-filled-button-icon-color, var(--md-sys-color-on-primary, #fff));--_icon-size: var(--md-filled-button-icon-size, 18px);--_pressed-icon-color: var(--md-filled-button-pressed-icon-color, var(--md-sys-color-on-primary, #fff));--_container-shape-start-start: var(--md-filled-button-container-shape-start-start, var(--md-filled-button-container-shape, var(--md-sys-shape-corner-full, 9999px)));--_container-shape-start-end: var(--md-filled-button-container-shape-start-end, var(--md-filled-button-container-shape, var(--md-sys-shape-corner-full, 9999px)));--_container-shape-end-end: var(--md-filled-button-container-shape-end-end, var(--md-filled-button-container-shape, var(--md-sys-shape-corner-full, 9999px)));--_container-shape-end-start: var(--md-filled-button-container-shape-end-start, var(--md-filled-button-container-shape, var(--md-sys-shape-corner-full, 9999px)));--_leading-space: var(--md-filled-button-leading-space, 24px);--_trailing-space: var(--md-filled-button-trailing-space, 24px);--_with-leading-icon-leading-space: var(--md-filled-button-with-leading-icon-leading-space, 16px);--_with-leading-icon-trailing-space: var(--md-filled-button-with-leading-icon-trailing-space, 24px);--_with-trailing-icon-leading-space: var(--md-filled-button-with-trailing-icon-leading-space, 24px);--_with-trailing-icon-trailing-space: var(--md-filled-button-with-trailing-icon-trailing-space, 16px)}
`;

/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// Generated stylesheet for ./button/internal/shared-elevation-styles.css.
const styles$6 = i$6`md-elevation{transition-duration:280ms}:host(:is([disabled],[soft-disabled])) md-elevation{transition:none}md-elevation{--md-elevation-level: var(--_container-elevation);--md-elevation-shadow-color: var(--_container-shadow-color)}:host(:focus-within) md-elevation{--md-elevation-level: var(--_focus-container-elevation)}:host(:hover) md-elevation{--md-elevation-level: var(--_hover-container-elevation)}:host(:active) md-elevation{--md-elevation-level: var(--_pressed-container-elevation)}:host(:is([disabled],[soft-disabled])) md-elevation{--md-elevation-level: var(--_disabled-container-elevation)}
`;

/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// Generated stylesheet for ./button/internal/shared-styles.css.
const styles$5 = i$6`:host{border-start-start-radius:var(--_container-shape-start-start);border-start-end-radius:var(--_container-shape-start-end);border-end-start-radius:var(--_container-shape-end-start);border-end-end-radius:var(--_container-shape-end-end);box-sizing:border-box;cursor:pointer;display:inline-flex;gap:8px;min-height:var(--_container-height);outline:none;padding-block:calc((var(--_container-height) - max(var(--_label-text-line-height),var(--_icon-size)))/2);padding-inline-start:var(--_leading-space);padding-inline-end:var(--_trailing-space);place-content:center;place-items:center;position:relative;font-family:var(--_label-text-font);font-size:var(--_label-text-size);line-height:var(--_label-text-line-height);font-weight:var(--_label-text-weight);text-overflow:ellipsis;text-wrap:nowrap;user-select:none;-webkit-tap-highlight-color:rgba(0,0,0,0);vertical-align:top;--md-ripple-hover-color: var(--_hover-state-layer-color);--md-ripple-pressed-color: var(--_pressed-state-layer-color);--md-ripple-hover-opacity: var(--_hover-state-layer-opacity);--md-ripple-pressed-opacity: var(--_pressed-state-layer-opacity)}md-focus-ring{--md-focus-ring-shape-start-start: var(--_container-shape-start-start);--md-focus-ring-shape-start-end: var(--_container-shape-start-end);--md-focus-ring-shape-end-end: var(--_container-shape-end-end);--md-focus-ring-shape-end-start: var(--_container-shape-end-start)}:host(:is([disabled],[soft-disabled])){cursor:default;pointer-events:none}.button{border-radius:inherit;cursor:inherit;display:inline-flex;align-items:center;justify-content:center;border:none;outline:none;-webkit-appearance:none;vertical-align:middle;background:rgba(0,0,0,0);text-decoration:none;min-width:calc(64px - var(--_leading-space) - var(--_trailing-space));width:100%;z-index:0;height:100%;font:inherit;color:var(--_label-text-color);padding:0;gap:inherit;text-transform:inherit}.button::-moz-focus-inner{padding:0;border:0}:host(:hover) .button{color:var(--_hover-label-text-color)}:host(:focus-within) .button{color:var(--_focus-label-text-color)}:host(:active) .button{color:var(--_pressed-label-text-color)}.background{background:var(--_container-color);border-radius:inherit;inset:0;position:absolute}.label{overflow:hidden}:is(.button,.label,.label slot),.label ::slotted(*){text-overflow:inherit}:host(:is([disabled],[soft-disabled])) .label{color:var(--_disabled-label-text-color);opacity:var(--_disabled-label-text-opacity)}:host(:is([disabled],[soft-disabled])) .background{background:var(--_disabled-container-color);opacity:var(--_disabled-container-opacity)}@media(forced-colors: active){.background{border:1px solid CanvasText}:host(:is([disabled],[soft-disabled])){--_disabled-icon-color: GrayText;--_disabled-icon-opacity: 1;--_disabled-container-opacity: 1;--_disabled-label-text-color: GrayText;--_disabled-label-text-opacity: 1}}:host([has-icon]:not([trailing-icon])){padding-inline-start:var(--_with-leading-icon-leading-space);padding-inline-end:var(--_with-leading-icon-trailing-space)}:host([has-icon][trailing-icon]){padding-inline-start:var(--_with-trailing-icon-leading-space);padding-inline-end:var(--_with-trailing-icon-trailing-space)}::slotted([slot=icon]){display:inline-flex;position:relative;writing-mode:horizontal-tb;fill:currentColor;flex-shrink:0;color:var(--_icon-color);font-size:var(--_icon-size);inline-size:var(--_icon-size);block-size:var(--_icon-size)}:host(:hover) ::slotted([slot=icon]){color:var(--_hover-icon-color)}:host(:focus-within) ::slotted([slot=icon]){color:var(--_focus-icon-color)}:host(:active) ::slotted([slot=icon]){color:var(--_pressed-icon-color)}:host(:is([disabled],[soft-disabled])) ::slotted([slot=icon]){color:var(--_disabled-icon-color);opacity:var(--_disabled-icon-opacity)}.touch{position:absolute;top:50%;height:48px;left:0;right:0;transform:translateY(-50%)}:host([touch-target=wrapper]){margin:max(0px,(48px - var(--_container-height))/2) 0}:host([touch-target=none]) .touch{display:none}
`;

/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @summary Buttons help people take action, such as sending an email, sharing a
 * document, or liking a comment.
 *
 * @description
 * __Emphasis:__ High emphasis – For the primary, most important, or most common
 * action on a screen
 *
 * __Rationale:__ The filled button’s contrasting surface color makes it the
 * most prominent button after the FAB. It’s used for final or unblocking
 * actions in a flow.
 *
 * __Example usages:__
 * - Save
 * - Confirm
 * - Done
 *
 * @final
 * @suppress {visibility}
 */
let MdFilledButton = class MdFilledButton extends FilledButton {};
MdFilledButton.styles = [styles$5, styles$6, styles$7];
MdFilledButton = __decorate([t$1('md-filled-button')], MdFilledButton);

/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * A field component.
 */
class Field extends i$3 {
  constructor() {
    super(...arguments);
    this.disabled = false;
    this.error = false;
    this.focused = false;
    this.label = '';
    this.noAsterisk = false;
    this.populated = false;
    this.required = false;
    this.resizable = false;
    this.supportingText = '';
    this.errorText = '';
    this.count = -1;
    this.max = -1;
    /**
     * Whether or not the field has leading content.
     */
    this.hasStart = false;
    /**
     * Whether or not the field has trailing content.
     */
    this.hasEnd = false;
    this.isAnimating = false;
    /**
     * When set to true, the error text's `role="alert"` will be removed, then
     * re-added after an animation frame. This will re-announce an error message
     * to screen readers.
     */
    this.refreshErrorAlert = false;
    this.disableTransitions = false;
  }
  get counterText() {
    // Count and max are typed as number, but can be set to null when Lit removes
    // their attributes. These getters coerce back to a number for calculations.
    const countAsNumber = this.count ?? -1;
    const maxAsNumber = this.max ?? -1;
    // Counter does not show if count is negative, or max is negative or 0.
    if (countAsNumber < 0 || maxAsNumber <= 0) {
      return '';
    }
    return `${countAsNumber} / ${maxAsNumber}`;
  }
  get supportingOrErrorText() {
    return this.error && this.errorText ? this.errorText : this.supportingText;
  }
  /**
   * Re-announces the field's error supporting text to screen readers.
   *
   * Error text announces to screen readers anytime it is visible and changes.
   * Use the method to re-announce the message when the text has not changed,
   * but announcement is still needed (such as for `reportValidity()`).
   */
  reannounceError() {
    this.refreshErrorAlert = true;
  }
  update(props) {
    // Client-side property updates
    const isDisabledChanging = props.has('disabled') && props.get('disabled') !== undefined;
    if (isDisabledChanging) {
      this.disableTransitions = true;
    }
    // When disabling, remove focus styles if focused.
    if (this.disabled && this.focused) {
      props.set('focused', true);
      this.focused = false;
    }
    // Animate if focused or populated change.
    this.animateLabelIfNeeded({
      wasFocused: props.get('focused'),
      wasPopulated: props.get('populated')
    });
    super.update(props);
  }
  render() {
    const floatingLabel = this.renderLabel(/*isFloating*/true);
    const restingLabel = this.renderLabel(/*isFloating*/false);
    const outline = this.renderOutline?.(floatingLabel);
    const classes = {
      'disabled': this.disabled,
      'disable-transitions': this.disableTransitions,
      'error': this.error && !this.disabled,
      'focused': this.focused,
      'with-start': this.hasStart,
      'with-end': this.hasEnd,
      'populated': this.populated,
      'resizable': this.resizable,
      'required': this.required,
      'no-label': !this.label
    };
    return b`
      <div class="field ${e(classes)}">
        <div class="container-overflow">
          ${this.renderBackground?.()}
          <slot name="container"></slot>
          ${this.renderStateLayer?.()} ${this.renderIndicator?.()} ${outline}
          <div class="container">
            <div class="start">
              <slot name="start"></slot>
            </div>
            <div class="middle">
              <div class="label-wrapper">
                ${restingLabel} ${outline ? A : floatingLabel}
              </div>
              <div class="content">
                <slot></slot>
              </div>
            </div>
            <div class="end">
              <slot name="end"></slot>
            </div>
          </div>
        </div>
        ${this.renderSupportingText()}
      </div>
    `;
  }
  updated(changed) {
    if (changed.has('supportingText') || changed.has('errorText') || changed.has('count') || changed.has('max')) {
      this.updateSlottedAriaDescribedBy();
    }
    if (this.refreshErrorAlert) {
      // The past render cycle removed the role="alert" from the error message.
      // Re-add it after an animation frame to re-announce the error.
      requestAnimationFrame(() => {
        this.refreshErrorAlert = false;
      });
    }
    if (this.disableTransitions) {
      requestAnimationFrame(() => {
        this.disableTransitions = false;
      });
    }
  }
  renderSupportingText() {
    const {
      supportingOrErrorText,
      counterText
    } = this;
    if (!supportingOrErrorText && !counterText) {
      return A;
    }
    // Always render the supporting text span so that our `space-around`
    // container puts the counter at the end.
    const start = b`<span>${supportingOrErrorText}</span>`;
    // Conditionally render counter so we don't render the extra `gap`.
    // TODO(b/244473435): add aria-label and announcements
    const end = counterText ? b`<span class="counter">${counterText}</span>` : A;
    // Announce if there is an error and error text visible.
    // If refreshErrorAlert is true, do not announce. This will remove the
    // role="alert" attribute. Another render cycle will happen after an
    // animation frame to re-add the role.
    const shouldErrorAnnounce = this.error && this.errorText && !this.refreshErrorAlert;
    const role = shouldErrorAnnounce ? 'alert' : A;
    return b`
      <div class="supporting-text" role=${role}>${start}${end}</div>
      <slot
        name="aria-describedby"
        @slotchange=${this.updateSlottedAriaDescribedBy}></slot>
    `;
  }
  updateSlottedAriaDescribedBy() {
    for (const element of this.slottedAriaDescribedBy) {
      D(b`${this.supportingOrErrorText} ${this.counterText}`, element);
      element.setAttribute('hidden', '');
    }
  }
  renderLabel(isFloating) {
    if (!this.label) {
      return A;
    }
    let visible;
    if (isFloating) {
      // Floating label is visible when focused/populated or when animating.
      visible = this.focused || this.populated || this.isAnimating;
    } else {
      // Resting label is visible when unfocused. It is never visible while
      // animating.
      visible = !this.focused && !this.populated && !this.isAnimating;
    }
    const classes = {
      'hidden': !visible,
      'floating': isFloating,
      'resting': !isFloating
    };
    // Add '*' if a label is present and the field is required
    const labelText = `${this.label}${this.required && !this.noAsterisk ? '*' : ''}`;
    return b`
      <span class="label ${e(classes)}" aria-hidden=${!visible}
        >${labelText}</span
      >
    `;
  }
  animateLabelIfNeeded({
    wasFocused,
    wasPopulated
  }) {
    if (!this.label) {
      return;
    }
    wasFocused ?? (wasFocused = this.focused);
    wasPopulated ?? (wasPopulated = this.populated);
    const wasFloating = wasFocused || wasPopulated;
    const shouldBeFloating = this.focused || this.populated;
    if (wasFloating === shouldBeFloating) {
      return;
    }
    this.isAnimating = true;
    this.labelAnimation?.cancel();
    // Only one label is visible at a time for clearer text rendering.
    // The floating label is visible and used during animation. At the end of
    // the animation, it will either remain visible (if floating) or hide and
    // the resting label will be shown.
    //
    // We don't use forward filling because if the dimensions of the text field
    // change (leading icon removed, density changes, etc), then the animation
    // will be inaccurate.
    //
    // Re-calculating the animation each time will prevent any visual glitches
    // from appearing.
    // TODO(b/241113345): use animation tokens
    this.labelAnimation = this.floatingLabelEl?.animate(this.getLabelKeyframes(), {
      duration: 150,
      easing: EASING.STANDARD
    });
    this.labelAnimation?.addEventListener('finish', () => {
      // At the end of the animation, update the visible label.
      this.isAnimating = false;
    });
  }
  getLabelKeyframes() {
    const {
      floatingLabelEl,
      restingLabelEl
    } = this;
    if (!floatingLabelEl || !restingLabelEl) {
      return [];
    }
    const {
      x: floatingX,
      y: floatingY,
      height: floatingHeight
    } = floatingLabelEl.getBoundingClientRect();
    const {
      x: restingX,
      y: restingY,
      height: restingHeight
    } = restingLabelEl.getBoundingClientRect();
    const floatingScrollWidth = floatingLabelEl.scrollWidth;
    const restingScrollWidth = restingLabelEl.scrollWidth;
    // Scale by width ratio instead of font size since letter-spacing will scale
    // incorrectly. Using the width we can better approximate the adjusted
    // scale and compensate for tracking and overflow.
    // (use scrollWidth instead of width to account for clipped labels)
    const scale = restingScrollWidth / floatingScrollWidth;
    const xDelta = restingX - floatingX;
    // The line-height of the resting and floating label are different. When
    // we move the floating label down to the resting label's position, it won't
    // exactly match because of this. We need to adjust by half of what the
    // final scaled floating label's height will be.
    const yDelta = restingY - floatingY + Math.round((restingHeight - floatingHeight * scale) / 2);
    // Create the two transforms: floating to resting (using the calculations
    // above), and resting to floating (re-setting the transform to initial
    // values).
    const restTransform = `translateX(${xDelta}px) translateY(${yDelta}px) scale(${scale})`;
    const floatTransform = `translateX(0) translateY(0) scale(1)`;
    // Constrain the floating labels width to a scaled percentage of the
    // resting label's width. This will prevent long clipped labels from
    // overflowing the container.
    const restingClientWidth = restingLabelEl.clientWidth;
    const isRestingClipped = restingScrollWidth > restingClientWidth;
    const width = isRestingClipped ? `${restingClientWidth / scale}px` : '';
    if (this.focused || this.populated) {
      return [{
        transform: restTransform,
        width
      }, {
        transform: floatTransform,
        width
      }];
    }
    return [{
      transform: floatTransform,
      width
    }, {
      transform: restTransform,
      width
    }];
  }
  getSurfacePositionClientRect() {
    return this.containerEl.getBoundingClientRect();
  }
}
__decorate([n$2({
  type: Boolean
})], Field.prototype, "disabled", void 0);
__decorate([n$2({
  type: Boolean
})], Field.prototype, "error", void 0);
__decorate([n$2({
  type: Boolean
})], Field.prototype, "focused", void 0);
__decorate([n$2()], Field.prototype, "label", void 0);
__decorate([n$2({
  type: Boolean,
  attribute: 'no-asterisk'
})], Field.prototype, "noAsterisk", void 0);
__decorate([n$2({
  type: Boolean
})], Field.prototype, "populated", void 0);
__decorate([n$2({
  type: Boolean
})], Field.prototype, "required", void 0);
__decorate([n$2({
  type: Boolean
})], Field.prototype, "resizable", void 0);
__decorate([n$2({
  attribute: 'supporting-text'
})], Field.prototype, "supportingText", void 0);
__decorate([n$2({
  attribute: 'error-text'
})], Field.prototype, "errorText", void 0);
__decorate([n$2({
  type: Number
})], Field.prototype, "count", void 0);
__decorate([n$2({
  type: Number
})], Field.prototype, "max", void 0);
__decorate([n$2({
  type: Boolean,
  attribute: 'has-start'
})], Field.prototype, "hasStart", void 0);
__decorate([n$2({
  type: Boolean,
  attribute: 'has-end'
})], Field.prototype, "hasEnd", void 0);
__decorate([o$2({
  slot: 'aria-describedby'
})], Field.prototype, "slottedAriaDescribedBy", void 0);
__decorate([r$1()], Field.prototype, "isAnimating", void 0);
__decorate([r$1()], Field.prototype, "refreshErrorAlert", void 0);
__decorate([r$1()], Field.prototype, "disableTransitions", void 0);
__decorate([e$2('.label.floating')], Field.prototype, "floatingLabelEl", void 0);
__decorate([e$2('.label.resting')], Field.prototype, "restingLabelEl", void 0);
__decorate([e$2('.container')], Field.prototype, "containerEl", void 0);

/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * An outlined field component.
 */
class OutlinedField extends Field {
  renderOutline(floatingLabel) {
    return b`
      <div class="outline">
        <div class="outline-start"></div>
        <div class="outline-notch">
          <div class="outline-panel-inactive"></div>
          <div class="outline-panel-active"></div>
          <div class="outline-label">${floatingLabel}</div>
        </div>
        <div class="outline-end"></div>
      </div>
    `;
  }
}

/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// Generated stylesheet for ./field/internal/outlined-styles.css.
const styles$4 = i$6`@layer styles{:host{--_bottom-space: var(--md-outlined-field-bottom-space, 16px);--_content-color: var(--md-outlined-field-content-color, var(--md-sys-color-on-surface, #1d1b20));--_content-font: var(--md-outlined-field-content-font, var(--md-sys-typescale-body-large-font, var(--md-ref-typeface-plain, Roboto)));--_content-line-height: var(--md-outlined-field-content-line-height, var(--md-sys-typescale-body-large-line-height, 1.5rem));--_content-size: var(--md-outlined-field-content-size, var(--md-sys-typescale-body-large-size, 1rem));--_content-space: var(--md-outlined-field-content-space, 16px);--_content-weight: var(--md-outlined-field-content-weight, var(--md-sys-typescale-body-large-weight, var(--md-ref-typeface-weight-regular, 400)));--_disabled-content-color: var(--md-outlined-field-disabled-content-color, var(--md-sys-color-on-surface, #1d1b20));--_disabled-content-opacity: var(--md-outlined-field-disabled-content-opacity, 0.38);--_disabled-label-text-color: var(--md-outlined-field-disabled-label-text-color, var(--md-sys-color-on-surface, #1d1b20));--_disabled-label-text-opacity: var(--md-outlined-field-disabled-label-text-opacity, 0.38);--_disabled-leading-content-color: var(--md-outlined-field-disabled-leading-content-color, var(--md-sys-color-on-surface, #1d1b20));--_disabled-leading-content-opacity: var(--md-outlined-field-disabled-leading-content-opacity, 0.38);--_disabled-outline-color: var(--md-outlined-field-disabled-outline-color, var(--md-sys-color-on-surface, #1d1b20));--_disabled-outline-opacity: var(--md-outlined-field-disabled-outline-opacity, 0.12);--_disabled-outline-width: var(--md-outlined-field-disabled-outline-width, 1px);--_disabled-supporting-text-color: var(--md-outlined-field-disabled-supporting-text-color, var(--md-sys-color-on-surface, #1d1b20));--_disabled-supporting-text-opacity: var(--md-outlined-field-disabled-supporting-text-opacity, 0.38);--_disabled-trailing-content-color: var(--md-outlined-field-disabled-trailing-content-color, var(--md-sys-color-on-surface, #1d1b20));--_disabled-trailing-content-opacity: var(--md-outlined-field-disabled-trailing-content-opacity, 0.38);--_error-content-color: var(--md-outlined-field-error-content-color, var(--md-sys-color-on-surface, #1d1b20));--_error-focus-content-color: var(--md-outlined-field-error-focus-content-color, var(--md-sys-color-on-surface, #1d1b20));--_error-focus-label-text-color: var(--md-outlined-field-error-focus-label-text-color, var(--md-sys-color-error, #b3261e));--_error-focus-leading-content-color: var(--md-outlined-field-error-focus-leading-content-color, var(--md-sys-color-on-surface-variant, #49454f));--_error-focus-outline-color: var(--md-outlined-field-error-focus-outline-color, var(--md-sys-color-error, #b3261e));--_error-focus-supporting-text-color: var(--md-outlined-field-error-focus-supporting-text-color, var(--md-sys-color-error, #b3261e));--_error-focus-trailing-content-color: var(--md-outlined-field-error-focus-trailing-content-color, var(--md-sys-color-error, #b3261e));--_error-hover-content-color: var(--md-outlined-field-error-hover-content-color, var(--md-sys-color-on-surface, #1d1b20));--_error-hover-label-text-color: var(--md-outlined-field-error-hover-label-text-color, var(--md-sys-color-on-error-container, #410e0b));--_error-hover-leading-content-color: var(--md-outlined-field-error-hover-leading-content-color, var(--md-sys-color-on-surface-variant, #49454f));--_error-hover-outline-color: var(--md-outlined-field-error-hover-outline-color, var(--md-sys-color-on-error-container, #410e0b));--_error-hover-supporting-text-color: var(--md-outlined-field-error-hover-supporting-text-color, var(--md-sys-color-error, #b3261e));--_error-hover-trailing-content-color: var(--md-outlined-field-error-hover-trailing-content-color, var(--md-sys-color-on-error-container, #410e0b));--_error-label-text-color: var(--md-outlined-field-error-label-text-color, var(--md-sys-color-error, #b3261e));--_error-leading-content-color: var(--md-outlined-field-error-leading-content-color, var(--md-sys-color-on-surface-variant, #49454f));--_error-outline-color: var(--md-outlined-field-error-outline-color, var(--md-sys-color-error, #b3261e));--_error-supporting-text-color: var(--md-outlined-field-error-supporting-text-color, var(--md-sys-color-error, #b3261e));--_error-trailing-content-color: var(--md-outlined-field-error-trailing-content-color, var(--md-sys-color-error, #b3261e));--_focus-content-color: var(--md-outlined-field-focus-content-color, var(--md-sys-color-on-surface, #1d1b20));--_focus-label-text-color: var(--md-outlined-field-focus-label-text-color, var(--md-sys-color-primary, #6750a4));--_focus-leading-content-color: var(--md-outlined-field-focus-leading-content-color, var(--md-sys-color-on-surface-variant, #49454f));--_focus-outline-color: var(--md-outlined-field-focus-outline-color, var(--md-sys-color-primary, #6750a4));--_focus-outline-width: var(--md-outlined-field-focus-outline-width, 3px);--_focus-supporting-text-color: var(--md-outlined-field-focus-supporting-text-color, var(--md-sys-color-on-surface-variant, #49454f));--_focus-trailing-content-color: var(--md-outlined-field-focus-trailing-content-color, var(--md-sys-color-on-surface-variant, #49454f));--_hover-content-color: var(--md-outlined-field-hover-content-color, var(--md-sys-color-on-surface, #1d1b20));--_hover-label-text-color: var(--md-outlined-field-hover-label-text-color, var(--md-sys-color-on-surface, #1d1b20));--_hover-leading-content-color: var(--md-outlined-field-hover-leading-content-color, var(--md-sys-color-on-surface-variant, #49454f));--_hover-outline-color: var(--md-outlined-field-hover-outline-color, var(--md-sys-color-on-surface, #1d1b20));--_hover-outline-width: var(--md-outlined-field-hover-outline-width, 1px);--_hover-supporting-text-color: var(--md-outlined-field-hover-supporting-text-color, var(--md-sys-color-on-surface-variant, #49454f));--_hover-trailing-content-color: var(--md-outlined-field-hover-trailing-content-color, var(--md-sys-color-on-surface-variant, #49454f));--_label-text-color: var(--md-outlined-field-label-text-color, var(--md-sys-color-on-surface-variant, #49454f));--_label-text-font: var(--md-outlined-field-label-text-font, var(--md-sys-typescale-body-large-font, var(--md-ref-typeface-plain, Roboto)));--_label-text-line-height: var(--md-outlined-field-label-text-line-height, var(--md-sys-typescale-body-large-line-height, 1.5rem));--_label-text-padding-bottom: var(--md-outlined-field-label-text-padding-bottom, 8px);--_label-text-populated-line-height: var(--md-outlined-field-label-text-populated-line-height, var(--md-sys-typescale-body-small-line-height, 1rem));--_label-text-populated-size: var(--md-outlined-field-label-text-populated-size, var(--md-sys-typescale-body-small-size, 0.75rem));--_label-text-size: var(--md-outlined-field-label-text-size, var(--md-sys-typescale-body-large-size, 1rem));--_label-text-weight: var(--md-outlined-field-label-text-weight, var(--md-sys-typescale-body-large-weight, var(--md-ref-typeface-weight-regular, 400)));--_leading-content-color: var(--md-outlined-field-leading-content-color, var(--md-sys-color-on-surface-variant, #49454f));--_leading-space: var(--md-outlined-field-leading-space, 16px);--_outline-color: var(--md-outlined-field-outline-color, var(--md-sys-color-outline, #79747e));--_outline-label-padding: var(--md-outlined-field-outline-label-padding, 4px);--_outline-width: var(--md-outlined-field-outline-width, 1px);--_supporting-text-color: var(--md-outlined-field-supporting-text-color, var(--md-sys-color-on-surface-variant, #49454f));--_supporting-text-font: var(--md-outlined-field-supporting-text-font, var(--md-sys-typescale-body-small-font, var(--md-ref-typeface-plain, Roboto)));--_supporting-text-leading-space: var(--md-outlined-field-supporting-text-leading-space, 16px);--_supporting-text-line-height: var(--md-outlined-field-supporting-text-line-height, var(--md-sys-typescale-body-small-line-height, 1rem));--_supporting-text-size: var(--md-outlined-field-supporting-text-size, var(--md-sys-typescale-body-small-size, 0.75rem));--_supporting-text-top-space: var(--md-outlined-field-supporting-text-top-space, 4px);--_supporting-text-trailing-space: var(--md-outlined-field-supporting-text-trailing-space, 16px);--_supporting-text-weight: var(--md-outlined-field-supporting-text-weight, var(--md-sys-typescale-body-small-weight, var(--md-ref-typeface-weight-regular, 400)));--_top-space: var(--md-outlined-field-top-space, 16px);--_trailing-content-color: var(--md-outlined-field-trailing-content-color, var(--md-sys-color-on-surface-variant, #49454f));--_trailing-space: var(--md-outlined-field-trailing-space, 16px);--_with-leading-content-leading-space: var(--md-outlined-field-with-leading-content-leading-space, 12px);--_with-trailing-content-trailing-space: var(--md-outlined-field-with-trailing-content-trailing-space, 12px);--_container-shape-start-start: var(--md-outlined-field-container-shape-start-start, var(--md-outlined-field-container-shape, var(--md-sys-shape-corner-extra-small, 4px)));--_container-shape-start-end: var(--md-outlined-field-container-shape-start-end, var(--md-outlined-field-container-shape, var(--md-sys-shape-corner-extra-small, 4px)));--_container-shape-end-end: var(--md-outlined-field-container-shape-end-end, var(--md-outlined-field-container-shape, var(--md-sys-shape-corner-extra-small, 4px)));--_container-shape-end-start: var(--md-outlined-field-container-shape-end-start, var(--md-outlined-field-container-shape, var(--md-sys-shape-corner-extra-small, 4px)))}.outline{border-color:var(--_outline-color);border-radius:inherit;display:flex;pointer-events:none;height:100%;position:absolute;width:100%;z-index:1}.outline-start::before,.outline-start::after,.outline-panel-inactive::before,.outline-panel-inactive::after,.outline-panel-active::before,.outline-panel-active::after,.outline-end::before,.outline-end::after{border:inherit;content:"";inset:0;position:absolute}.outline-start,.outline-end{border:inherit;border-radius:inherit;box-sizing:border-box;position:relative}.outline-start::before,.outline-start::after,.outline-end::before,.outline-end::after{border-bottom-style:solid;border-top-style:solid}.outline-start::after,.outline-end::after{opacity:0;transition:opacity 150ms cubic-bezier(0.2, 0, 0, 1)}.focused .outline-start::after,.focused .outline-end::after{opacity:1}.outline-start::before,.outline-start::after{border-inline-start-style:solid;border-inline-end-style:none;border-start-start-radius:inherit;border-start-end-radius:0;border-end-start-radius:inherit;border-end-end-radius:0;margin-inline-end:var(--_outline-label-padding)}.outline-end{flex-grow:1;margin-inline-start:calc(-1*var(--_outline-label-padding))}.outline-end::before,.outline-end::after{border-inline-start-style:none;border-inline-end-style:solid;border-start-start-radius:0;border-start-end-radius:inherit;border-end-start-radius:0;border-end-end-radius:inherit}.outline-notch{align-items:flex-start;border:inherit;display:flex;margin-inline-start:calc(-1*var(--_outline-label-padding));margin-inline-end:var(--_outline-label-padding);max-width:calc(100% - var(--_leading-space) - var(--_trailing-space));padding:0 var(--_outline-label-padding);position:relative}.no-label .outline-notch{display:none}.outline-panel-inactive,.outline-panel-active{border:inherit;border-bottom-style:solid;inset:0;position:absolute}.outline-panel-inactive::before,.outline-panel-inactive::after,.outline-panel-active::before,.outline-panel-active::after{border-top-style:solid;border-bottom:none;bottom:auto;transform:scaleX(1);transition:transform 150ms cubic-bezier(0.2, 0, 0, 1)}.outline-panel-inactive::before,.outline-panel-active::before{right:50%;transform-origin:top left}.outline-panel-inactive::after,.outline-panel-active::after{left:50%;transform-origin:top right}.populated .outline-panel-inactive::before,.populated .outline-panel-inactive::after,.populated .outline-panel-active::before,.populated .outline-panel-active::after,.focused .outline-panel-inactive::before,.focused .outline-panel-inactive::after,.focused .outline-panel-active::before,.focused .outline-panel-active::after{transform:scaleX(0)}.outline-panel-active{opacity:0;transition:opacity 150ms cubic-bezier(0.2, 0, 0, 1)}.focused .outline-panel-active{opacity:1}.outline-label{display:flex;max-width:100%;transform:translateY(calc(-100% + var(--_label-text-padding-bottom)))}.outline-start,.field:not(.with-start) .content ::slotted(*){padding-inline-start:max(var(--_leading-space),max(var(--_container-shape-start-start),var(--_container-shape-end-start)) + var(--_outline-label-padding))}.field:not(.with-start) .label-wrapper{margin-inline-start:max(var(--_leading-space),max(var(--_container-shape-start-start),var(--_container-shape-end-start)) + var(--_outline-label-padding))}.field:not(.with-end) .content ::slotted(*){padding-inline-end:max(var(--_trailing-space),max(var(--_container-shape-start-end),var(--_container-shape-end-end)))}.field:not(.with-end) .label-wrapper{margin-inline-end:max(var(--_trailing-space),max(var(--_container-shape-start-end),var(--_container-shape-end-end)))}.outline-start::before,.outline-end::before,.outline-panel-inactive,.outline-panel-inactive::before,.outline-panel-inactive::after{border-width:var(--_outline-width)}:hover .outline{border-color:var(--_hover-outline-color);color:var(--_hover-outline-color)}:hover .outline-start::before,:hover .outline-end::before,:hover .outline-panel-inactive,:hover .outline-panel-inactive::before,:hover .outline-panel-inactive::after{border-width:var(--_hover-outline-width)}.focused .outline{border-color:var(--_focus-outline-color);color:var(--_focus-outline-color)}.outline-start::after,.outline-end::after,.outline-panel-active,.outline-panel-active::before,.outline-panel-active::after{border-width:var(--_focus-outline-width)}.disabled .outline{border-color:var(--_disabled-outline-color);color:var(--_disabled-outline-color)}.disabled .outline-start,.disabled .outline-end,.disabled .outline-panel-inactive{opacity:var(--_disabled-outline-opacity)}.disabled .outline-start::before,.disabled .outline-end::before,.disabled .outline-panel-inactive,.disabled .outline-panel-inactive::before,.disabled .outline-panel-inactive::after{border-width:var(--_disabled-outline-width)}.error .outline{border-color:var(--_error-outline-color);color:var(--_error-outline-color)}.error:hover .outline{border-color:var(--_error-hover-outline-color);color:var(--_error-hover-outline-color)}.error.focused .outline{border-color:var(--_error-focus-outline-color);color:var(--_error-focus-outline-color)}.resizable .container{bottom:var(--_focus-outline-width);inset-inline-end:var(--_focus-outline-width);clip-path:inset(var(--_focus-outline-width) 0 0 var(--_focus-outline-width))}.resizable .container>*{top:var(--_focus-outline-width);inset-inline-start:var(--_focus-outline-width)}.resizable .container:dir(rtl){clip-path:inset(var(--_focus-outline-width) var(--_focus-outline-width) 0 0)}}@layer hcm{@media(forced-colors: active){.disabled .outline{border-color:GrayText;color:GrayText}.disabled :is(.outline-start,.outline-end,.outline-panel-inactive){opacity:1}}}
`;

/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// Generated stylesheet for ./field/internal/shared-styles.css.
const styles$3 = i$6`:host{display:inline-flex;resize:both}.field{display:flex;flex:1;flex-direction:column;writing-mode:horizontal-tb;max-width:100%}.container-overflow{border-start-start-radius:var(--_container-shape-start-start);border-start-end-radius:var(--_container-shape-start-end);border-end-end-radius:var(--_container-shape-end-end);border-end-start-radius:var(--_container-shape-end-start);display:flex;height:100%;position:relative}.container{align-items:center;border-radius:inherit;display:flex;flex:1;max-height:100%;min-height:100%;min-width:min-content;position:relative}.field,.container-overflow{resize:inherit}.resizable:not(.disabled) .container{resize:inherit;overflow:hidden}.disabled{pointer-events:none}slot[name=container]{border-radius:inherit}slot[name=container]::slotted(*){border-radius:inherit;inset:0;pointer-events:none;position:absolute}@layer styles{.start,.middle,.end{display:flex;box-sizing:border-box;height:100%;position:relative}.start{color:var(--_leading-content-color)}.end{color:var(--_trailing-content-color)}.start,.end{align-items:center;justify-content:center}.with-start .start{margin-inline:var(--_with-leading-content-leading-space) var(--_content-space)}.with-end .end{margin-inline:var(--_content-space) var(--_with-trailing-content-trailing-space)}.middle{align-items:stretch;align-self:baseline;flex:1}.content{color:var(--_content-color);display:flex;flex:1;opacity:0;transition:opacity 83ms cubic-bezier(0.2, 0, 0, 1)}.no-label .content,.focused .content,.populated .content{opacity:1;transition-delay:67ms}:is(.disabled,.disable-transitions) .content{transition:none}.content ::slotted(*){all:unset;color:currentColor;font-family:var(--_content-font);font-size:var(--_content-size);line-height:var(--_content-line-height);font-weight:var(--_content-weight);width:100%;overflow-wrap:revert;white-space:revert}.content ::slotted(:not(textarea)){padding-top:var(--_top-space);padding-bottom:var(--_bottom-space)}.content ::slotted(textarea){margin-top:var(--_top-space);margin-bottom:var(--_bottom-space)}:hover .content{color:var(--_hover-content-color)}:hover .start{color:var(--_hover-leading-content-color)}:hover .end{color:var(--_hover-trailing-content-color)}.focused .content{color:var(--_focus-content-color)}.focused .start{color:var(--_focus-leading-content-color)}.focused .end{color:var(--_focus-trailing-content-color)}.disabled .content{color:var(--_disabled-content-color)}.disabled.no-label .content,.disabled.focused .content,.disabled.populated .content{opacity:var(--_disabled-content-opacity)}.disabled .start{color:var(--_disabled-leading-content-color);opacity:var(--_disabled-leading-content-opacity)}.disabled .end{color:var(--_disabled-trailing-content-color);opacity:var(--_disabled-trailing-content-opacity)}.error .content{color:var(--_error-content-color)}.error .start{color:var(--_error-leading-content-color)}.error .end{color:var(--_error-trailing-content-color)}.error:hover .content{color:var(--_error-hover-content-color)}.error:hover .start{color:var(--_error-hover-leading-content-color)}.error:hover .end{color:var(--_error-hover-trailing-content-color)}.error.focused .content{color:var(--_error-focus-content-color)}.error.focused .start{color:var(--_error-focus-leading-content-color)}.error.focused .end{color:var(--_error-focus-trailing-content-color)}}@layer hcm{@media(forced-colors: active){.disabled :is(.start,.content,.end){color:GrayText;opacity:1}}}@layer styles{.label{box-sizing:border-box;color:var(--_label-text-color);overflow:hidden;max-width:100%;text-overflow:ellipsis;white-space:nowrap;z-index:1;font-family:var(--_label-text-font);font-size:var(--_label-text-size);line-height:var(--_label-text-line-height);font-weight:var(--_label-text-weight);width:min-content}.label-wrapper{inset:0;pointer-events:none;position:absolute}.label.resting{position:absolute;top:var(--_top-space)}.label.floating{font-size:var(--_label-text-populated-size);line-height:var(--_label-text-populated-line-height);transform-origin:top left}.label.hidden{opacity:0}.no-label .label{display:none}.label-wrapper{inset:0;position:absolute;text-align:initial}:hover .label{color:var(--_hover-label-text-color)}.focused .label{color:var(--_focus-label-text-color)}.disabled .label{color:var(--_disabled-label-text-color)}.disabled .label:not(.hidden){opacity:var(--_disabled-label-text-opacity)}.error .label{color:var(--_error-label-text-color)}.error:hover .label{color:var(--_error-hover-label-text-color)}.error.focused .label{color:var(--_error-focus-label-text-color)}}@layer hcm{@media(forced-colors: active){.disabled .label:not(.hidden){color:GrayText;opacity:1}}}@layer styles{.supporting-text{color:var(--_supporting-text-color);display:flex;font-family:var(--_supporting-text-font);font-size:var(--_supporting-text-size);line-height:var(--_supporting-text-line-height);font-weight:var(--_supporting-text-weight);gap:16px;justify-content:space-between;padding-inline-start:var(--_supporting-text-leading-space);padding-inline-end:var(--_supporting-text-trailing-space);padding-top:var(--_supporting-text-top-space)}.supporting-text :nth-child(2){flex-shrink:0}:hover .supporting-text{color:var(--_hover-supporting-text-color)}.focus .supporting-text{color:var(--_focus-supporting-text-color)}.disabled .supporting-text{color:var(--_disabled-supporting-text-color);opacity:var(--_disabled-supporting-text-opacity)}.error .supporting-text{color:var(--_error-supporting-text-color)}.error:hover .supporting-text{color:var(--_error-hover-supporting-text-color)}.error.focus .supporting-text{color:var(--_error-focus-supporting-text-color)}}@layer hcm{@media(forced-colors: active){.disabled .supporting-text{color:GrayText;opacity:1}}}
`;

/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * TODO(b/228525797): add docs
 * @final
 * @suppress {visibility}
 */
let MdOutlinedField = class MdOutlinedField extends OutlinedField {};
MdOutlinedField.styles = [styles$3, styles$4];
MdOutlinedField = __decorate([t$1('md-outlined-field')], MdOutlinedField);

/**
 * @license
 * Copyright 2020 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const a = Symbol.for(""),
  o$1 = t => {
    if (t?.r === a) return t?._$litStatic$;
  },
  i$1 = (t, ...r) => ({
    _$litStatic$: r.reduce((r, e, a) => r + (t => {
      if (void 0 !== t._$litStatic$) return t._$litStatic$;
      throw Error(`Value passed to 'literal' function must be a 'literal' result: ${t}. Use 'unsafeStatic' to pass non-literal values, but\n            take care to ensure page security.`);
    })(e) + t[a + 1], t[0]),
    r: a
  }),
  l$1 = new Map(),
  n$1 = t => (r, ...e) => {
    const a = e.length;
    let s, i;
    const n = [],
      u = [];
    let c,
      $ = 0,
      f = false;
    for (; $ < a;) {
      for (c = r[$]; $ < a && void 0 !== (i = e[$], s = o$1(i));) c += s + r[++$], f = true;
      $ !== a && u.push(i), n.push(c), $++;
    }
    if ($ === a && n.push(r[a]), f) {
      const t = n.join("$$lit$$");
      void 0 === (r = l$1.get(t)) && (n.raw = n, l$1.set(t, r = n)), e = u;
    }
    return t(r, ...e);
  },
  u = n$1(b);

/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// Generated stylesheet for ./textfield/internal/outlined-styles.css.
const styles$2 = i$6`:host{--_caret-color: var(--md-outlined-text-field-caret-color, var(--md-sys-color-primary, #6750a4));--_disabled-input-text-color: var(--md-outlined-text-field-disabled-input-text-color, var(--md-sys-color-on-surface, #1d1b20));--_disabled-input-text-opacity: var(--md-outlined-text-field-disabled-input-text-opacity, 0.38);--_disabled-label-text-color: var(--md-outlined-text-field-disabled-label-text-color, var(--md-sys-color-on-surface, #1d1b20));--_disabled-label-text-opacity: var(--md-outlined-text-field-disabled-label-text-opacity, 0.38);--_disabled-leading-icon-color: var(--md-outlined-text-field-disabled-leading-icon-color, var(--md-sys-color-on-surface, #1d1b20));--_disabled-leading-icon-opacity: var(--md-outlined-text-field-disabled-leading-icon-opacity, 0.38);--_disabled-outline-color: var(--md-outlined-text-field-disabled-outline-color, var(--md-sys-color-on-surface, #1d1b20));--_disabled-outline-opacity: var(--md-outlined-text-field-disabled-outline-opacity, 0.12);--_disabled-outline-width: var(--md-outlined-text-field-disabled-outline-width, 1px);--_disabled-supporting-text-color: var(--md-outlined-text-field-disabled-supporting-text-color, var(--md-sys-color-on-surface, #1d1b20));--_disabled-supporting-text-opacity: var(--md-outlined-text-field-disabled-supporting-text-opacity, 0.38);--_disabled-trailing-icon-color: var(--md-outlined-text-field-disabled-trailing-icon-color, var(--md-sys-color-on-surface, #1d1b20));--_disabled-trailing-icon-opacity: var(--md-outlined-text-field-disabled-trailing-icon-opacity, 0.38);--_error-focus-caret-color: var(--md-outlined-text-field-error-focus-caret-color, var(--md-sys-color-error, #b3261e));--_error-focus-input-text-color: var(--md-outlined-text-field-error-focus-input-text-color, var(--md-sys-color-on-surface, #1d1b20));--_error-focus-label-text-color: var(--md-outlined-text-field-error-focus-label-text-color, var(--md-sys-color-error, #b3261e));--_error-focus-leading-icon-color: var(--md-outlined-text-field-error-focus-leading-icon-color, var(--md-sys-color-on-surface-variant, #49454f));--_error-focus-outline-color: var(--md-outlined-text-field-error-focus-outline-color, var(--md-sys-color-error, #b3261e));--_error-focus-supporting-text-color: var(--md-outlined-text-field-error-focus-supporting-text-color, var(--md-sys-color-error, #b3261e));--_error-focus-trailing-icon-color: var(--md-outlined-text-field-error-focus-trailing-icon-color, var(--md-sys-color-error, #b3261e));--_error-hover-input-text-color: var(--md-outlined-text-field-error-hover-input-text-color, var(--md-sys-color-on-surface, #1d1b20));--_error-hover-label-text-color: var(--md-outlined-text-field-error-hover-label-text-color, var(--md-sys-color-on-error-container, #410e0b));--_error-hover-leading-icon-color: var(--md-outlined-text-field-error-hover-leading-icon-color, var(--md-sys-color-on-surface-variant, #49454f));--_error-hover-outline-color: var(--md-outlined-text-field-error-hover-outline-color, var(--md-sys-color-on-error-container, #410e0b));--_error-hover-supporting-text-color: var(--md-outlined-text-field-error-hover-supporting-text-color, var(--md-sys-color-error, #b3261e));--_error-hover-trailing-icon-color: var(--md-outlined-text-field-error-hover-trailing-icon-color, var(--md-sys-color-on-error-container, #410e0b));--_error-input-text-color: var(--md-outlined-text-field-error-input-text-color, var(--md-sys-color-on-surface, #1d1b20));--_error-label-text-color: var(--md-outlined-text-field-error-label-text-color, var(--md-sys-color-error, #b3261e));--_error-leading-icon-color: var(--md-outlined-text-field-error-leading-icon-color, var(--md-sys-color-on-surface-variant, #49454f));--_error-outline-color: var(--md-outlined-text-field-error-outline-color, var(--md-sys-color-error, #b3261e));--_error-supporting-text-color: var(--md-outlined-text-field-error-supporting-text-color, var(--md-sys-color-error, #b3261e));--_error-trailing-icon-color: var(--md-outlined-text-field-error-trailing-icon-color, var(--md-sys-color-error, #b3261e));--_focus-input-text-color: var(--md-outlined-text-field-focus-input-text-color, var(--md-sys-color-on-surface, #1d1b20));--_focus-label-text-color: var(--md-outlined-text-field-focus-label-text-color, var(--md-sys-color-primary, #6750a4));--_focus-leading-icon-color: var(--md-outlined-text-field-focus-leading-icon-color, var(--md-sys-color-on-surface-variant, #49454f));--_focus-outline-color: var(--md-outlined-text-field-focus-outline-color, var(--md-sys-color-primary, #6750a4));--_focus-outline-width: var(--md-outlined-text-field-focus-outline-width, 3px);--_focus-supporting-text-color: var(--md-outlined-text-field-focus-supporting-text-color, var(--md-sys-color-on-surface-variant, #49454f));--_focus-trailing-icon-color: var(--md-outlined-text-field-focus-trailing-icon-color, var(--md-sys-color-on-surface-variant, #49454f));--_hover-input-text-color: var(--md-outlined-text-field-hover-input-text-color, var(--md-sys-color-on-surface, #1d1b20));--_hover-label-text-color: var(--md-outlined-text-field-hover-label-text-color, var(--md-sys-color-on-surface, #1d1b20));--_hover-leading-icon-color: var(--md-outlined-text-field-hover-leading-icon-color, var(--md-sys-color-on-surface-variant, #49454f));--_hover-outline-color: var(--md-outlined-text-field-hover-outline-color, var(--md-sys-color-on-surface, #1d1b20));--_hover-outline-width: var(--md-outlined-text-field-hover-outline-width, 1px);--_hover-supporting-text-color: var(--md-outlined-text-field-hover-supporting-text-color, var(--md-sys-color-on-surface-variant, #49454f));--_hover-trailing-icon-color: var(--md-outlined-text-field-hover-trailing-icon-color, var(--md-sys-color-on-surface-variant, #49454f));--_input-text-color: var(--md-outlined-text-field-input-text-color, var(--md-sys-color-on-surface, #1d1b20));--_input-text-font: var(--md-outlined-text-field-input-text-font, var(--md-sys-typescale-body-large-font, var(--md-ref-typeface-plain, Roboto)));--_input-text-line-height: var(--md-outlined-text-field-input-text-line-height, var(--md-sys-typescale-body-large-line-height, 1.5rem));--_input-text-placeholder-color: var(--md-outlined-text-field-input-text-placeholder-color, var(--md-sys-color-on-surface-variant, #49454f));--_input-text-prefix-color: var(--md-outlined-text-field-input-text-prefix-color, var(--md-sys-color-on-surface-variant, #49454f));--_input-text-size: var(--md-outlined-text-field-input-text-size, var(--md-sys-typescale-body-large-size, 1rem));--_input-text-suffix-color: var(--md-outlined-text-field-input-text-suffix-color, var(--md-sys-color-on-surface-variant, #49454f));--_input-text-weight: var(--md-outlined-text-field-input-text-weight, var(--md-sys-typescale-body-large-weight, var(--md-ref-typeface-weight-regular, 400)));--_label-text-color: var(--md-outlined-text-field-label-text-color, var(--md-sys-color-on-surface-variant, #49454f));--_label-text-font: var(--md-outlined-text-field-label-text-font, var(--md-sys-typescale-body-large-font, var(--md-ref-typeface-plain, Roboto)));--_label-text-line-height: var(--md-outlined-text-field-label-text-line-height, var(--md-sys-typescale-body-large-line-height, 1.5rem));--_label-text-populated-line-height: var(--md-outlined-text-field-label-text-populated-line-height, var(--md-sys-typescale-body-small-line-height, 1rem));--_label-text-populated-size: var(--md-outlined-text-field-label-text-populated-size, var(--md-sys-typescale-body-small-size, 0.75rem));--_label-text-size: var(--md-outlined-text-field-label-text-size, var(--md-sys-typescale-body-large-size, 1rem));--_label-text-weight: var(--md-outlined-text-field-label-text-weight, var(--md-sys-typescale-body-large-weight, var(--md-ref-typeface-weight-regular, 400)));--_leading-icon-color: var(--md-outlined-text-field-leading-icon-color, var(--md-sys-color-on-surface-variant, #49454f));--_leading-icon-size: var(--md-outlined-text-field-leading-icon-size, 24px);--_outline-color: var(--md-outlined-text-field-outline-color, var(--md-sys-color-outline, #79747e));--_outline-width: var(--md-outlined-text-field-outline-width, 1px);--_supporting-text-color: var(--md-outlined-text-field-supporting-text-color, var(--md-sys-color-on-surface-variant, #49454f));--_supporting-text-font: var(--md-outlined-text-field-supporting-text-font, var(--md-sys-typescale-body-small-font, var(--md-ref-typeface-plain, Roboto)));--_supporting-text-line-height: var(--md-outlined-text-field-supporting-text-line-height, var(--md-sys-typescale-body-small-line-height, 1rem));--_supporting-text-size: var(--md-outlined-text-field-supporting-text-size, var(--md-sys-typescale-body-small-size, 0.75rem));--_supporting-text-weight: var(--md-outlined-text-field-supporting-text-weight, var(--md-sys-typescale-body-small-weight, var(--md-ref-typeface-weight-regular, 400)));--_trailing-icon-color: var(--md-outlined-text-field-trailing-icon-color, var(--md-sys-color-on-surface-variant, #49454f));--_trailing-icon-size: var(--md-outlined-text-field-trailing-icon-size, 24px);--_container-shape-start-start: var(--md-outlined-text-field-container-shape-start-start, var(--md-outlined-text-field-container-shape, var(--md-sys-shape-corner-extra-small, 4px)));--_container-shape-start-end: var(--md-outlined-text-field-container-shape-start-end, var(--md-outlined-text-field-container-shape, var(--md-sys-shape-corner-extra-small, 4px)));--_container-shape-end-end: var(--md-outlined-text-field-container-shape-end-end, var(--md-outlined-text-field-container-shape, var(--md-sys-shape-corner-extra-small, 4px)));--_container-shape-end-start: var(--md-outlined-text-field-container-shape-end-start, var(--md-outlined-text-field-container-shape, var(--md-sys-shape-corner-extra-small, 4px)));--_icon-input-space: var(--md-outlined-text-field-icon-input-space, 16px);--_leading-space: var(--md-outlined-text-field-leading-space, 16px);--_trailing-space: var(--md-outlined-text-field-trailing-space, 16px);--_top-space: var(--md-outlined-text-field-top-space, 16px);--_bottom-space: var(--md-outlined-text-field-bottom-space, 16px);--_input-text-prefix-trailing-space: var(--md-outlined-text-field-input-text-prefix-trailing-space, 2px);--_input-text-suffix-leading-space: var(--md-outlined-text-field-input-text-suffix-leading-space, 2px);--_focus-caret-color: var(--md-outlined-text-field-focus-caret-color, var(--md-sys-color-primary, #6750a4));--_with-leading-icon-leading-space: var(--md-outlined-text-field-with-leading-icon-leading-space, 12px);--_with-trailing-icon-trailing-space: var(--md-outlined-text-field-with-trailing-icon-trailing-space, 12px);--md-outlined-field-bottom-space: var(--_bottom-space);--md-outlined-field-container-shape-end-end: var(--_container-shape-end-end);--md-outlined-field-container-shape-end-start: var(--_container-shape-end-start);--md-outlined-field-container-shape-start-end: var(--_container-shape-start-end);--md-outlined-field-container-shape-start-start: var(--_container-shape-start-start);--md-outlined-field-content-color: var(--_input-text-color);--md-outlined-field-content-font: var(--_input-text-font);--md-outlined-field-content-line-height: var(--_input-text-line-height);--md-outlined-field-content-size: var(--_input-text-size);--md-outlined-field-content-space: var(--_icon-input-space);--md-outlined-field-content-weight: var(--_input-text-weight);--md-outlined-field-disabled-content-color: var(--_disabled-input-text-color);--md-outlined-field-disabled-content-opacity: var(--_disabled-input-text-opacity);--md-outlined-field-disabled-label-text-color: var(--_disabled-label-text-color);--md-outlined-field-disabled-label-text-opacity: var(--_disabled-label-text-opacity);--md-outlined-field-disabled-leading-content-color: var(--_disabled-leading-icon-color);--md-outlined-field-disabled-leading-content-opacity: var(--_disabled-leading-icon-opacity);--md-outlined-field-disabled-outline-color: var(--_disabled-outline-color);--md-outlined-field-disabled-outline-opacity: var(--_disabled-outline-opacity);--md-outlined-field-disabled-outline-width: var(--_disabled-outline-width);--md-outlined-field-disabled-supporting-text-color: var(--_disabled-supporting-text-color);--md-outlined-field-disabled-supporting-text-opacity: var(--_disabled-supporting-text-opacity);--md-outlined-field-disabled-trailing-content-color: var(--_disabled-trailing-icon-color);--md-outlined-field-disabled-trailing-content-opacity: var(--_disabled-trailing-icon-opacity);--md-outlined-field-error-content-color: var(--_error-input-text-color);--md-outlined-field-error-focus-content-color: var(--_error-focus-input-text-color);--md-outlined-field-error-focus-label-text-color: var(--_error-focus-label-text-color);--md-outlined-field-error-focus-leading-content-color: var(--_error-focus-leading-icon-color);--md-outlined-field-error-focus-outline-color: var(--_error-focus-outline-color);--md-outlined-field-error-focus-supporting-text-color: var(--_error-focus-supporting-text-color);--md-outlined-field-error-focus-trailing-content-color: var(--_error-focus-trailing-icon-color);--md-outlined-field-error-hover-content-color: var(--_error-hover-input-text-color);--md-outlined-field-error-hover-label-text-color: var(--_error-hover-label-text-color);--md-outlined-field-error-hover-leading-content-color: var(--_error-hover-leading-icon-color);--md-outlined-field-error-hover-outline-color: var(--_error-hover-outline-color);--md-outlined-field-error-hover-supporting-text-color: var(--_error-hover-supporting-text-color);--md-outlined-field-error-hover-trailing-content-color: var(--_error-hover-trailing-icon-color);--md-outlined-field-error-label-text-color: var(--_error-label-text-color);--md-outlined-field-error-leading-content-color: var(--_error-leading-icon-color);--md-outlined-field-error-outline-color: var(--_error-outline-color);--md-outlined-field-error-supporting-text-color: var(--_error-supporting-text-color);--md-outlined-field-error-trailing-content-color: var(--_error-trailing-icon-color);--md-outlined-field-focus-content-color: var(--_focus-input-text-color);--md-outlined-field-focus-label-text-color: var(--_focus-label-text-color);--md-outlined-field-focus-leading-content-color: var(--_focus-leading-icon-color);--md-outlined-field-focus-outline-color: var(--_focus-outline-color);--md-outlined-field-focus-outline-width: var(--_focus-outline-width);--md-outlined-field-focus-supporting-text-color: var(--_focus-supporting-text-color);--md-outlined-field-focus-trailing-content-color: var(--_focus-trailing-icon-color);--md-outlined-field-hover-content-color: var(--_hover-input-text-color);--md-outlined-field-hover-label-text-color: var(--_hover-label-text-color);--md-outlined-field-hover-leading-content-color: var(--_hover-leading-icon-color);--md-outlined-field-hover-outline-color: var(--_hover-outline-color);--md-outlined-field-hover-outline-width: var(--_hover-outline-width);--md-outlined-field-hover-supporting-text-color: var(--_hover-supporting-text-color);--md-outlined-field-hover-trailing-content-color: var(--_hover-trailing-icon-color);--md-outlined-field-label-text-color: var(--_label-text-color);--md-outlined-field-label-text-font: var(--_label-text-font);--md-outlined-field-label-text-line-height: var(--_label-text-line-height);--md-outlined-field-label-text-populated-line-height: var(--_label-text-populated-line-height);--md-outlined-field-label-text-populated-size: var(--_label-text-populated-size);--md-outlined-field-label-text-size: var(--_label-text-size);--md-outlined-field-label-text-weight: var(--_label-text-weight);--md-outlined-field-leading-content-color: var(--_leading-icon-color);--md-outlined-field-leading-space: var(--_leading-space);--md-outlined-field-outline-color: var(--_outline-color);--md-outlined-field-outline-width: var(--_outline-width);--md-outlined-field-supporting-text-color: var(--_supporting-text-color);--md-outlined-field-supporting-text-font: var(--_supporting-text-font);--md-outlined-field-supporting-text-line-height: var(--_supporting-text-line-height);--md-outlined-field-supporting-text-size: var(--_supporting-text-size);--md-outlined-field-supporting-text-weight: var(--_supporting-text-weight);--md-outlined-field-top-space: var(--_top-space);--md-outlined-field-trailing-content-color: var(--_trailing-icon-color);--md-outlined-field-trailing-space: var(--_trailing-space);--md-outlined-field-with-leading-content-leading-space: var(--_with-leading-icon-leading-space);--md-outlined-field-with-trailing-content-trailing-space: var(--_with-trailing-icon-trailing-space)}
`;

/**
 * @license
 * Copyright 2020 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const r = o => void 0 === o.strings,
  m = {},
  p = (o, t = m) => o._$AH = t;

/**
 * @license
 * Copyright 2020 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const l = e$1(class extends i$2 {
  constructor(r$1) {
    if (super(r$1), r$1.type !== t.PROPERTY && r$1.type !== t.ATTRIBUTE && r$1.type !== t.BOOLEAN_ATTRIBUTE) throw Error("The `live` directive is not allowed on child or event bindings");
    if (!r(r$1)) throw Error("`live` bindings can only contain a single expression");
  }
  render(r) {
    return r;
  }
  update(i, [t$1]) {
    if (t$1 === E || t$1 === A) return t$1;
    const o = i.element,
      l = i.name;
    if (i.type === t.PROPERTY) {
      if (t$1 === o[l]) return E;
    } else if (i.type === t.BOOLEAN_ATTRIBUTE) {
      if (!!t$1 === o.hasAttribute(l)) return E;
    } else if (i.type === t.ATTRIBUTE && o.getAttribute(l) === t$1 + "") return E;
    return p(i), t$1;
  }
});

/**
 * @license
 * Copyright 2018 Google LLC
 * SPDX-License-Identifier: BSD-3-Clause
 */
const n = "important",
  i = " !" + n,
  o = e$1(class extends i$2 {
    constructor(t$1) {
      if (super(t$1), t$1.type !== t.ATTRIBUTE || "style" !== t$1.name || t$1.strings?.length > 2) throw Error("The `styleMap` directive must be used in the `style` attribute and must be the only part in the attribute.");
    }
    render(t) {
      return Object.keys(t).reduce((e, r) => {
        const s = t[r];
        return null == s ? e : e + `${r = r.includes("-") ? r : r.replace(/(?:^(webkit|moz|ms|o)|)(?=[A-Z])/g, "-$&").toLowerCase()}:${s};`;
      }, "");
    }
    update(e, [r]) {
      const {
        style: s
      } = e.element;
      if (void 0 === this.ft) return this.ft = new Set(Object.keys(r)), this.render(r);
      for (const t of this.ft) null == r[t] && (this.ft.delete(t), t.includes("-") ? s.removeProperty(t) : s[t] = null);
      for (const t in r) {
        const e = r[t];
        if (null != e) {
          this.ft.add(t);
          const r = "string" == typeof e && e.endsWith(i);
          t.includes("-") || r ? s.setProperty(t, r ? e.slice(0, -11) : e, r ? n : "") : s[t] = e;
        }
      }
      return E;
    }
  });

/**
 * @license
 * Copyright 2022 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
const stringConverter = {
  fromAttribute(value) {
    return value ?? '';
  },
  toAttribute(value) {
    return value || null;
  }
};

/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * Re-dispatches an event from the provided element.
 *
 * This function is useful for forwarding non-composed events, such as `change`
 * events.
 *
 * @example
 * class MyInput extends LitElement {
 *   render() {
 *     return html`<input @change=${this.redispatchEvent}>`;
 *   }
 *
 *   protected redispatchEvent(event: Event) {
 *     redispatchEvent(this, event);
 *   }
 * }
 *
 * @param element The element to dispatch the event from.
 * @param event The event to re-dispatch.
 * @return Whether or not the event was dispatched (if cancelable).
 */
function redispatchEvent(element, event) {
  // For bubbling events in SSR light DOM (or composed), stop their propagation
  // and dispatch the copy.
  if (event.bubbles && (!element.shadowRoot || event.composed)) {
    event.stopPropagation();
  }
  const copy = Reflect.construct(event.constructor, [event.type, event]);
  const dispatched = element.dispatchEvent(copy);
  if (!dispatched) {
    event.preventDefault();
  }
  return dispatched;
}

/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * A symbol property used to create a constraint validation `Validator`.
 * Required for all `mixinConstraintValidation()` elements.
 */
const createValidator = Symbol('createValidator');
/**
 * A symbol property used to return an anchor for constraint validation popups.
 * Required for all `mixinConstraintValidation()` elements.
 */
const getValidityAnchor = Symbol('getValidityAnchor');
// Private symbol members, used to avoid name clashing.
const privateValidator = Symbol('privateValidator');
const privateSyncValidity = Symbol('privateSyncValidity');
const privateCustomValidationMessage = Symbol('privateCustomValidationMessage');
/**
 * Mixes in constraint validation APIs for an element.
 *
 * See https://developer.mozilla.org/en-US/docs/Web/HTML/Constraint_validation
 * for more details.
 *
 * Implementations must provide a validator to cache and compute its validity,
 * along with a shadow root element to anchor validation popups to.
 *
 * @example
 * ```ts
 * const baseClass = mixinConstraintValidation(
 *   mixinFormAssociated(mixinElementInternals(LitElement))
 * );
 *
 * class MyCheckbox extends baseClass {
 *   \@property({type: Boolean}) checked = false;
 *   \@property({type: Boolean}) required = false;
 *
 *   [createValidator]() {
 *     return new CheckboxValidator(() => this);
 *   }
 *
 *   [getValidityAnchor]() {
 *     return this.renderRoot.querySelector('.root');
 *   }
 * }
 * ```
 *
 * @param base The class to mix functionality into.
 * @return The provided class with `ConstraintValidation` mixed in.
 */
function mixinConstraintValidation(base) {
  var _a;
  class ConstraintValidationElement extends base {
    constructor() {
      super(...arguments);
      /**
       * Needed for Safari, see https://bugs.webkit.org/show_bug.cgi?id=261432
       * Replace with this[internals].validity.customError when resolved.
       */
      this[_a] = '';
    }
    get validity() {
      this[privateSyncValidity]();
      return this[internals].validity;
    }
    get validationMessage() {
      this[privateSyncValidity]();
      return this[internals].validationMessage;
    }
    get willValidate() {
      this[privateSyncValidity]();
      return this[internals].willValidate;
    }
    checkValidity() {
      this[privateSyncValidity]();
      return this[internals].checkValidity();
    }
    reportValidity() {
      this[privateSyncValidity]();
      return this[internals].reportValidity();
    }
    setCustomValidity(error) {
      this[privateCustomValidationMessage] = error;
      this[privateSyncValidity]();
    }
    requestUpdate(name, oldValue, options) {
      super.requestUpdate(name, oldValue, options);
      this[privateSyncValidity]();
    }
    firstUpdated(changed) {
      super.firstUpdated(changed);
      // Sync the validity again when the element first renders, since the
      // validity anchor is now available.
      //
      // Elements that `delegatesFocus: true` to an `<input>` will throw an
      // error in Chrome and Safari when a form tries to submit or call
      // `form.reportValidity()`:
      // "An invalid form control with name='' is not focusable"
      //
      // The validity anchor MUST be provided in `internals.setValidity()` and
      // MUST be the `<input>` element rendered.
      //
      // See https://lit.dev/playground/#gist=6c26e418e0010f7a5aac15005cde8bde
      // for a reproduction.
      this[privateSyncValidity]();
    }
    [(_a = privateCustomValidationMessage, privateSyncValidity)]() {
      if (!this[privateValidator]) {
        this[privateValidator] = this[createValidator]();
      }
      const {
        validity,
        validationMessage: nonCustomValidationMessage
      } = this[privateValidator].getValidity();
      const customError = !!this[privateCustomValidationMessage];
      const validationMessage = this[privateCustomValidationMessage] || nonCustomValidationMessage;
      this[internals].setValidity({
        ...validity,
        customError
      }, validationMessage, this[getValidityAnchor]() ?? undefined);
    }
    [createValidator]() {
      throw new Error('Implement [createValidator]');
    }
    [getValidityAnchor]() {
      throw new Error('Implement [getValidityAnchor]');
    }
  }
  return ConstraintValidationElement;
}

/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * A symbol property to retrieve the form value for an element.
 */
const getFormValue = Symbol('getFormValue');
/**
 * A symbol property to retrieve the form state for an element.
 */
const getFormState = Symbol('getFormState');
/**
 * Mixes in form-associated behavior for a class. This allows an element to add
 * values to `<form>` elements.
 *
 * Implementing classes should provide a `[formValue]` to return the current
 * value of the element, as well as reset and restore callbacks.
 *
 * @example
 * ```ts
 * const base = mixinFormAssociated(mixinElementInternals(LitElement));
 *
 * class MyControl extends base {
 *   \@property()
 *   value = '';
 *
 *   override [getFormValue]() {
 *     return this.value;
 *   }
 *
 *   override formResetCallback() {
 *     const defaultValue = this.getAttribute('value');
 *     this.value = defaultValue;
 *   }
 *
 *   override formStateRestoreCallback(state: string) {
 *     this.value = state;
 *   }
 * }
 * ```
 *
 * Elements may optionally provide a `[formState]` if their values do not
 * represent the state of the component.
 *
 * @example
 * ```ts
 * const base = mixinFormAssociated(mixinElementInternals(LitElement));
 *
 * class MyCheckbox extends base {
 *   \@property()
 *   value = 'on';
 *
 *   \@property({type: Boolean})
 *   checked = false;
 *
 *   override [getFormValue]() {
 *     return this.checked ? this.value : null;
 *   }
 *
 *   override [getFormState]() {
 *     return String(this.checked);
 *   }
 *
 *   override formResetCallback() {
 *     const defaultValue = this.hasAttribute('checked');
 *     this.checked = defaultValue;
 *   }
 *
 *   override formStateRestoreCallback(state: string) {
 *     this.checked = Boolean(state);
 *   }
 * }
 * ```
 *
 * IMPORTANT: Requires declares for lit-analyzer
 * @example
 * ```ts
 * const base = mixinFormAssociated(mixinElementInternals(LitElement));
 * class MyControl extends base {
 *   // Writable mixin properties for lit-html binding, needed for lit-analyzer
 *   declare disabled: boolean;
 *   declare name: string;
 * }
 * ```
 *
 * @param base The class to mix functionality into. The base class must use
 *     `mixinElementInternals()`.
 * @return The provided class with `FormAssociated` mixed in.
 */
function mixinFormAssociated(base) {
  class FormAssociatedElement extends base {
    get form() {
      return this[internals].form;
    }
    get labels() {
      return this[internals].labels;
    }
    // Use @property for the `name` and `disabled` properties to add them to the
    // `observedAttributes` array and trigger `attributeChangedCallback()`.
    //
    // We don't use Lit's default getter/setter (`noAccessor: true`) because
    // the attributes need to be updated synchronously to work with synchronous
    // form APIs, and Lit updates attributes async by default.
    get name() {
      return this.getAttribute('name') ?? '';
    }
    set name(name) {
      // Note: setting name to null or empty does not remove the attribute.
      this.setAttribute('name', name);
      // We don't need to call `requestUpdate()` since it's called synchronously
      // in `attributeChangedCallback()`.
    }
    get disabled() {
      return this.hasAttribute('disabled');
    }
    set disabled(disabled) {
      this.toggleAttribute('disabled', disabled);
      // We don't need to call `requestUpdate()` since it's called synchronously
      // in `attributeChangedCallback()`.
    }
    attributeChangedCallback(name, old, value) {
      // Manually `requestUpdate()` for `name` and `disabled` when their
      // attribute or property changes.
      // The properties update their attributes, so this callback is invoked
      // immediately when the properties are set. We call `requestUpdate()` here
      // instead of letting Lit set the properties from the attribute change.
      // That would cause the properties to re-set the attribute and invoke this
      // callback again in a loop. This leads to stale state when Lit tries to
      // determine if a property changed or not.
      if (name === 'name' || name === 'disabled') {
        // Disabled's value is only false if the attribute is missing and null.
        const oldValue = name === 'disabled' ? old !== null : old;
        // Trigger a lit update when the attribute changes.
        this.requestUpdate(name, oldValue);
        return;
      }
      super.attributeChangedCallback(name, old, value);
    }
    requestUpdate(name, oldValue, options) {
      super.requestUpdate(name, oldValue, options);
      // If any properties change, update the form value, which may have changed
      // as well.
      // Update the form value synchronously in `requestUpdate()` rather than
      // `update()` or `updated()`, which are async. This is necessary to ensure
      // that form data is updated in time for synchronous event listeners.
      this[internals].setFormValue(this[getFormValue](), this[getFormState]());
    }
    [getFormValue]() {
      // Closure does not allow abstract symbol members, so a default
      // implementation is needed.
      throw new Error('Implement [getFormValue]');
    }
    [getFormState]() {
      return this[getFormValue]();
    }
    formDisabledCallback(disabled) {
      this.disabled = disabled;
    }
  }
  /** @nocollapse */
  FormAssociatedElement.formAssociated = true;
  __decorate([n$2({
    noAccessor: true
  })], FormAssociatedElement.prototype, "name", null);
  __decorate([n$2({
    type: Boolean,
    noAccessor: true
  })], FormAssociatedElement.prototype, "disabled", null);
  return FormAssociatedElement;
}

/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * A symbol property used for a callback when validity has been reported.
 */
const onReportValidity = Symbol('onReportValidity');
// Private symbol members, used to avoid name clashing.
const privateCleanupFormListeners = Symbol('privateCleanupFormListeners');
const privateDoNotReportInvalid = Symbol('privateDoNotReportInvalid');
const privateIsSelfReportingValidity = Symbol('privateIsSelfReportingValidity');
const privateCallOnReportValidity = Symbol('privateCallOnReportValidity');
/**
 * Mixes in a callback for constraint validation when validity should be
 * styled and reported to the user.
 *
 * This is commonly used in text-field-like controls that display error styles
 * and error messages.
 *
 * @example
 * ```ts
 * const baseClass = mixinOnReportValidity(
 *   mixinConstraintValidation(
 *     mixinFormAssociated(mixinElementInternals(LitElement)),
 *   ),
 * );
 *
 * class MyField extends baseClass {
 *   \@property({type: Boolean}) error = false;
 *   \@property() errorMessage = '';
 *
 *   [onReportValidity](invalidEvent: Event | null) {
 *     this.error = !!invalidEvent;
 *     this.errorMessage = this.validationMessage;
 *
 *     // Optionally prevent platform popup from displaying
 *     invalidEvent?.preventDefault();
 *   }
 * }
 * ```
 *
 * @param base The class to mix functionality into.
 * @return The provided class with `OnReportValidity` mixed in.
 */
function mixinOnReportValidity(base) {
  var _a, _b, _c;
  class OnReportValidityElement extends base {
    // Mixins must have a constructor with `...args: any[]`
    // tslint:disable-next-line:no-any
    constructor(...args) {
      super(...args);
      /**
       * Used to clean up event listeners when a new form is associated.
       */
      this[_a] = new AbortController();
      /**
       * Used to determine if an invalid event should report validity. Invalid
       * events from `checkValidity()` do not trigger reporting.
       */
      this[_b] = false;
      /**
       * Used to determine if the control is reporting validity from itself, or
       * if a `<form>` is causing the validity report. Forms have different
       * control focusing behavior.
       */
      this[_c] = false;
      this.addEventListener('invalid', invalidEvent => {
        // Listen for invalid events dispatched by a `<form>` when it tries to
        // submit and the element is invalid. We ignore events dispatched when
        // calling `checkValidity()` as well as untrusted events, since the
        // `reportValidity()` and `<form>`-dispatched events are always
        // trusted.
        if (this[privateDoNotReportInvalid] || !invalidEvent.isTrusted) {
          return;
        }
        this.addEventListener('invalid', () => {
          // A normal bubbling phase event listener. By adding it here, we
          // ensure it's the last event listener that is called during the
          // bubbling phase.
          this[privateCallOnReportValidity](invalidEvent);
        }, {
          once: true
        });
      }, {
        // Listen during the capture phase, which will happen before the
        // bubbling phase. That way, we can add a final event listener that
        // will run after other event listeners, and we can check if it was
        // default prevented. This works because invalid does not bubble.
        capture: true
      });
    }
    checkValidity() {
      this[privateDoNotReportInvalid] = true;
      const valid = super.checkValidity();
      this[privateDoNotReportInvalid] = false;
      return valid;
    }
    reportValidity() {
      this[privateIsSelfReportingValidity] = true;
      const valid = super.reportValidity();
      // Constructor's invalid listener will handle reporting invalid events.
      if (valid) {
        this[privateCallOnReportValidity](null);
      }
      this[privateIsSelfReportingValidity] = false;
      return valid;
    }
    [(_a = privateCleanupFormListeners, _b = privateDoNotReportInvalid, _c = privateIsSelfReportingValidity, privateCallOnReportValidity)](invalidEvent) {
      // Since invalid events do not bubble to parent listeners, and because
      // our invalid listeners are added lazily after other listeners, we can
      // reliably read `defaultPrevented` synchronously without worrying
      // about waiting for another listener that could cancel it.
      const wasCanceled = invalidEvent?.defaultPrevented;
      if (wasCanceled) {
        return;
      }
      this[onReportValidity](invalidEvent);
      // If an implementation calls invalidEvent.preventDefault() to stop the
      // platform popup from displaying, focusing is also prevented, so we need
      // to manually focus.
      const implementationCanceledFocus = !wasCanceled && invalidEvent?.defaultPrevented;
      if (!implementationCanceledFocus) {
        return;
      }
      // The control should be focused when:
      // - `control.reportValidity()` is called (self-reporting).
      // - a form is reporting validity for its controls and this is the first
      //   invalid control.
      if (this[privateIsSelfReportingValidity] || isFirstInvalidControlInForm(this[internals].form, this)) {
        this.focus();
      }
    }
    [onReportValidity](invalidEvent) {
      throw new Error('Implement [onReportValidity]');
    }
    formAssociatedCallback(form) {
      // can't use super.formAssociatedCallback?.() due to closure
      if (super.formAssociatedCallback) {
        super.formAssociatedCallback(form);
      }
      // Clean up previous form listeners.
      this[privateCleanupFormListeners].abort();
      if (!form) {
        return;
      }
      this[privateCleanupFormListeners] = new AbortController();
      // Add a listener that fires when the form runs constraint validation and
      // the control is valid, so that it may remove its error styles.
      //
      // This happens on `form.reportValidity()` and `form.requestSubmit()`
      // (both when the submit fails and passes).
      addFormReportValidListener(this, form, () => {
        this[privateCallOnReportValidity](null);
      }, this[privateCleanupFormListeners].signal);
    }
  }
  return OnReportValidityElement;
}
/**
 * Add a listener that fires when a form runs constraint validation on a control
 * and it is valid. This is needed to clear previously invalid styles.
 *
 * @param control The control of the form to listen for valid events.
 * @param form The control's form that can run constraint validation.
 * @param onControlValid A listener that is called when the form runs constraint
 *     validation and the control is valid.
 * @param cleanup A cleanup signal to remove the listener.
 */
function addFormReportValidListener(control, form, onControlValid, cleanup) {
  const validateHooks = getFormValidateHooks(form);
  // When a form validates its controls, check if an invalid event is dispatched
  // on the control. If it is not, then inform the control to report its valid
  // state.
  let controlFiredInvalid = false;
  let cleanupInvalidListener;
  let isNextSubmitFromHook = false;
  validateHooks.addEventListener('before', () => {
    isNextSubmitFromHook = true;
    cleanupInvalidListener = new AbortController();
    controlFiredInvalid = false;
    control.addEventListener('invalid', () => {
      controlFiredInvalid = true;
    }, {
      signal: cleanupInvalidListener.signal
    });
  }, {
    signal: cleanup
  });
  validateHooks.addEventListener('after', () => {
    isNextSubmitFromHook = false;
    cleanupInvalidListener?.abort();
    if (controlFiredInvalid) {
      return;
    }
    onControlValid();
  }, {
    signal: cleanup
  });
  // The above hooks handle imperatively submitting the form, but not
  // declaratively submitting the form. This happens when:
  // 1. A non-custom element `<button type="submit">` is clicked.
  // 2. Enter is pressed on a non-custom element text editable `<input>`.
  form.addEventListener('submit', () => {
    // This submit was from `form.requestSubmit()`, which already calls the
    // listener.
    if (isNextSubmitFromHook) {
      return;
    }
    onControlValid();
  }, {
    signal: cleanup
  });
  // Note: it is a known limitation that we cannot detect if a form tries to
  // submit declaratively, but fails to do so because an unrelated sibling
  // control failed its constraint validation.
  //
  // Since we cannot detect when that happens, a previously invalid control may
  // not clear its error styling when it becomes valid again.
  //
  // To work around this, call `form.reportValidity()` when submitting a form
  // declaratively. This can be down on the `<button type="submit">`'s click or
  // the text editable `<input>`'s 'Enter' keydown.
}
const FORM_VALIDATE_HOOKS = new WeakMap();
/**
 * Get a hooks `EventTarget` that dispatches 'before' and 'after' events that
 * fire before a form runs constraint validation and immediately after it
 * finishes running constraint validation on its controls.
 *
 * This happens during `form.reportValidity()` and `form.requestSubmit()`.
 *
 * @param form The form to get or set up hooks for.
 * @return A hooks `EventTarget` to add listeners to.
 */
function getFormValidateHooks(form) {
  if (!FORM_VALIDATE_HOOKS.has(form)) {
    // Patch form methods to add event listener hooks. These are needed to react
    // to form behaviors that do not dispatch events, such as a form asking its
    // controls to report their validity.
    //
    // We should only patch the methods once, since multiple controls and other
    // forces may want to patch this method. We cannot reliably clean it up if
    // there are multiple patched and re-patched methods referring holding
    // references to each other.
    //
    // Instead, we never clean up the patch but add and clean up event listeners
    // added to the hooks after the patch.
    const hooks = new EventTarget();
    FORM_VALIDATE_HOOKS.set(form, hooks);
    // Add hooks to support notifying before and after a form has run constraint
    // validation on its controls.
    // Note: `form.submit()` does not run constraint validation per spec.
    for (const methodName of ['reportValidity', 'requestSubmit']) {
      const superMethod = form[methodName];
      form[methodName] = function () {
        hooks.dispatchEvent(new Event('before'));
        const result = Reflect.apply(superMethod, this, arguments);
        hooks.dispatchEvent(new Event('after'));
        return result;
      };
    }
  }
  return FORM_VALIDATE_HOOKS.get(form);
}
/**
 * Checks if a control is the first invalid control in a form.
 *
 * @param form The control's form. When `null`, the control doesn't have a form
 *     and the method returns true.
 * @param control The control to check.
 * @return True if there is no form or if the control is the form's first
 *     invalid control.
 */
function isFirstInvalidControlInForm(form, control) {
  if (!form) {
    return true;
  }
  let firstInvalidControl;
  for (const element of form.elements) {
    if (element.matches(':invalid')) {
      firstInvalidControl = element;
      break;
    }
  }
  return firstInvalidControl === control;
}

/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * A class that computes and caches `ValidityStateFlags` for a component with
 * a given `State` interface.
 *
 * Cached performance before computing validity is important since constraint
 * validation must be checked frequently and synchronously when properties
 * change.
 *
 * @template State The expected interface of properties relevant to constraint
 *     validation.
 */
class Validator {
  /**
   * Creates a new validator.
   *
   * @param getCurrentState A callback that returns the current state of
   *     constraint validation-related properties.
   */
  constructor(getCurrentState) {
    this.getCurrentState = getCurrentState;
    /**
     * The current validity state and message. This is cached and returns if
     * constraint validation state does not change.
     */
    this.currentValidity = {
      validity: {},
      validationMessage: ''
    };
  }
  /**
   * Returns the current `ValidityStateFlags` and validation message for the
   * validator.
   *
   * If the constraint validation state has not changed, this will return a
   * cached result. This is important since `getValidity()` can be called
   * frequently in response to synchronous property changes.
   *
   * @return The current validity and validation message.
   */
  getValidity() {
    const state = this.getCurrentState();
    const hasStateChanged = !this.prevState || !this.equals(this.prevState, state);
    if (!hasStateChanged) {
      return this.currentValidity;
    }
    const {
      validity,
      validationMessage
    } = this.computeValidity(state);
    this.prevState = this.copy(state);
    this.currentValidity = {
      validationMessage,
      validity: {
        // Change any `ValidityState` instances into `ValidityStateFlags` since
        // `ValidityState` cannot be easily `{...spread}`.
        badInput: validity.badInput,
        customError: validity.customError,
        patternMismatch: validity.patternMismatch,
        rangeOverflow: validity.rangeOverflow,
        rangeUnderflow: validity.rangeUnderflow,
        stepMismatch: validity.stepMismatch,
        tooLong: validity.tooLong,
        tooShort: validity.tooShort,
        typeMismatch: validity.typeMismatch,
        valueMissing: validity.valueMissing
      }
    };
    return this.currentValidity;
  }
}

/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * A validator that provides constraint validation that emulates `<input>` and
 * `<textarea>` validation.
 */
class TextFieldValidator extends Validator {
  computeValidity({
    state,
    renderedControl
  }) {
    let inputOrTextArea = renderedControl;
    if (isInputState(state) && !inputOrTextArea) {
      // Get cached <input> or create it.
      inputOrTextArea = this.inputControl || document.createElement('input');
      // Cache the <input> to re-use it next time.
      this.inputControl = inputOrTextArea;
    } else if (!inputOrTextArea) {
      // Get cached <textarea> or create it.
      inputOrTextArea = this.textAreaControl || document.createElement('textarea');
      // Cache the <textarea> to re-use it next time.
      this.textAreaControl = inputOrTextArea;
    }
    // Set this variable so we can check it for input-specific properties.
    const input = isInputState(state) ? inputOrTextArea : null;
    // Set input's "type" first, since this can change the other properties
    if (input) {
      input.type = state.type;
    }
    if (inputOrTextArea.value !== state.value) {
      // Only programmatically set the value if there's a difference. When using
      // the rendered control, the value will always be up to date. Setting the
      // property (even if it's the same string) will reset the internal <input>
      // dirty flag, making minlength and maxlength validation reset.
      inputOrTextArea.value = state.value;
    }
    inputOrTextArea.required = state.required;
    // The following IDLAttribute properties will always hydrate an attribute,
    // even if set to a the default value ('' or -1). The presence of the
    // attribute triggers constraint validation, so we must remove the attribute
    // when empty.
    if (input) {
      const inputState = state;
      if (inputState.pattern) {
        input.pattern = inputState.pattern;
      } else {
        input.removeAttribute('pattern');
      }
      if (inputState.min) {
        input.min = inputState.min;
      } else {
        input.removeAttribute('min');
      }
      if (inputState.max) {
        input.max = inputState.max;
      } else {
        input.removeAttribute('max');
      }
      if (inputState.step) {
        input.step = inputState.step;
      } else {
        input.removeAttribute('step');
      }
    }
    // Use -1 to represent no minlength and maxlength, which is what the
    // platform input returns. However, it will throw an error if you try to
    // manually set it to -1.
    //
    // While the type is `number`, it may actually be `null` at runtime.
    // `null > -1` is true since `null` coerces to `0`, so we default null and
    // undefined to -1.
    //
    // We set attributes instead of properties since setting a property may
    // throw an out of bounds error in relation to the other property.
    // Attributes will not throw errors while the state is updating.
    if ((state.minLength ?? -1) > -1) {
      inputOrTextArea.setAttribute('minlength', String(state.minLength));
    } else {
      inputOrTextArea.removeAttribute('minlength');
    }
    if ((state.maxLength ?? -1) > -1) {
      inputOrTextArea.setAttribute('maxlength', String(state.maxLength));
    } else {
      inputOrTextArea.removeAttribute('maxlength');
    }
    return {
      validity: inputOrTextArea.validity,
      validationMessage: inputOrTextArea.validationMessage
    };
  }
  equals({
    state: prev
  }, {
    state: next
  }) {
    // Check shared input and textarea properties
    const inputOrTextAreaEqual = prev.type === next.type && prev.value === next.value && prev.required === next.required && prev.minLength === next.minLength && prev.maxLength === next.maxLength;
    if (!isInputState(prev) || !isInputState(next)) {
      // Both are textareas, all relevant properties are equal.
      return inputOrTextAreaEqual;
    }
    // Check additional input-specific properties.
    return inputOrTextAreaEqual && prev.pattern === next.pattern && prev.min === next.min && prev.max === next.max && prev.step === next.step;
  }
  copy({
    state
  }) {
    // Don't hold a reference to the rendered control when copying since we
    // don't use it when checking if the state changed.
    return {
      state: isInputState(state) ? this.copyInput(state) : this.copyTextArea(state),
      renderedControl: null
    };
  }
  copyInput(state) {
    const {
      type,
      pattern,
      min,
      max,
      step
    } = state;
    return {
      ...this.copySharedState(state),
      type,
      pattern,
      min,
      max,
      step
    };
  }
  copyTextArea(state) {
    return {
      ...this.copySharedState(state),
      type: state.type
    };
  }
  copySharedState({
    value,
    required,
    minLength,
    maxLength
  }) {
    return {
      value,
      required,
      minLength,
      maxLength
    };
  }
}
function isInputState(state) {
  return state.type !== 'textarea';
}

/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// Separate variable needed for closure.
const textFieldBaseClass = mixinDelegatesAria(mixinOnReportValidity(mixinConstraintValidation(mixinFormAssociated(mixinElementInternals(i$3)))));
/**
 * A text field component.
 *
 * @fires select {Event} The native `select` event on
 * [`<input>`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/select_event)
 * --bubbles
 * @fires change {Event} The native `change` event on
 * [`<input>`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/change_event)
 * --bubbles
 * @fires input {InputEvent} The native `input` event on
 * [`<input>`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/input_event)
 * --bubbles --composed
 */
class TextField extends textFieldBaseClass {
  constructor() {
    super(...arguments);
    /**
     * Gets or sets whether or not the text field is in a visually invalid state.
     *
     * This error state overrides the error state controlled by
     * `reportValidity()`.
     */
    this.error = false;
    /**
     * The error message that replaces supporting text when `error` is true. If
     * `errorText` is an empty string, then the supporting text will continue to
     * show.
     *
     * This error message overrides the error message displayed by
     * `reportValidity()`.
     */
    this.errorText = '';
    /**
     * The floating Material label of the textfield component. It informs the user
     * about what information is requested for a text field. It is aligned with
     * the input text, is always visible, and it floats when focused or when text
     * is entered into the textfield. This label also sets accessibilty labels,
     * but the accessible label is overriden by `aria-label`.
     *
     * Learn more about floating labels from the Material Design guidelines:
     * https://m3.material.io/components/text-fields/guidelines
     */
    this.label = '';
    /**
     * Disables the asterisk on the floating label, when the text field is
     * required.
     */
    this.noAsterisk = false;
    /**
     * Indicates that the user must specify a value for the input before the
     * owning form can be submitted and will render an error state when
     * `reportValidity()` is invoked when value is empty. Additionally the
     * floating label will render an asterisk `"*"` when true.
     *
     * https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/required
     */
    this.required = false;
    /**
     * The current value of the text field. It is always a string.
     */
    this.value = '';
    /**
     * An optional prefix to display before the input value.
     */
    this.prefixText = '';
    /**
     * An optional suffix to display after the input value.
     */
    this.suffixText = '';
    /**
     * Whether or not the text field has a leading icon. Used for SSR.
     */
    this.hasLeadingIcon = false;
    /**
     * Whether or not the text field has a trailing icon. Used for SSR.
     */
    this.hasTrailingIcon = false;
    /**
     * Conveys additional information below the text field, such as how it should
     * be used.
     */
    this.supportingText = '';
    /**
     * Override the input text CSS `direction`. Useful for RTL languages that use
     * LTR notation for fractions.
     */
    this.textDirection = '';
    /**
     * The number of rows to display for a `type="textarea"` text field.
     * Defaults to 2.
     */
    this.rows = 2;
    /**
     * The number of cols to display for a `type="textarea"` text field.
     * Defaults to 20.
     */
    this.cols = 20;
    // <input> properties
    this.inputMode = '';
    /**
     * Defines the greatest value in the range of permitted values.
     *
     * https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input#max
     */
    this.max = '';
    /**
     * The maximum number of characters a user can enter into the text field. Set
     * to -1 for none.
     *
     * https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input#maxlength
     */
    this.maxLength = -1;
    /**
     * Defines the most negative value in the range of permitted values.
     *
     * https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input#min
     */
    this.min = '';
    /**
     * The minimum number of characters a user can enter into the text field. Set
     * to -1 for none.
     *
     * https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input#minlength
     */
    this.minLength = -1;
    /**
     * When true, hide the spinner for `type="number"` text fields.
     */
    this.noSpinner = false;
    /**
     * A regular expression that the text field's value must match to pass
     * constraint validation.
     *
     * https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input#pattern
     */
    this.pattern = '';
    /**
     * Defines the text displayed in the textfield when it has no value. Provides
     * a brief hint to the user as to the expected type of data that should be
     * entered into the control. Unlike `label`, the placeholder is not visible
     * and does not float when the textfield has a value.
     *
     * https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/placeholder
     */
    this.placeholder = '';
    /**
     * Indicates whether or not a user should be able to edit the text field's
     * value.
     *
     * https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input#readonly
     */
    this.readOnly = false;
    /**
     * Indicates that input accepts multiple email addresses.
     *
     * https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/email#multiple
     */
    this.multiple = false;
    /**
     * Returns or sets the element's step attribute, which works with min and max
     * to limit the increments at which a numeric or date-time value can be set.
     *
     * https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input#step
     */
    this.step = '';
    /**
     * The `<input>` type to use, defaults to "text". The type greatly changes how
     * the text field behaves.
     *
     * Text fields support a limited number of `<input>` types:
     *
     * - text
     * - textarea
     * - email
     * - number
     * - password
     * - search
     * - tel
     * - url
     *
     * See
     * https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input#input_types
     * for more details on each input type.
     */
    this.type = 'text';
    /**
     * Describes what, if any, type of autocomplete functionality the input
     * should provide.
     *
     * https://developer.mozilla.org/en-US/docs/Web/HTML/Attributes/autocomplete
     */
    this.autocomplete = '';
    /**
     * Returns true when the text field has been interacted with. Native
     * validation errors only display in response to user interactions.
     */
    this.dirty = false;
    this.focused = false;
    /**
     * Whether or not a native error has been reported via `reportValidity()`.
     */
    this.nativeError = false;
    /**
     * The validation message displayed from a native error via
     * `reportValidity()`.
     */
    this.nativeErrorText = '';
  }
  /**
   * Gets or sets the direction in which selection occurred.
   */
  get selectionDirection() {
    return this.getInputOrTextarea().selectionDirection;
  }
  set selectionDirection(value) {
    this.getInputOrTextarea().selectionDirection = value;
  }
  /**
   * Gets or sets the end position or offset of a text selection.
   */
  get selectionEnd() {
    return this.getInputOrTextarea().selectionEnd;
  }
  set selectionEnd(value) {
    this.getInputOrTextarea().selectionEnd = value;
  }
  /**
   * Gets or sets the starting position or offset of a text selection.
   */
  get selectionStart() {
    return this.getInputOrTextarea().selectionStart;
  }
  set selectionStart(value) {
    this.getInputOrTextarea().selectionStart = value;
  }
  /**
   * The text field's value as a number.
   */
  get valueAsNumber() {
    const input = this.getInput();
    if (!input) {
      return NaN;
    }
    return input.valueAsNumber;
  }
  set valueAsNumber(value) {
    const input = this.getInput();
    if (!input) {
      return;
    }
    input.valueAsNumber = value;
    this.value = input.value;
  }
  /**
   * The text field's value as a Date.
   */
  get valueAsDate() {
    const input = this.getInput();
    if (!input) {
      return null;
    }
    return input.valueAsDate;
  }
  set valueAsDate(value) {
    const input = this.getInput();
    if (!input) {
      return;
    }
    input.valueAsDate = value;
    this.value = input.value;
  }
  get hasError() {
    return this.error || this.nativeError;
  }
  /**
   * Selects all the text in the text field.
   *
   * https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/select
   */
  select() {
    this.getInputOrTextarea().select();
  }
  setRangeText(...args) {
    // Calling setRangeText with 1 vs 3-4 arguments has different behavior.
    // Use spread syntax and type casting to ensure correct usage.
    this.getInputOrTextarea().setRangeText(...args);
    this.value = this.getInputOrTextarea().value;
  }
  /**
   * Sets the start and end positions of a selection in the text field.
   *
   * https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/setSelectionRange
   *
   * @param start The offset into the text field for the start of the selection.
   * @param end The offset into the text field for the end of the selection.
   * @param direction The direction in which the selection is performed.
   */
  setSelectionRange(start, end, direction) {
    this.getInputOrTextarea().setSelectionRange(start, end, direction);
  }
  /**
   * Shows the browser picker for an input element of type "date", "time", etc.
   *
   * For a full list of supported types, see:
   * https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/showPicker#browser_compatibility
   *
   * https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/showPicker
   */
  showPicker() {
    const input = this.getInput();
    if (!input) {
      return;
    }
    input.showPicker();
  }
  /**
   * Decrements the value of a numeric type text field by `step` or `n` `step`
   * number of times.
   *
   * https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/stepDown
   *
   * @param stepDecrement The number of steps to decrement, defaults to 1.
   */
  stepDown(stepDecrement) {
    const input = this.getInput();
    if (!input) {
      return;
    }
    input.stepDown(stepDecrement);
    this.value = input.value;
  }
  /**
   * Increments the value of a numeric type text field by `step` or `n` `step`
   * number of times.
   *
   * https://developer.mozilla.org/en-US/docs/Web/API/HTMLInputElement/stepUp
   *
   * @param stepIncrement The number of steps to increment, defaults to 1.
   */
  stepUp(stepIncrement) {
    const input = this.getInput();
    if (!input) {
      return;
    }
    input.stepUp(stepIncrement);
    this.value = input.value;
  }
  /**
   * Reset the text field to its default value.
   */
  reset() {
    this.dirty = false;
    this.value = this.getAttribute('value') ?? '';
    this.nativeError = false;
    this.nativeErrorText = '';
  }
  attributeChangedCallback(attribute, newValue, oldValue) {
    if (attribute === 'value' && this.dirty) {
      // After user input, changing the value attribute no longer updates the
      // text field's value (until reset). This matches native <input> behavior.
      return;
    }
    super.attributeChangedCallback(attribute, newValue, oldValue);
  }
  render() {
    const classes = {
      'disabled': this.disabled,
      'error': !this.disabled && this.hasError,
      'textarea': this.type === 'textarea',
      'no-spinner': this.noSpinner
    };
    return b`
      <span class="text-field ${e(classes)}">
        ${this.renderField()}
      </span>
    `;
  }
  updated(changedProperties) {
    // Keep changedProperties arg so that subclasses may call it
    // If a property such as `type` changes and causes the internal <input>
    // value to change without dispatching an event, re-sync it.
    const value = this.getInputOrTextarea().value;
    if (this.value !== value) {
      // Note this is typically inefficient in updated() since it schedules
      // another update. However, it is needed for the <input> to fully render
      // before checking its value.
      this.value = value;
    }
  }
  renderField() {
    return u`<${this.fieldTag}
      class="field"
      count=${this.value.length}
      ?disabled=${this.disabled}
      ?error=${this.hasError}
      error-text=${this.getErrorText()}
      ?focused=${this.focused}
      ?has-end=${this.hasTrailingIcon}
      ?has-start=${this.hasLeadingIcon}
      label=${this.label}
      ?no-asterisk=${this.noAsterisk}
      max=${this.maxLength}
      ?populated=${!!this.value}
      ?required=${this.required}
      ?resizable=${this.type === 'textarea'}
      supporting-text=${this.supportingText}
    >
      ${this.renderLeadingIcon()}
      ${this.renderInputOrTextarea()}
      ${this.renderTrailingIcon()}
      <div id="description" slot="aria-describedby"></div>
      <slot name="container" slot="container"></slot>
    </${this.fieldTag}>`;
  }
  renderLeadingIcon() {
    return b`
      <span class="icon leading" slot="start">
        <slot name="leading-icon" @slotchange=${this.handleIconChange}></slot>
      </span>
    `;
  }
  renderTrailingIcon() {
    return b`
      <span class="icon trailing" slot="end">
        <slot name="trailing-icon" @slotchange=${this.handleIconChange}></slot>
      </span>
    `;
  }
  renderInputOrTextarea() {
    const style = {
      'direction': this.textDirection
    };
    const ariaLabel = this.ariaLabel || this.label || A;
    // lit-anaylzer `autocomplete` types are too strict
    // tslint:disable-next-line:no-any
    const autocomplete = this.autocomplete;
    // These properties may be set to null if the attribute is removed, and
    // `null > -1` is incorrectly `true`.
    const hasMaxLength = (this.maxLength ?? -1) > -1;
    const hasMinLength = (this.minLength ?? -1) > -1;
    if (this.type === 'textarea') {
      return b`
        <textarea
          class="input"
          style=${o(style)}
          aria-describedby="description"
          aria-invalid=${this.hasError}
          aria-label=${ariaLabel}
          autocomplete=${autocomplete || A}
          name=${this.name || A}
          ?disabled=${this.disabled}
          maxlength=${hasMaxLength ? this.maxLength : A}
          minlength=${hasMinLength ? this.minLength : A}
          placeholder=${this.placeholder || A}
          ?readonly=${this.readOnly}
          ?required=${this.required}
          rows=${this.rows}
          cols=${this.cols}
          .value=${l(this.value)}
          @change=${this.redispatchEvent}
          @focus=${this.handleFocusChange}
          @blur=${this.handleFocusChange}
          @input=${this.handleInput}
          @select=${this.redispatchEvent}></textarea>
      `;
    }
    const prefix = this.renderPrefix();
    const suffix = this.renderSuffix();
    // TODO(b/243805848): remove `as unknown as number` and `as any` once lit
    // analyzer is fixed
    // tslint:disable-next-line:no-any
    const inputMode = this.inputMode;
    return b`
      <div class="input-wrapper">
        ${prefix}
        <input
          class="input"
          style=${o(style)}
          aria-describedby="description"
          aria-invalid=${this.hasError}
          aria-label=${ariaLabel}
          autocomplete=${autocomplete || A}
          name=${this.name || A}
          ?disabled=${this.disabled}
          inputmode=${inputMode || A}
          max=${this.max || A}
          maxlength=${hasMaxLength ? this.maxLength : A}
          min=${this.min || A}
          minlength=${hasMinLength ? this.minLength : A}
          pattern=${this.pattern || A}
          placeholder=${this.placeholder || A}
          ?readonly=${this.readOnly}
          ?required=${this.required}
          ?multiple=${this.multiple}
          step=${this.step || A}
          type=${this.type}
          .value=${l(this.value)}
          @change=${this.redispatchEvent}
          @focus=${this.handleFocusChange}
          @blur=${this.handleFocusChange}
          @input=${this.handleInput}
          @select=${this.redispatchEvent} />
        ${suffix}
      </div>
    `;
  }
  renderPrefix() {
    return this.renderAffix(this.prefixText, /* isSuffix */false);
  }
  renderSuffix() {
    return this.renderAffix(this.suffixText, /* isSuffix */true);
  }
  renderAffix(text, isSuffix) {
    if (!text) {
      return A;
    }
    const classes = {
      'suffix': isSuffix,
      'prefix': !isSuffix
    };
    return b`<span class="${e(classes)}">${text}</span>`;
  }
  getErrorText() {
    return this.error ? this.errorText : this.nativeErrorText;
  }
  handleFocusChange() {
    // When calling focus() or reportValidity() during change, it's possible
    // for blur to be called after the new focus event. Rather than set
    // `this.focused` to true/false on focus/blur, we always set it to whether
    // or not the input itself is focused.
    this.focused = this.inputOrTextarea?.matches(':focus') ?? false;
  }
  handleInput(event) {
    this.dirty = true;
    this.value = event.target.value;
  }
  redispatchEvent(event) {
    redispatchEvent(this, event);
  }
  getInputOrTextarea() {
    if (!this.inputOrTextarea) {
      // If the input is not yet defined, synchronously render.
      // e.g.
      // const textField = document.createElement('md-outlined-text-field');
      // document.body.appendChild(textField);
      // textField.focus(); // synchronously render
      this.connectedCallback();
      this.scheduleUpdate();
    }
    if (this.isUpdatePending) {
      // If there are pending updates, synchronously perform them. This ensures
      // that constraint validation properties (like `required`) are synced
      // before interacting with input APIs that depend on them.
      this.scheduleUpdate();
    }
    return this.inputOrTextarea;
  }
  getInput() {
    if (this.type === 'textarea') {
      return null;
    }
    return this.getInputOrTextarea();
  }
  handleIconChange() {
    this.hasLeadingIcon = this.leadingIcons.length > 0;
    this.hasTrailingIcon = this.trailingIcons.length > 0;
  }
  [getFormValue]() {
    return this.value;
  }
  formResetCallback() {
    this.reset();
  }
  formStateRestoreCallback(state) {
    this.value = state;
  }
  focus() {
    // Required for the case that the user slots a focusable element into the
    // leading icon slot such as an iconbutton due to how delegatesFocus works.
    this.getInputOrTextarea().focus();
  }
  [createValidator]() {
    return new TextFieldValidator(() => ({
      state: this,
      renderedControl: this.inputOrTextarea
    }));
  }
  [getValidityAnchor]() {
    return this.inputOrTextarea;
  }
  [onReportValidity](invalidEvent) {
    // Prevent default pop-up behavior.
    invalidEvent?.preventDefault();
    const prevMessage = this.getErrorText();
    this.nativeError = !!invalidEvent;
    this.nativeErrorText = this.validationMessage;
    if (prevMessage === this.getErrorText()) {
      this.field?.reannounceError();
    }
  }
}
/** @nocollapse */
TextField.shadowRootOptions = {
  ...i$3.shadowRootOptions,
  delegatesFocus: true
};
__decorate([n$2({
  type: Boolean,
  reflect: true
})], TextField.prototype, "error", void 0);
__decorate([n$2({
  attribute: 'error-text'
})], TextField.prototype, "errorText", void 0);
__decorate([n$2()], TextField.prototype, "label", void 0);
__decorate([n$2({
  type: Boolean,
  attribute: 'no-asterisk'
})], TextField.prototype, "noAsterisk", void 0);
__decorate([n$2({
  type: Boolean,
  reflect: true
})], TextField.prototype, "required", void 0);
__decorate([n$2()], TextField.prototype, "value", void 0);
__decorate([n$2({
  attribute: 'prefix-text'
})], TextField.prototype, "prefixText", void 0);
__decorate([n$2({
  attribute: 'suffix-text'
})], TextField.prototype, "suffixText", void 0);
__decorate([n$2({
  type: Boolean,
  attribute: 'has-leading-icon'
})], TextField.prototype, "hasLeadingIcon", void 0);
__decorate([n$2({
  type: Boolean,
  attribute: 'has-trailing-icon'
})], TextField.prototype, "hasTrailingIcon", void 0);
__decorate([n$2({
  attribute: 'supporting-text'
})], TextField.prototype, "supportingText", void 0);
__decorate([n$2({
  attribute: 'text-direction'
})], TextField.prototype, "textDirection", void 0);
__decorate([n$2({
  type: Number
})], TextField.prototype, "rows", void 0);
__decorate([n$2({
  type: Number
})], TextField.prototype, "cols", void 0);
__decorate([n$2({
  reflect: true
})], TextField.prototype, "inputMode", void 0);
__decorate([n$2()], TextField.prototype, "max", void 0);
__decorate([n$2({
  type: Number
})], TextField.prototype, "maxLength", void 0);
__decorate([n$2()], TextField.prototype, "min", void 0);
__decorate([n$2({
  type: Number
})], TextField.prototype, "minLength", void 0);
__decorate([n$2({
  type: Boolean,
  attribute: 'no-spinner'
})], TextField.prototype, "noSpinner", void 0);
__decorate([n$2()], TextField.prototype, "pattern", void 0);
__decorate([n$2({
  reflect: true,
  converter: stringConverter
})], TextField.prototype, "placeholder", void 0);
__decorate([n$2({
  type: Boolean,
  reflect: true
})], TextField.prototype, "readOnly", void 0);
__decorate([n$2({
  type: Boolean,
  reflect: true
})], TextField.prototype, "multiple", void 0);
__decorate([n$2()], TextField.prototype, "step", void 0);
__decorate([n$2({
  reflect: true
})], TextField.prototype, "type", void 0);
__decorate([n$2({
  reflect: true
})], TextField.prototype, "autocomplete", void 0);
__decorate([r$1()], TextField.prototype, "dirty", void 0);
__decorate([r$1()], TextField.prototype, "focused", void 0);
__decorate([r$1()], TextField.prototype, "nativeError", void 0);
__decorate([r$1()], TextField.prototype, "nativeErrorText", void 0);
__decorate([e$2('.input')], TextField.prototype, "inputOrTextarea", void 0);
__decorate([e$2('.field')], TextField.prototype, "field", void 0);
__decorate([o$2({
  slot: 'leading-icon'
})], TextField.prototype, "leadingIcons", void 0);
__decorate([o$2({
  slot: 'trailing-icon'
})], TextField.prototype, "trailingIcons", void 0);

/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * An outlined text field component
 */
class OutlinedTextField extends TextField {
  constructor() {
    super(...arguments);
    this.fieldTag = i$1`md-outlined-field`;
  }
}

/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// Generated stylesheet for ./textfield/internal/shared-styles.css.
const styles$1 = i$6`:host{display:inline-flex;outline:none;resize:both;text-align:start;-webkit-tap-highlight-color:rgba(0,0,0,0)}.text-field,.field{width:100%}.text-field{display:inline-flex}.field{cursor:text}.disabled .field{cursor:default}.text-field,.textarea .field{resize:inherit}slot[name=container]{border-radius:inherit}.icon{color:currentColor;display:flex;align-items:center;justify-content:center;fill:currentColor;position:relative}.icon ::slotted(*){display:flex;position:absolute}[has-start] .icon.leading{font-size:var(--_leading-icon-size);height:var(--_leading-icon-size);width:var(--_leading-icon-size)}[has-end] .icon.trailing{font-size:var(--_trailing-icon-size);height:var(--_trailing-icon-size);width:var(--_trailing-icon-size)}.input-wrapper{display:flex}.input-wrapper>*{all:inherit;padding:0}.input{caret-color:var(--_caret-color);overflow-x:hidden;text-align:inherit}.input::placeholder{color:currentColor;opacity:1}.input::-webkit-calendar-picker-indicator{display:none}.input::-webkit-search-decoration,.input::-webkit-search-cancel-button{display:none}@media(forced-colors: active){.input{background:none}}.no-spinner .input::-webkit-inner-spin-button,.no-spinner .input::-webkit-outer-spin-button{display:none}.no-spinner .input[type=number]{-moz-appearance:textfield}:focus-within .input{caret-color:var(--_focus-caret-color)}.error:focus-within .input{caret-color:var(--_error-focus-caret-color)}.text-field:not(.disabled) .prefix{color:var(--_input-text-prefix-color)}.text-field:not(.disabled) .suffix{color:var(--_input-text-suffix-color)}.text-field:not(.disabled) .input::placeholder{color:var(--_input-text-placeholder-color)}.prefix,.suffix{text-wrap:nowrap;width:min-content}.prefix{padding-inline-end:var(--_input-text-prefix-trailing-space)}.suffix{padding-inline-start:var(--_input-text-suffix-leading-space)}
`;

/**
 * @license
 * Copyright 2021 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * TODO(b/228525797): Add docs
 * @final
 * @suppress {visibility}
 */
let MdOutlinedTextField = class MdOutlinedTextField extends OutlinedTextField {
  constructor() {
    super(...arguments);
    this.fieldTag = i$1`md-outlined-field`;
  }
};
MdOutlinedTextField.styles = [styles$1, styles$2];
MdOutlinedTextField = __decorate([t$1('md-outlined-text-field')], MdOutlinedTextField);

/**
 * @license
 * Copyright 2023 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * A validator that provides constraint validation that emulates
 * `<input type="checkbox">` validation.
 */
class CheckboxValidator extends Validator {
  computeValidity(state) {
    if (!this.checkboxControl) {
      // Lazily create the platform input
      this.checkboxControl = document.createElement('input');
      this.checkboxControl.type = 'checkbox';
    }
    this.checkboxControl.checked = state.checked;
    this.checkboxControl.required = state.required;
    return {
      validity: this.checkboxControl.validity,
      validationMessage: this.checkboxControl.validationMessage
    };
  }
  equals(prev, next) {
    return prev.checked === next.checked && prev.required === next.required;
  }
  copy({
    checked,
    required
  }) {
    return {
      checked,
      required
    };
  }
}

/**
 * @license
 * Copyright 2019 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// Separate variable needed for closure.
const checkboxBaseClass = mixinDelegatesAria(mixinConstraintValidation(mixinFormAssociated(mixinElementInternals(i$3))));
/**
 * A checkbox component.
 *
 *
 * @fires change {Event} The native `change` event on
 * [`<input>`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/change_event)
 * --bubbles
 * @fires input {InputEvent} The native `input` event on
 * [`<input>`](https://developer.mozilla.org/en-US/docs/Web/API/HTMLElement/input_event)
 * --bubbles --composed
 */
class Checkbox extends checkboxBaseClass {
  constructor() {
    super();
    /**
     * Whether or not the checkbox is selected.
     */
    this.checked = false;
    /**
     * Whether or not the checkbox is indeterminate.
     *
     * https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/checkbox#indeterminate_state_checkboxes
     */
    this.indeterminate = false;
    /**
     * When true, require the checkbox to be selected when participating in
     * form submission.
     *
     * https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/checkbox#validation
     */
    this.required = false;
    /**
     * The value of the checkbox that is submitted with a form when selected.
     *
     * https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/checkbox#value
     */
    this.value = 'on';
    this.prevChecked = false;
    this.prevDisabled = false;
    this.prevIndeterminate = false;
    {
      this.addEventListener('click', event => {
        if (!isActivationClick(event) || !this.input) {
          return;
        }
        this.focus();
        dispatchActivationClick(this.input);
      });
    }
  }
  update(changed) {
    if (changed.has('checked') || changed.has('disabled') || changed.has('indeterminate')) {
      this.prevChecked = changed.get('checked') ?? this.checked;
      this.prevDisabled = changed.get('disabled') ?? this.disabled;
      this.prevIndeterminate = changed.get('indeterminate') ?? this.indeterminate;
    }
    super.update(changed);
  }
  render() {
    const prevNone = !this.prevChecked && !this.prevIndeterminate;
    const prevChecked = this.prevChecked && !this.prevIndeterminate;
    const prevIndeterminate = this.prevIndeterminate;
    const isChecked = this.checked && !this.indeterminate;
    const isIndeterminate = this.indeterminate;
    const containerClasses = e({
      'disabled': this.disabled,
      'selected': isChecked || isIndeterminate,
      'unselected': !isChecked && !isIndeterminate,
      'checked': isChecked,
      'indeterminate': isIndeterminate,
      'prev-unselected': prevNone,
      'prev-checked': prevChecked,
      'prev-indeterminate': prevIndeterminate,
      'prev-disabled': this.prevDisabled
    });
    // Needed for closure conformance
    const {
      ariaLabel,
      ariaInvalid
    } = this;
    // Note: <input> needs to be rendered before the <svg> for
    // form.reportValidity() to work in Chrome.
    return b`
      <div class="container ${containerClasses}">
        <input
          type="checkbox"
          id="input"
          aria-checked=${isIndeterminate ? 'mixed' : A}
          aria-label=${ariaLabel || A}
          aria-invalid=${ariaInvalid || A}
          ?disabled=${this.disabled}
          ?required=${this.required}
          .indeterminate=${this.indeterminate}
          .checked=${this.checked}
          @input=${this.handleInput}
          @change=${this.handleChange} />

        <div class="outline"></div>
        <div class="background"></div>
        <md-focus-ring part="focus-ring" for="input"></md-focus-ring>
        <md-ripple for="input" ?disabled=${this.disabled}></md-ripple>
        <svg class="icon" viewBox="0 0 18 18" aria-hidden="true">
          <rect class="mark short" />
          <rect class="mark long" />
        </svg>
      </div>
    `;
  }
  handleInput(event) {
    const target = event.target;
    this.checked = target.checked;
    this.indeterminate = target.indeterminate;
    // <input> 'input' event bubbles and is composed, don't re-dispatch it.
  }
  handleChange(event) {
    // <input> 'change' event is not composed, re-dispatch it.
    redispatchEvent(this, event);
  }
  [getFormValue]() {
    if (!this.checked || this.indeterminate) {
      return null;
    }
    return this.value;
  }
  [getFormState]() {
    return String(this.checked);
  }
  formResetCallback() {
    // The checked property does not reflect, so the original attribute set by
    // the user is used to determine the default value.
    this.checked = this.hasAttribute('checked');
  }
  formStateRestoreCallback(state) {
    this.checked = state === 'true';
  }
  [createValidator]() {
    return new CheckboxValidator(() => this);
  }
  [getValidityAnchor]() {
    return this.input;
  }
}
/** @nocollapse */
Checkbox.shadowRootOptions = {
  ...i$3.shadowRootOptions,
  delegatesFocus: true
};
__decorate([n$2({
  type: Boolean
})], Checkbox.prototype, "checked", void 0);
__decorate([n$2({
  type: Boolean
})], Checkbox.prototype, "indeterminate", void 0);
__decorate([n$2({
  type: Boolean
})], Checkbox.prototype, "required", void 0);
__decorate([n$2()], Checkbox.prototype, "value", void 0);
__decorate([r$1()], Checkbox.prototype, "prevChecked", void 0);
__decorate([r$1()], Checkbox.prototype, "prevDisabled", void 0);
__decorate([r$1()], Checkbox.prototype, "prevIndeterminate", void 0);
__decorate([e$2('input')], Checkbox.prototype, "input", void 0);

/**
 * @license
 * Copyright 2024 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
// Generated stylesheet for ./checkbox/internal/checkbox-styles.css.
const styles = i$6`:host{border-start-start-radius:var(--md-checkbox-container-shape-start-start, var(--md-checkbox-container-shape, 2px));border-start-end-radius:var(--md-checkbox-container-shape-start-end, var(--md-checkbox-container-shape, 2px));border-end-end-radius:var(--md-checkbox-container-shape-end-end, var(--md-checkbox-container-shape, 2px));border-end-start-radius:var(--md-checkbox-container-shape-end-start, var(--md-checkbox-container-shape, 2px));display:inline-flex;height:var(--md-checkbox-container-size, 18px);position:relative;vertical-align:top;width:var(--md-checkbox-container-size, 18px);-webkit-tap-highlight-color:rgba(0,0,0,0);cursor:pointer}:host([disabled]){cursor:default}:host([touch-target=wrapper]){margin:max(0px,(48px - var(--md-checkbox-container-size, 18px))/2)}md-focus-ring{height:44px;inset:unset;width:44px}input{appearance:none;height:48px;margin:0;opacity:0;outline:none;position:absolute;width:48px;z-index:1;cursor:inherit}:host([touch-target=none]) input{height:100%;width:100%}.container{border-radius:inherit;display:flex;height:100%;place-content:center;place-items:center;position:relative;width:100%}.outline,.background,.icon{inset:0;position:absolute}.outline,.background{border-radius:inherit}.outline{border-color:var(--md-checkbox-outline-color, var(--md-sys-color-on-surface-variant, #49454f));border-style:solid;border-width:var(--md-checkbox-outline-width, 2px);box-sizing:border-box}.background{background-color:var(--md-checkbox-selected-container-color, var(--md-sys-color-primary, #6750a4))}.background,.icon{opacity:0;transition-duration:150ms,50ms;transition-property:transform,opacity;transition-timing-function:cubic-bezier(0.3, 0, 0.8, 0.15),linear;transform:scale(0.6)}:where(.selected) :is(.background,.icon){opacity:1;transition-duration:350ms,50ms;transition-timing-function:cubic-bezier(0.05, 0.7, 0.1, 1),linear;transform:scale(1)}md-ripple{border-radius:var(--md-checkbox-state-layer-shape, var(--md-sys-shape-corner-full, 9999px));height:var(--md-checkbox-state-layer-size, 40px);inset:unset;width:var(--md-checkbox-state-layer-size, 40px);--md-ripple-hover-color: var(--md-checkbox-hover-state-layer-color, var(--md-sys-color-on-surface, #1d1b20));--md-ripple-hover-opacity: var(--md-checkbox-hover-state-layer-opacity, 0.08);--md-ripple-pressed-color: var(--md-checkbox-pressed-state-layer-color, var(--md-sys-color-primary, #6750a4));--md-ripple-pressed-opacity: var(--md-checkbox-pressed-state-layer-opacity, 0.12)}.selected md-ripple{--md-ripple-hover-color: var(--md-checkbox-selected-hover-state-layer-color, var(--md-sys-color-primary, #6750a4));--md-ripple-hover-opacity: var(--md-checkbox-selected-hover-state-layer-opacity, 0.08);--md-ripple-pressed-color: var(--md-checkbox-selected-pressed-state-layer-color, var(--md-sys-color-on-surface, #1d1b20));--md-ripple-pressed-opacity: var(--md-checkbox-selected-pressed-state-layer-opacity, 0.12)}.icon{fill:var(--md-checkbox-selected-icon-color, var(--md-sys-color-on-primary, #fff));height:var(--md-checkbox-icon-size, 18px);width:var(--md-checkbox-icon-size, 18px)}.mark.short{height:2px;transition-property:transform,height;width:2px}.mark.long{height:2px;transition-property:transform,width;width:10px}.mark{animation-duration:150ms;animation-timing-function:cubic-bezier(0.3, 0, 0.8, 0.15);transition-duration:150ms;transition-timing-function:cubic-bezier(0.3, 0, 0.8, 0.15)}.selected .mark{animation-duration:350ms;animation-timing-function:cubic-bezier(0.05, 0.7, 0.1, 1);transition-duration:350ms;transition-timing-function:cubic-bezier(0.05, 0.7, 0.1, 1)}.checked .mark,.prev-checked.unselected .mark{transform:scaleY(-1) translate(7px, -14px) rotate(45deg)}.checked .mark.short,.prev-checked.unselected .mark.short{height:5.6568542495px}.checked .mark.long,.prev-checked.unselected .mark.long{width:11.313708499px}.indeterminate .mark,.prev-indeterminate.unselected .mark{transform:scaleY(-1) translate(4px, -10px) rotate(0deg)}.prev-unselected .mark{transition-property:none}.prev-unselected.checked .mark.long{animation-name:prev-unselected-to-checked}@keyframes prev-unselected-to-checked{from{width:0}}:where(:hover) .outline{border-color:var(--md-checkbox-hover-outline-color, var(--md-sys-color-on-surface, #1d1b20));border-width:var(--md-checkbox-hover-outline-width, 2px)}:where(:hover) .background{background:var(--md-checkbox-selected-hover-container-color, var(--md-sys-color-primary, #6750a4))}:where(:hover) .icon{fill:var(--md-checkbox-selected-hover-icon-color, var(--md-sys-color-on-primary, #fff))}:where(:focus-within) .outline{border-color:var(--md-checkbox-focus-outline-color, var(--md-sys-color-on-surface, #1d1b20));border-width:var(--md-checkbox-focus-outline-width, 2px)}:where(:focus-within) .background{background:var(--md-checkbox-selected-focus-container-color, var(--md-sys-color-primary, #6750a4))}:where(:focus-within) .icon{fill:var(--md-checkbox-selected-focus-icon-color, var(--md-sys-color-on-primary, #fff))}:where(:active) .outline{border-color:var(--md-checkbox-pressed-outline-color, var(--md-sys-color-on-surface, #1d1b20));border-width:var(--md-checkbox-pressed-outline-width, 2px)}:where(:active) .background{background:var(--md-checkbox-selected-pressed-container-color, var(--md-sys-color-primary, #6750a4))}:where(:active) .icon{fill:var(--md-checkbox-selected-pressed-icon-color, var(--md-sys-color-on-primary, #fff))}:where(.disabled,.prev-disabled) :is(.background,.icon,.mark){animation-duration:0s;transition-duration:0s}:where(.disabled) .outline{border-color:var(--md-checkbox-disabled-outline-color, var(--md-sys-color-on-surface, #1d1b20));border-width:var(--md-checkbox-disabled-outline-width, 2px);opacity:var(--md-checkbox-disabled-container-opacity, 0.38)}:where(.selected.disabled) .outline{visibility:hidden}:where(.selected.disabled) .background{background:var(--md-checkbox-selected-disabled-container-color, var(--md-sys-color-on-surface, #1d1b20));opacity:var(--md-checkbox-selected-disabled-container-opacity, 0.38)}:where(.disabled) .icon{fill:var(--md-checkbox-selected-disabled-icon-color, var(--md-sys-color-surface, #fef7ff))}@media(forced-colors: active){.background{background-color:CanvasText}.selected.disabled .background{background-color:GrayText;opacity:1}.outline{border-color:CanvasText}.disabled .outline{border-color:GrayText;opacity:1}.icon{fill:Canvas}}
`;

/**
 * @license
 * Copyright 2018 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */
/**
 * @summary Checkboxes allow users to select one or more items from a set.
 * Checkboxes can turn an option on or off.
 *
 * @description
 * Use checkboxes to:
 * - Select one or more options from a list
 * - Present a list containing sub-selections
 * - Turn an item on or off in a desktop environment
 *
 * @final
 * @suppress {visibility}
 */
let MdCheckbox = class MdCheckbox extends Checkbox {};
MdCheckbox.styles = [styles];
MdCheckbox = __decorate([t$1('md-checkbox')], MdCheckbox);

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--) if (decorator = decorators[i]) result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};
let LoginScreen = class extends i$3 {
  constructor() {
    super(...arguments);
    this._ipAddress = "";
    this._username = "";
    this._password = "";
    this._loading = false;
    this._error = "";
  }
  _handleLogin() {
    if (!this._ipAddress || !this._username || !this._password) {
      this._error = "Please fill in all fields.";
      return;
    }
    this._error = "";
    this._loading = true;
    setTimeout(() => {
      let host = this._ipAddress.trim();
      if (!host.startsWith("http") && !host.startsWith("ws")) {
        host = "ws://" + host;
      }
      try {
        const urlObj = new URL(host);
        if (urlObj.port === "8123") {
          urlObj.port = "5580";
        }
        if (urlObj.protocol === "http:") urlObj.protocol = "ws:";
        if (urlObj.protocol === "https:") urlObj.protocol = "wss:";
        if (!urlObj.pathname.endsWith("/ws")) {
          urlObj.pathname = urlObj.pathname.replace(/\/$/, "") + "/ws";
        }
        const finalUrl = urlObj.toString();
        this.dispatchEvent(new CustomEvent("login-success", {
          detail: {
            url: finalUrl,
            username: this._username
          }
        }));
      } catch (e) {
        this._error = "Invalid IP address or URL.";
        this._loading = false;
      }
    }, 1e3);
  }
  render() {
    return b`
            <div class="login-card">
                <div class="header">
                    <!-- Simple Matter/HA Logo Placeholder -->
                    <svg viewBox="0 0 24 24" width="64" height="64" style="fill: #03a9f4; margin-bottom: 16px;">
                        <path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M12,6A6,6 0 0,0 6,12A6,6 0 0,0 12,18A6,6 0 0,0 18,12A6,6 0 0,0 12,6M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8Z" />
                    </svg>
                    <h1>Log In</h1>
                </div>

                <div class="form-group">
                    <md-outlined-text-field 
                        label="Hub IP Address (e.g. 192.168.0.41:8123)" 
                        value="${this._ipAddress}"
                        @input="${e => this._ipAddress = e.target.value}">
                    </md-outlined-text-field>

                    <md-outlined-text-field 
                        label="Username" 
                        value="${this._username}"
                        @input="${e => this._username = e.target.value}">
                    </md-outlined-text-field>

                    <md-outlined-text-field 
                        label="Password" 
                        type="password"
                        value="${this._password}"
                        @input="${e => this._password = e.target.value}"
                        @keydown="${e => e.key === "Enter" && this._handleLogin()}">
                    </md-outlined-text-field>

                    ${this._error ? b`<div class="error">${this._error}</div>` : ""}
                </div>

                <div class="actions">
                    <md-filled-button 
                        @click="${this._handleLogin}" 
                        ?disabled="${this._loading}">
                        ${this._loading ? "CONNECTING..." : "LOG IN"}
                    </md-filled-button>
                </div>
            </div>
        `;
  }
};
LoginScreen.styles = i$6`
        :host {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background-color: #03a9f4; /* Home Assistant blue style background */
        }
        
        .login-card {
            background: var(--md-sys-color-surface, #ffffff);
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.08);
            width: 100%;
            max-width: 400px;
            padding: 32px;
            display: flex;
            flex-direction: column;
            gap: 24px;
        }

        .header {
            text-align: center;
        }

        .header img {
            width: 64px;
            height: 64px;
            margin-bottom: 16px;
        }

        .header h1 {
            margin: 0;
            font-size: 24px;
            font-weight: 400;
            color: var(--md-sys-color-on-surface);
            font-family: Roboto, sans-serif;
        }

        .form-group {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        md-outlined-text-field {
            width: 100%;
        }

        .actions {
            display: flex;
            justify-content: flex-end;
            margin-top: 8px;
        }

        .error {
            color: var(--md-sys-color-error, #b3261e);
            font-size: 14px;
            margin-top: -8px;
        }
    `;
__decorateClass([r$1()], LoginScreen.prototype, "_ipAddress", 2);
__decorateClass([r$1()], LoginScreen.prototype, "_username", 2);
__decorateClass([r$1()], LoginScreen.prototype, "_password", 2);
__decorateClass([r$1()], LoginScreen.prototype, "_loading", 2);
__decorateClass([r$1()], LoginScreen.prototype, "_error", 2);
LoginScreen = __decorateClass([t$1("login-screen")], LoginScreen);

/**
 * @license
 * Copyright 2025-2026 Open Home Foundation
 * SPDX-License-Identifier: Apache-2.0
 */
async function main() {
  import('./matter-dashboard-app-A2CxdMlw.js').then(function (n) { return n.z; });
  const isProductionServer = window.__MATTERJS_PRODUCTION_MODE__ === true || location.origin.includes(":5580") || location.href.includes("hassio_ingress") || location.href.includes("/api/ingress/");
  const initDashboard = socketUrl => {
    const client = new MatterClient(socketUrl);
    client.isProduction = isProductionServer;
    const dashboard = document.createElement("matter-dashboard-app");
    dashboard.client = client;
    document.body.innerHTML = "";
    document.body.append(dashboard);
  };
  const buildSocketUrl = ipInput => {
    try {
      let host = (ipInput || location.host).trim();
      if (!host.startsWith("http") && !host.startsWith("ws")) host = "ws://" + host;
      const urlObj = new URL(host);
      if (urlObj.port === "8123") urlObj.port = "5580";
      if (urlObj.protocol === "http:") urlObj.protocol = "ws:";
      if (urlObj.protocol === "https:") urlObj.protocol = "wss:";
      if (!urlObj.pathname.endsWith("/ws")) {
        urlObj.pathname = urlObj.pathname.replace(/\/$/, "") + "/ws";
      }
      return urlObj.toString();
    } catch {
      return null;
    }
  };
  const params = new URLSearchParams(location.search);
  if (params.get("ac") === "1") {
    const autoUrl = buildSocketUrl(params.get("ip"));
    if (autoUrl) {
      localStorage.setItem("matterURL", autoUrl);
      localStorage.setItem("authToken", params.get("user") || "dhanush");
      initDashboard(autoUrl);
      return;
    }
  }
  const loginScreen = document.createElement("login-screen");
  loginScreen.addEventListener("login-success", e => {
    const finalUrl = e.detail.url;
    const user = e.detail.username;
    localStorage.setItem("matterURL", finalUrl);
    localStorage.setItem("authToken", user);
    initDashboard(finalUrl);
  });
  document.body.innerHTML = "";
  document.body.append(loginScreen);
}
main();

export { A, Button as B, mixinFormAssociated as C, D, E, onReportValidity as F, redispatchEvent as G, getFormValue as H, createValidator as I, getValidityAnchor as J, r as K, isActivationClick as L, dispatchActivationClick as M, getFormState as N, CheckboxValidator as O, toBigIntAwareJson as P, parseBigIntAwareJson as Q, ThemeService as T, Validator as V, __decorate as _, i$6 as a, b, mixinElementInternals as c, setupFormSubmitter as d, e$3 as e, internals as f, i$1 as g, e as h, i$3 as i, e$2 as j, i$2 as k, t as l, mixinDelegatesAria as m, n$2 as n, o$2 as o, e$1 as p, createAnimationSignal as q, r$1 as r, styles$5 as s, t$1 as t, u, o as v, w, EASING as x, mixinOnReportValidity as y, mixinConstraintValidation as z };
