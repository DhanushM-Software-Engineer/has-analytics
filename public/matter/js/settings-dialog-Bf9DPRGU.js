import { a as i, r, j as e, i as i$1, b, A, t, n } from './main.js';
import { c, a as clientContext, t as tickContext, f as fireAndForget, s as showAlertDialog, h as handleAsync, D as DevModeService, m as mdiWifi, b as mdiAccessPoint, d as mdiEyeOff, e as mdiEye } from './matter-dashboard-app-A2CxdMlw.js';
import { p as preventDefault } from './prevent_default-D-ohDGsN.js';

var __defProp$1 = Object.defineProperty;
var __getOwnPropDesc$1 = Object.getOwnPropertyDescriptor;
var __decorateClass$1 = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc$1(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--) if (decorator = decorators[i]) result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp$1(target, key, result);
  return result;
};
const LOG_LEVELS = [{
  value: "critical",
  label: "Critical"
}, {
  value: "error",
  label: "Error"
}, {
  value: "warning",
  label: "Warning"
}, {
  value: "notice",
  label: "Notice"
}, {
  value: "info",
  label: "Info"
}, {
  value: "debug",
  label: "Debug"
}];
let LogLevelSection = class extends i$1 {
  constructor() {
    super(...arguments);
    this._tick = 0;
    this._consoleLevel = "info";
    this._fileLevel = null;
    this._loading = true;
    this._applying = false;
  }
  connectedCallback() {
    super.connectedCallback();
    fireAndForget(this._loadLogLevels());
  }
  async _loadLogLevels() {
    if (!this.client) return;
    try {
      const result = await this.client.getLogLevel();
      this._consoleLevel = result.console_loglevel;
      this._fileLevel = result.file_loglevel;
    } catch (err) {
      console.error("Failed to load log levels:", err);
    } finally {
      this._loading = false;
    }
  }
  async _apply() {
    if (!this.client) return;
    this._applying = true;
    try {
      const consoleLevel = this._consoleSelect.value;
      const fileLevel = this._fileSelect?.value;
      const result = await this.client.setLogLevel(consoleLevel, this._fileLevel !== null ? fileLevel : void 0);
      this._consoleLevel = result.console_loglevel;
      this._fileLevel = result.file_loglevel;
      this.dispatchEvent(new CustomEvent("log-level-applied", {
        bubbles: true,
        composed: true
      }));
    } catch (err) {
      console.error("Failed to apply log levels:", err);
      showAlertDialog({
        title: "Error",
        text: "Failed to apply log levels"
      });
    } finally {
      this._applying = false;
    }
  }
  render() {
    if (this._loading) {
      return b` <p class="loading">Loading...</p> `;
    }
    return b`
            <p class="hint">Changes are temporary and will be reset on the next server restart.</p>
            <div class="form-field">
                <label>Console Log Level</label>
                <md-outlined-select name="console" .value=${this._consoleLevel}>
                    ${LOG_LEVELS.map(level => b`
                            <md-select-option value=${level.value} ?selected=${level.value === this._consoleLevel}>
                                <div slot="headline">${level.label}</div>
                            </md-select-option>
                        `)}
                </md-outlined-select>
            </div>
            ${this._fileLevel !== null ? b`
                      <div class="form-field">
                          <label>File Log Level</label>
                          <md-outlined-select name="file" .value=${this._fileLevel}>
                              ${LOG_LEVELS.map(level => b`
                                      <md-select-option
                                          value=${level.value}
                                          ?selected=${level.value === this._fileLevel}
                                      >
                                          <div slot="headline">${level.label}</div>
                                      </md-select-option>
                                  `)}
                          </md-outlined-select>
                      </div>
                  ` : A}
            <div class="actions">
                <md-text-button @click=${handleAsync(() => this._apply())} ?disabled=${this._applying}>
                    ${this._applying ? "Applying..." : "Apply"}
                </md-text-button>
            </div>
        `;
  }
};
LogLevelSection.styles = i`
        :host {
            display: block;
        }

        .loading {
            text-align: center;
            padding: 24px;
            color: var(--md-sys-color-on-surface-variant);
        }

        .hint {
            font-size: 0.875rem;
            color: var(--md-sys-color-on-surface-variant);
            margin: 0 0 16px 0;
            font-style: italic;
        }

        .form-field {
            margin-bottom: 16px;
        }

        .form-field label {
            display: block;
            margin-bottom: 8px;
            font-weight: 500;
            color: var(--md-sys-color-on-surface);
        }

        md-outlined-select {
            width: 100%;
        }

        .actions {
            display: flex;
            justify-content: flex-end;
            margin-top: 8px;
        }
    `;
