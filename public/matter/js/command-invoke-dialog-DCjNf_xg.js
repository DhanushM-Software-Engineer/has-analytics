import { g as formatHex, h as handleAsync } from './matter-dashboard-app-A2CxdMlw.js';
import { a as i, n, r, j as e, i as i$1, P as toBigIntAwareJson, A, b, t } from './main.js';
import { p as preventDefault } from './prevent_default-D-ohDGsN.js';
import { p as parseJsonPayload, i as isPlainObject } from './parse-json-payload-DMZKDRli.js';

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--) if (decorator = decorators[i]) result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};
let CommandInvokeDialog = class extends i$1 {
  constructor() {
    super(...arguments);
    this._busy = false;
    this._error = null;
    this._response = null;
    this._success = false;
  }
  firstUpdated() {
    if (this._textarea && this._textarea.value === "") {
      this._textarea.value = "{}";
    }
  }
  _close() {
    this.shadowRoot.querySelector("md-dialog").close();
  }
  _handleClosed() {
    this.parentNode.removeChild(this);
  }
  async _invoke() {
    this._error = null;
    this._success = false;
    const parsed = parseJsonPayload(this._textarea.value);
    if (!parsed.ok) {
      this._error = `Invalid JSON: ${parsed.error}`;
      this._response = null;
      return;
    }
    const payload = parsed.value;
    if (!isPlainObject(payload)) {
      this._error = "Payload must be a JSON object (use {} for commands with no arguments).";
      this._response = null;
      return;
    }
    this._busy = true;
    try {
      const result = await this.client.deviceCommand(this.nodeId, this.endpointId, this.clusterId, this.commandName, payload);
      if (result === null || result === void 0) {
        this._success = true;
        this._response = null;
      } else {
        this._response = toBigIntAwareJson(result, 2);
        this._success = false;
      }
      this._error = null;
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
      this._response = null;
      this._success = false;
    } finally {
      this._busy = false;
    }
  }
  render() {
    return b`
            <md-dialog open @cancel=${preventDefault} @closed=${this._handleClosed}>
                <div slot="headline">Invoke ${this.commandName}</div>
                <div slot="content">
                    <p class="path" id="invoke-path">
                        Cluster <code>${this.clusterId}</code> (${formatHex(this.clusterId)}) · Endpoint
                        <code>${this.endpointId}</code> · Command <code>${this.commandId}</code> (${formatHex(this.commandId)})
                        · <code>${this.commandName}</code>
                    </p>
                    <label class="textarea-label" for="payload">Payload (JSON)</label>
                    <textarea
                        id="payload"
                        class="payload"
                        spellcheck="false"
                        autocomplete="off"
                        autocapitalize="off"
                        aria-describedby="invoke-path${this._error ? " invoke-error" : ""}"
                        rows="8"
                    ></textarea>
                    ${this._error ? b`<div id="invoke-error" class="error" role="alert">${this._error}</div>` : A}
                    ${this._success ? b`<div class="success" role="status">Success</div>` : A}
                    ${this._response !== null ? b`
                              <label class="textarea-label">Response</label>
                              <pre class="response"><code>${this._response}</code></pre>
                          ` : A}
                </div>
                <div slot="actions">
                    <md-text-button @click=${this._close} ?disabled=${this._busy}>Close</md-text-button>
                    <md-text-button @click=${handleAsync(() => this._invoke())} ?disabled=${this._busy}>
                        ${this._busy ? "Invoking..." : "Invoke"}
                    </md-text-button>
                </div>
            </md-dialog>
        `;
  }
};
CommandInvokeDialog.styles = i`
        md-dialog {
            min-width: 520px;
            max-width: 720px;
        }

        .path {
            margin: 0 0 12px 0;
            font-size: 0.85rem;
            color: var(--md-sys-color-on-surface-variant);
        }

        .path code {
            font-family: var(--monospace-font);
            background: var(--md-sys-color-surface-container-high);
            padding: 0 4px;
            border-radius: 3px;
        }

        .textarea-label {
            display: block;
            margin: 6px 0 6px 0;
            font-size: 0.85rem;
            font-weight: 500;
            color: var(--md-sys-color-on-surface);
        }

        .payload {
            width: 100%;
            box-sizing: border-box;
            font-family: var(--monospace-font);
            font-size: 0.9rem;
            padding: 8px;
            background: var(--md-sys-color-surface-container-low);
            color: var(--md-sys-color-on-surface);
            border: 1px solid var(--md-sys-color-outline);
            border-radius: 6px;
            resize: vertical;
            min-height: 120px;
        }

        .payload:focus {
            outline: 2px solid var(--dev-color);
            outline-offset: -1px;
        }

        .error {
            margin-top: 10px;
            padding: 10px 12px;
            background: var(--md-sys-color-error-container);
            color: var(--md-sys-color-on-error-container);
            border-radius: 6px;
            font-size: 0.875rem;
            white-space: pre-wrap;
            word-break: break-word;
        }

        .success {
            margin-top: 10px;
            padding: 10px 12px;
            background: color-mix(in srgb, var(--success-color) 18%, transparent);
            color: var(--success-color);
            border: 1px solid color-mix(in srgb, var(--success-color) 40%, transparent);
            border-radius: 6px;
            font-size: 0.9rem;
            font-weight: 500;
        }

        .response {
            margin: 6px 0 0 0;
            padding: 10px 12px;
            background: var(--md-sys-color-surface-container-low);
            color: var(--md-sys-color-on-surface);
            border: 1px solid var(--md-sys-color-outline);
            border-radius: 6px;
            max-height: 260px;
            overflow: auto;
            font-size: 0.85rem;
        }

        .response code {
            font-family: var(--monospace-font);
            white-space: pre-wrap;
            word-break: break-word;
        }
    `;
__decorateClass([n({
  attribute: false
})], CommandInvokeDialog.prototype, "client", 2);
__decorateClass([n({
  type: Number
})], CommandInvokeDialog.prototype, "nodeId", 2);
__decorateClass([n({
  type: Number
})], CommandInvokeDialog.prototype, "endpointId", 2);
__decorateClass([n({
  type: Number
})], CommandInvokeDialog.prototype, "clusterId", 2);
__decorateClass([n({
  type: Number
})], CommandInvokeDialog.prototype, "commandId", 2);
__decorateClass([n({
  type: String
})], CommandInvokeDialog.prototype, "commandName", 2);
__decorateClass([r()], CommandInvokeDialog.prototype, "_busy", 2);
__decorateClass([r()], CommandInvokeDialog.prototype, "_error", 2);
__decorateClass([r()], CommandInvokeDialog.prototype, "_response", 2);
__decorateClass([r()], CommandInvokeDialog.prototype, "_success", 2);
__decorateClass([e("textarea")], CommandInvokeDialog.prototype, "_textarea", 2);
CommandInvokeDialog = __decorateClass([t("command-invoke-dialog")], CommandInvokeDialog);

export { CommandInvokeDialog };
