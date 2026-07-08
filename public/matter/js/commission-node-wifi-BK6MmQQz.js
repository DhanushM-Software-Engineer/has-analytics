import { c, a as clientContext, h as handleAsync, m as mdiWifi, s as showAlertDialog } from './matter-dashboard-app-A2CxdMlw.js';
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
let CommissionNodeWifi = class extends i$1 {
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
    } else if (this._ssidField && !this._credsFocused) {
      this._credsFocused = true;
      await this._ssidField.updateComplete;
      this._ssidField.focus();
    }
  }
  render() {
    if (!this.client.serverInfo.wifi_credentials_set) {
      return b`<md-outlined-text-field
                    label="SSID"
                    .disabled="${this._loading}"
                    supporting-text="Network name"
                >
                </md-outlined-text-field>
                <md-outlined-text-field label="Password" type="password" .disabled="${this._loading}">
                </md-outlined-text-field>
                <br />
                <br />
                <md-outlined-button @click=${handleAsync(() => this._setWifiCredentials())} .disabled="${this._loading}"
                    >Set WiFi Credentials</md-outlined-button
                >${this._loading ? b`<md-circular-progress indeterminate></md-circular-progress>` : A}`;
    }
    return b`<div class="cred-chip">
                <ha-svg-icon .path=${mdiWifi}></ha-svg-icon>
                <span>WiFi: ${this.client.serverInfo.wifi_ssid ?? "network set"}</span>
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
  async _setWifiCredentials() {
    const ssid = this._ssidField.value;
    if (!ssid) {
      showAlertDialog({
        title: "Validation error",
        text: "SSID is required"
      });
      return;
    }
    const password = this._passwordField.value;
    if (!password) {
      showAlertDialog({
        title: "Validation error",
        text: "Password is required"
      });
      return;
    }
    this._loading = true;
    try {
      await this.client.setWifiCredentials(ssid, password);
    } catch (err) {
      showAlertDialog({
        title: "Error setting WiFi credentials",
        text: err.message
      });
    } finally {
      this._loading = false;
    }
  }
  async _commissionNode() {
    try {
      if (!this._pairingCodeField.value) {
        showAlertDialog({
          title: "Validation error",
          text: "Pairing code is required"
        });
        return;
      }
      this._loading = true;
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
CommissionNodeWifi.styles = i`
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
})], CommissionNodeWifi.prototype, "client", 2);
__decorateClass([r()], CommissionNodeWifi.prototype, "_loading", 2);
__decorateClass([e("md-outlined-text-field[label='SSID']")], CommissionNodeWifi.prototype, "_ssidField", 2);
__decorateClass([e("md-outlined-text-field[label='Password']")], CommissionNodeWifi.prototype, "_passwordField", 2);
__decorateClass([e("md-outlined-text-field[label='Pairing code']")], CommissionNodeWifi.prototype, "_pairingCodeField", 2);
CommissionNodeWifi = __decorateClass([t("commission-node-wifi")], CommissionNodeWifi);

export { CommissionNodeWifi };