__decorateClass$1([c({
  context: clientContext
})], LogLevelSection.prototype, "client", 2);
__decorateClass$1([c({
  context: tickContext,
  subscribe: true
})], LogLevelSection.prototype, "_tick", 2);
__decorateClass$1([r()], LogLevelSection.prototype, "_consoleLevel", 2);
__decorateClass$1([r()], LogLevelSection.prototype, "_fileLevel", 2);
__decorateClass$1([r()], LogLevelSection.prototype, "_loading", 2);
__decorateClass$1([r()], LogLevelSection.prototype, "_applying", 2);
__decorateClass$1([e("md-outlined-select[name='console']")], LogLevelSection.prototype, "_consoleSelect", 2);
__decorateClass$1([e("md-outlined-select[name='file']")], LogLevelSection.prototype, "_fileSelect", 2);
LogLevelSection = __decorateClass$1([t("log-level-section")], LogLevelSection);

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--) if (decorator = decorators[i]) result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};
let SettingsDialog = class extends i$1 {
  constructor() {
    super(...arguments);
    this._tick = 0;
    this._devMode = DevModeService.active;
    this._expandedRow = null;
    this._credLoading = false;
    this._showPassword = false;
  }
  connectedCallback() {
    super.connectedCallback();
    this._unsubscribeDev = DevModeService.subscribe(active => {
      this._devMode = active;
    });
  }
  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsubscribeDev?.();
  }
  firstUpdated() {
    const knownSections = /* @__PURE__ */new Set(["network-credentials"]);
    if (this.scrollToSection && knownSections.has(this.scrollToSection)) {
      requestAnimationFrame(() => {
        this.renderRoot.querySelector(`#${this.scrollToSection}`)?.scrollIntoView({
          behavior: "smooth",
          block: "start"
        });
      });
    }
  }
  _close() {
    this.shadowRoot.querySelector("md-dialog").close();
  }
  _handleClosed() {
    this.parentNode.removeChild(this);
  }
  _onDevToggle(event) {
    const target = event.target;
    DevModeService.setActive(target.selected);
  }
  _copyDevLink() {
    const url = new URL(window.location.href);
    url.searchParams.set("dev", "on");
    navigator.clipboard?.writeText(url.toString()).catch(() => {});
  }
  _toggleExpand(row) {
    this._expandedRow = this._expandedRow === row ? null : row;
    this._showPassword = false;
  }
  _cancelCred() {
    this._expandedRow = null;
    this._showPassword = false;
  }
  _togglePassword() {
    this._showPassword = !this._showPassword;
  }
  async _saveWifi() {
    const ssid = this._wifiSsidField.value.trim();
    if (!ssid) {
      showAlertDialog({
        title: "Validation error",
        text: "SSID is required"
      });
      return;
    }
    const password = this._wifiPasswordField.value;
    if (!password) {
      showAlertDialog({
        title: "Validation error",
        text: "Password is required"
      });
      return;
    }
    this._credLoading = true;
    try {
      await this.client.setWifiCredentials(ssid, password);
      this._expandedRow = null;
      this._showPassword = false;
    } catch (err) {
      showAlertDialog({
        title: "Error saving WiFi credentials",
        text: err.message
      });
    } finally {
      this._credLoading = false;
    }
  }
  async _removeWifi() {
    this._credLoading = true;
    try {
      await this.client.removeWifiCredentials();
      this._expandedRow = null;
      this._showPassword = false;
    } catch (err) {
      showAlertDialog({
        title: "Error removing WiFi credentials",
        text: err.message
      });
    } finally {
      this._credLoading = false;
    }
  }
  async _saveThread() {
    const dataset = this._threadDatasetField.value.trim();
    if (!dataset) {
      showAlertDialog({
        title: "Validation error",
        text: "Thread dataset is required"
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
    this._credLoading = true;
    try {
      await this.client.setThreadOperationalDataset(dataset);
      this._expandedRow = null;
    } catch (err) {
      showAlertDialog({
        title: "Error saving Thread dataset",
        text: err.message
      });
    } finally {
      this._credLoading = false;
    }
  }
  async _removeThread() {
    this._credLoading = true;
    try {
      await this.client.removeThreadDataset();
      this._expandedRow = null;
      this._showPassword = false;
    } catch (err) {
      showAlertDialog({
        title: "Error removing Thread dataset",
        text: err.message
      });
    } finally {
      this._credLoading = false;
    }
  }
  render() {
    return b`
            <md-dialog open @cancel=${preventDefault} @closed=${this._handleClosed}>
                <div slot="headline">Settings</div>
                <div slot="content">
                    <section class="section">
                        <h3 class="section-title">Developer mode</h3>
                        <div class="toggle-row">
                            <label for="dev-switch" class="toggle-label">
                                Enable developer mode
                                <span class="hint">
                                    Adds raw read/write buttons and a generic command invoker to cluster views.
                                    Activation is reflected in the URL (<code>?dev=on</code>) and does not persist.
                                </span>
                            </label>
                            <md-switch
                                id="dev-switch"
                                ?selected=${this._devMode}
                                @change=${this._onDevToggle}
                            ></md-switch>
                        </div>
                        <div class="aux-row">
                            <md-text-button @click=${this._copyDevLink}>Copy URL with dev enabled</md-text-button>
                        </div>
                    </section>

                    <md-divider></md-divider>

                    <section class="section">
                        <h3 class="section-title">Server log levels</h3>
                        <log-level-section></log-level-section>
                    </section>

                    <md-divider></md-divider>

                    <section id="network-credentials" class="section">
                        <h3 class="section-title">Network credentials</h3>

                        <div class="cred-row">
                            <div class="cred-info">
                                <ha-svg-icon .path=${mdiWifi}></ha-svg-icon>
                                <span class="cred-label">WiFi</span>
                                ${this.client.serverInfo.wifi_credentials_set ? b`<span class="cred-value">${this.client.serverInfo.wifi_ssid}</span>` : b`<span class="cred-unset">Not configured</span>`}
                            </div>
                            <md-text-button @click=${() => this._toggleExpand("wifi")} .disabled=${this._credLoading}
                                >Edit</md-text-button
                            >
                        </div>

                        ${this._expandedRow === "wifi" ? b` <div class="cred-form">
                                  <md-outlined-text-field
                                      id="cred-wifi-ssid"
                                      label="SSID"
                                      .value=${this.client.serverInfo.wifi_ssid ?? ""}
                                      .disabled=${this._credLoading}
                                  ></md-outlined-text-field>
                                  <div class="password-row">
                                      <md-outlined-text-field
                                          id="cred-wifi-password"
                                          label="Password"
                                          .type=${this._showPassword ? "text" : "password"}
                                          .disabled=${this._credLoading}
                                      ></md-outlined-text-field>
                                      <md-icon-button @click=${this._togglePassword}>
                                          <ha-svg-icon .path=${this._showPassword ? mdiEyeOff : mdiEye}></ha-svg-icon>
                                      </md-icon-button>
                                  </div>
                                  <div class="form-actions">
                                      <md-text-button @click=${this._cancelCred} .disabled=${this._credLoading}
                                          >Cancel</md-text-button
                                      >
                                      ${this.client.serverInfo.wifi_credentials_set ? b`<md-text-button
                                                @click=${handleAsync(() => this._removeWifi())}
                                                .disabled=${this._credLoading}
                                                >Remove</md-text-button
                                            >` : A}
                                      <md-filled-button
                                          @click=${handleAsync(() => this._saveWifi())}
                                          .disabled=${this._credLoading}
                                          >Save</md-filled-button
                                      >
                                  </div>
                              </div>` : A}

                        <div class="cred-row cred-row-thread">
                            <div class="cred-info">
                                <ha-svg-icon .path=${mdiAccessPoint}></ha-svg-icon>
                                <span class="cred-label">Thread</span>
                                ${this.client.serverInfo.thread_credentials_set ? b`<span class="cred-value">Thread network set</span>` : b`<span class="cred-unset">Not configured</span>`}
                            </div>
                            <md-text-button @click=${() => this._toggleExpand("thread")} .disabled=${this._credLoading}
                                >Edit</md-text-button
                            >
                        </div>

                        ${this._expandedRow === "thread" ? b` <div class="cred-form">
                                  <md-outlined-text-field
                                      id="cred-thread-dataset"
                                      label="Thread dataset"
                                      supporting-text="Hex string (e.g. 0E080000...)"
                                      .disabled=${this._credLoading}
                                  ></md-outlined-text-field>
                                  <div class="form-actions">
                                      <md-text-button @click=${this._cancelCred} .disabled=${this._credLoading}
                                          >Cancel</md-text-button
                                      >
                                      ${this.client.serverInfo.thread_credentials_set ? b`<md-text-button
                                                @click=${handleAsync(() => this._removeThread())}
                                                .disabled=${this._credLoading}
                                                >Remove</md-text-button
                                            >` : A}
                                      <md-filled-button
                                          @click=${handleAsync(() => this._saveThread())}
                                          .disabled=${this._credLoading}
                                          >Save</md-filled-button
                                      >
                                  </div>
                              </div>` : A}

                        <p class="cred-hint">Used when commissioning new devices. Existing devices are not affected.</p>
                    </section>
                </div>
                <div slot="actions">
                    <md-text-button @click=${this._close}>Close</md-text-button>
                </div>
            </md-dialog>
        `;
  }
};
SettingsDialog.styles = i`
        md-dialog {
            min-width: 480px;
            max-width: 600px;
        }

        .section {
            padding: 8px 0 16px 0;
        }

        .section-title {
            margin: 0 0 12px 0;
            font-size: 0.95rem;
            font-weight: 500;
            color: var(--md-sys-color-on-surface);
            text-transform: uppercase;
            letter-spacing: 0.08em;
        }

        .toggle-row {
            display: flex;
            align-items: center;
            gap: 16px;
            justify-content: space-between;
        }

        .toggle-label {
            display: flex;
            flex-direction: column;
            gap: 4px;
            color: var(--md-sys-color-on-surface);
            font-size: 0.95rem;
        }

        .hint {
            font-size: 0.825rem;
            color: var(--md-sys-color-on-surface-variant);
            font-weight: 400;
        }

        .hint code {
            font-family: var(--monospace-font);
            background: var(--md-sys-color-surface-container-high);
            padding: 0 4px;
            border-radius: 3px;
        }

        .aux-row {
            margin-top: 8px;
            display: flex;
            justify-content: flex-end;
        }

        md-divider {
            margin: 12px 0;
        }

        .cred-row {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 4px 0;
        }

        .cred-row-thread {
            margin-top: 8px;
        }

        .cred-info {
            display: flex;
            align-items: center;
            gap: 10px;
            font-size: 0.9rem;
            color: var(--md-sys-color-on-surface);
        }

        .cred-label {
            font-weight: 500;
            min-width: 52px;
        }

        .cred-value {
            color: var(--md-sys-color-on-surface-variant);
        }

        .cred-unset {
            color: var(--md-sys-color-on-surface-variant);
            font-style: italic;
        }

        .cred-form {
            display: flex;
            flex-direction: column;
            gap: 10px;
            padding: 8px 0 4px 0;
        }

        .password-row {
            display: flex;
            align-items: center;
            gap: 4px;
        }

        .password-row md-outlined-text-field {
            flex: 1;
        }

        .form-actions {
            display: flex;
            gap: 4px;
            justify-content: flex-end;
        }

        .cred-hint {
            margin: 10px 0 0 0;
            font-size: 0.8rem;
            color: var(--md-sys-color-on-surface-variant);
        }

        .cred-info ha-svg-icon {
            width: 18px;
            height: 18px;
            color: var(--md-sys-color-on-surface-variant);
        }

        .password-row ha-svg-icon {
            width: 18px;
            height: 18px;
            color: var(--md-sys-color-on-surface-variant);
        }
    `;
__decorateClass([c({
  context: clientContext
})], SettingsDialog.prototype, "client", 2);
__decorateClass([c({
  context: tickContext,
  subscribe: true
})], SettingsDialog.prototype, "_tick", 2);
__decorateClass([r()], SettingsDialog.prototype, "_devMode", 2);
__decorateClass([n({
  attribute: false
})], SettingsDialog.prototype, "scrollToSection", 2);
__decorateClass([r()], SettingsDialog.prototype, "_expandedRow", 2);
__decorateClass([r()], SettingsDialog.prototype, "_credLoading", 2);
__decorateClass([r()], SettingsDialog.prototype, "_showPassword", 2);
__decorateClass([e("#cred-wifi-ssid")], SettingsDialog.prototype, "_wifiSsidField", 2);
__decorateClass([e("#cred-wifi-password")], SettingsDialog.prototype, "_wifiPasswordField", 2);
__decorateClass([e("#cred-thread-dataset")], SettingsDialog.prototype, "_threadDatasetField", 2);
SettingsDialog = __decorateClass([t("settings-dialog")], SettingsDialog);

export { SettingsDialog };
