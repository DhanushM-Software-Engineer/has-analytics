import { c, a as clientContext, t as tickContext } from './matter-dashboard-app-A2CxdMlw.js';
import { r, t, i, b } from './main.js';
import { p as preventDefault } from './prevent_default-D-ohDGsN.js';

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--) if (decorator = decorators[i]) result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};
let ComissionNodeDialog = class extends i {
  constructor() {
    super(...arguments);
    this._tick = 0;
  }
  render() {
    return b`
            <md-dialog open @cancel=${preventDefault} @closed=${this._handleClosed}>
                <div slot="headline">Commission node</div>
                <div
                    slot="content"
                    @node-commissioned=${this._nodeCommissioned}
                    @request-settings=${this._requestSettings}
                >
                    ${!this._mode ? b`<md-list>
                              <md-list-item
                                  type="button"
                                  .disabled=${!this.client.serverInfo.bluetooth_enabled}
                                  @click=${this._commissionWifi}
                                  >Commission new WiFi device</md-list-item
                              >
                              <md-list-item
                                  type="button"
                                  .disabled=${!this.client.serverInfo.bluetooth_enabled}
                                  @click=${this._commissionThread}
                                  >Commission new Thread device</md-list-item
                              >
                              <md-list-item type="button" @click=${this._commissionExisting}
                                  >Commission existing device</md-list-item
                              >
                          </md-list>` : this._mode === "wifi" ? b` <commission-node-wifi></commission-node-wifi> ` : this._mode === "thread" ? b` <commission-node-thread></commission-node-thread> ` : b` <commission-node-existing></commission-node-existing> `}
                </div>
                <div slot="actions">
                    <md-text-button @click=${this._close}>Cancel</md-text-button>
                </div>
            </md-dialog>
        `;
  }
  _commissionWifi() {
    if (!this.client.serverInfo.bluetooth_enabled) {
      return;
    }
    import('./commission-node-wifi-BK6MmQQz.js');
    this._mode = "wifi";
  }
  _commissionThread() {
    if (!this.client.serverInfo.bluetooth_enabled) {
      return;
    }
    import('./commission-node-thread-ClK_KmO4.js');
    this._mode = "thread";
  }
  _commissionExisting() {
    import('./commission-node-existing-CSKtdk67.js');
    this._mode = "existing";
  }
  _nodeCommissioned(ev) {
    window.location.href = `#node/${ev.detail.node_id}`;
    this._close();
  }
  _requestSettings() {
    import('./matter-dashboard-app-A2CxdMlw.js').then(function (n) { return n.y; }).then(({
      showSettingsDialog
    }) => {
      showSettingsDialog("network-credentials");
    });
    this._close();
  }
  _close() {
    this.shadowRoot.querySelector("md-dialog").close();
  }
  _handleClosed() {
    this.parentNode.removeChild(this);
  }
};
__decorateClass([c({
  context: clientContext
})], ComissionNodeDialog.prototype, "client", 2);
__decorateClass([c({
  context: tickContext,
  subscribe: true
})], ComissionNodeDialog.prototype, "_tick", 2);
__decorateClass([r()], ComissionNodeDialog.prototype, "_mode", 2);
ComissionNodeDialog = __decorateClass([t("commission-node-dialog")], ComissionNodeDialog);

export { ComissionNodeDialog };
