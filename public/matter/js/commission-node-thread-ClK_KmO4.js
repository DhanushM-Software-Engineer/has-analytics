import { c, a as clientContext, h as handleAsync, b as mdiAccessPoint, s as showAlertDialog } from './matter-dashboard-app-A2CxdMlw.js';
import { f as fireEvent } from './fire_event-hFFVnqWI.js';
import { a as i, n, r, j as e, i as i$1, A, b, t } from './main.js';

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--) if (decorator = decorators[i]) result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};
let CommissionNodeThread = class extends i$1 {
  constructor() {
    super(...arguments);
    this._loading = false;
    this._pairingFocused = false;
    this._credsFocused = false;
  }
  updated() {
    void this._maybeAutofocus().catch(err => console.warn("Autofocus failed:", err));
  }
  async _maybeAutofocus() {
    if (this._pairingCodeField && !this._pairingFocused) {
      this._pairingFocused = true;
      await this._pairingCodeField.updateComplete;
      this._pairingCodeField.focus();
    } else if (this._datasetField && !this._credsFocused) {
      this._credsFocused = true;
      await this._datasetField.updateComplete;
      this._datasetField.focus();
    }
  }
  render() {
    if (!this.client.serverInfo.thread_credentials_set) {
      return b`<md-outlined-text-field
                    label="Thread dataset"
                    .disabled="${this._loading}"
                    supporting-text="Hex string (e.g. 0E080000...)"
                >
                </md-outlined-text-field>
                <br />
                <br />
                <md-outlined-button @click=${handleAsync(() => this._setThreadDataset())} .disabled="${this._loading}"
                    >Set Thread Dataset</md-outlined-button
                >${this._loading ? b` <md-circular-progress indeterminate></md-circular-progress> ` : A}`;
    }
    return b`<div class="cred-chip">
                <ha-svg-icon .path=${mdiAccessPoint}></ha-svg-icon>
                <span>Thread network set</span>
                <span class="sep">·</span>
                <button class="edit-link" @click=${() => fireEvent(this, "request-settings", {})}>
                    Edit in Settings
                </button>
            </div>
            <md-outlined-text-field label="Pairing code" .disabled="${this._loading}"> </md-outlined-text-field>
            <br />
            <br />
            <md-outlined-button @click=${handleAsync(() => this._commissionNode())} .disabled="${this._loading}"
                >Commission</md-outlined-button
            >${this._loading ? b` <md-circular-progress indeterminate></md-circular-progress> ` : A}`;
  }
  async _setThreadDataset() {
    const dataset = this._datasetField.value.trim();
    if (!dataset) {
      showAlertDialog({
        title: "Validation error",
        text: "Dataset is required"
      });
      return;
    }
    if (!/^[0-9a-fA-F]*$/.test(dataset) || dataset.length % 2 !== 0) {
      showAlertDialog({
        title: "Invalid Thread dataset",
        text: "Must be a hex string with even length (each byte is two hex characters)"
      });
      return;
    }
    this._loading = true;
    try {
      await this.client.setThreadOperationalDataset(dataset);
    } catch (err) {
      showAlertDialog({
        title: "Error setting Thread dataset",
        text: err.message
      });
    } finally {
      this._loading = false;
    }
  }
  async _commissionNode() {
    this._loading = true;
    try {
      const node = await this.client.commissionWithCode(this._pairingCodeField.value, false);
      fireEvent(this, "node-commissioned", node);
    } catch (err) {
      showAlertDialog({
        title: "Error commissioning node",
        text: err.message
      });
    } finally {
      this._loading = false;
    }
  }
};
CommissionNodeThread.styles = i`
        .cred-chip {
            display: flex;
            width: fit-content;
            align-items: center;
            gap: 6px;
            background: var(--md-sys-color-surface-container);
            color: var(--md-sys-color-on-surface-variant);
            border-radius: 16px;
            padding: 4px 10px 4px 6px;
            font-size: 0.85em;
            margin-bottom: 12px;
        }
        .cred-chip ha-svg-icon {
            width: 18px;
            height: 18px;
            flex-shrink: 0;
        }
        .cred-chip .sep {
            opacity: 0.5;
        }
        .cred-chip .edit-link {
            cursor: pointer;
            color: var(--md-sys-color-primary);
            background: none;
            border: none;
            padding: 0;
            font: inherit;
            font-size: inherit;
        }
    `;
__decorateClass([c({
  context: clientContext,
  subscribe: true
}), n({
  attribute: false
})], CommissionNodeThread.prototype, "client", 2);
__decorateClass([r()], CommissionNodeThread.prototype, "_loading", 2);
__decorateClass([e("md-outlined-text-field[label='Thread dataset']")], CommissionNodeThread.prototype, "_datasetField", 2);
__decorateClass([e("md-outlined-text-field[label='Pairing code']")], CommissionNodeThread.prototype, "_pairingCodeField", 2);
CommissionNodeThread = __decorateClass([t("commission-node-thread")], CommissionNodeThread);

export { CommissionNodeThread };
