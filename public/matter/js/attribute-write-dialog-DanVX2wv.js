import { g as formatHex, h as handleAsync } from './matter-dashboard-app-A2CxdMlw.js';
import { a as i, n, r, j as e, i as i$1, P as toBigIntAwareJson, A, b, t } from './main.js';
import { p as preventDefault } from './prevent_default-D-ohDGsN.js';
import { p as parseJsonPayload } from './parse-json-payload-DMZKDRli.js';

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--) if (decorator = decorators[i]) result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};
let AttributeWriteDialog = class extends i$1 {
  constructor() {
    super(...arguments);
    this.currentValue = null;
    this._busy = false;
    this._error = null;
  }
  firstUpdated() {
    if (this._textarea && this._textarea.value === "") {
      this._textarea.value = toBigIntAwareJson(this.currentValue ?? null, 2);
    }
  }
  get _attributePath() {
    return `${this.endpointId}/${this.clusterId}/${this.attributeId}`;
  }
  _close() {
    this.shadowRoot.querySelector("md-dialog").close();
  }
  _handleClosed() {
    this.parentNode.removeChild(this);
  }
  async _write() {
    this._error = null;
    const parsed = parseJsonPayload(this._textarea.value);
    if (!parsed.ok) {
      this._error = `Invalid JSON: ${parsed.error}`;
      return;
    }
    this._busy = true;
    try {
      await this.client.writeAttribute(this.nodeId, this._attributePath, parsed.value);
      this._close();
    } catch (err) {
      this._error = err instanceof Error ? err.message : String(err);
    } finally {
      this._busy = false;
    }
  }
  render() {
    return b`
            <md-dialog open @cancel=${preventDefault} @closed=${this._handleClosed}>
                <div slot="headline">Write ${this.label}</div>
                <div slot="content">
                    <p class="path" id="write-path">
                        Path <code>${this._attributePath}</code>
                        (${formatHex(this.endpointId)}/${formatHex(this.clusterId)}/${formatHex(this.attributeId)})
                    </p>
                    <label class="textarea-label" for="write-payload">Value (JSON)</label>
                    <textarea
                        id="write-payload"
                        class="payload"
                        spellcheck="false"
                        autocomplete="off"
                        autocapitalize="off"
                        aria-describedby="write-path${this._error ? " write-error" : ""}"
                        rows="10"
                    ></textarea>
                    ${this._error ? b`<div id="write-error" class="error" role="alert">${this._error}</div>` : A}
                </div>
                <div slot="actions">
                    <md-text-button @click=${this._close} ?disabled=${this._busy}>Cancel</md-text-button>
                    <md-text-button @click=${handleAsync(() => this._write())} ?disabled=${this._busy}>
                        ${this._busy ? "Writing..." : "Write"}
                    </md-text-button>
                </div>
            </md-dialog>
        `;
  }
};
AttributeWriteDialog.styles = i`
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
            margin: 0 0 6px 0;
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
            min-height: 140px;
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
    `;
__decorateClass([n({
  attribute: false
})], AttributeWriteDialog.prototype, "client", 2);
__decorateClass([n({
  type: Number
})], AttributeWriteDialog.prototype, "nodeId", 2);
__decorateClass([n({
  type: Number
})], AttributeWriteDialog.prototype, "endpointId", 2);
__decorateClass([n({
  type: Number
})], AttributeWriteDialog.prototype, "clusterId", 2);
__decorateClass([n({
  type: Number
})], AttributeWriteDialog.prototype, "attributeId", 2);
__decorateClass([n({
  type: String
})], AttributeWriteDialog.prototype, "label", 2);
__decorateClass([n({
  attribute: false
})], AttributeWriteDialog.prototype, "currentValue", 2);
__decorateClass([r()], AttributeWriteDialog.prototype, "_busy", 2);
__decorateClass([r()], AttributeWriteDialog.prototype, "_error", 2);
__decorateClass([e("textarea")], AttributeWriteDialog.prototype, "_textarea", 2);
AttributeWriteDialog = __decorateClass([t("attribute-write-dialog")], AttributeWriteDialog);

export { AttributeWriteDialog };
