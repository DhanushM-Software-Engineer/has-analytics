import './matter-dashboard-app-A2CxdMlw.js';
import { a as i, n, i as i$1, b, t } from './main.js';
import { p as preventDefault } from './prevent_default-D-ohDGsN.js';

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--) if (decorator = decorators[i]) result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};
let DialogBox = class extends i$1 {
  render() {
    const params = this.params;
    return b`
            <md-dialog open @cancel=${preventDefault} @closed=${this._handleClosed}>
                ${params.title ? b`<div slot="headline">${params.title}</div>` : ""}
                ${params.text ? b`<div slot="content">
                          ${params.asCodeBlock && typeof params.text === "string" ? b`<code>${params.text}</code>` : params.text}
                      </div>` : ""}
                <div slot="actions">
                    ${this.type === "prompt" ? b`
                              <md-text-button @click=${this._cancel}>${params.cancelText ?? "Cancel"}</md-text-button>
                          ` : ""}
                    <md-text-button @click=${this._confirm}>${params.confirmText ?? "OK"}</md-text-button>
                </div>
            </md-dialog>
        `;
  }
  _cancel() {
    this._setResult(false);
  }
  _confirm() {
    this._setResult(true);
  }
  _setResult(result) {
    this.dialogResult(result);
    this.shadowRoot.querySelector("md-dialog").close();
  }
  _handleClosed() {
    this.parentElement.removeChild(this);
  }
};
DialogBox.styles = i`
        code {
            display: block;
            white-space: pre-wrap;
            word-break: break-all;
            overflow-y: auto;
            max-height: 60vh;
            font-size: 0.8rem;
            line-height: 1.4;
            padding: 8px;
            background-color: var(--md-sys-color-surface-container-highest);
            border-radius: 4px;
        }
    `;
__decorateClass([n({
  attribute: false
})], DialogBox.prototype, "params", 2);
__decorateClass([n({
  attribute: false
})], DialogBox.prototype, "dialogResult", 2);
__decorateClass([n()], DialogBox.prototype, "type", 2);
DialogBox = __decorateClass([t("dialog-box")], DialogBox);

export { DialogBox };
