import { c, a as clientContext, h as handleAsync, s as showAlertDialog } from './matter-dashboard-app-A2CxdMlw.js';
import { f as fireEvent } from './fire_event-hFFVnqWI.js';
import { r, n, j as e, t, i, A, b } from './main.js';

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--) if (decorator = decorators[i]) result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};
let CommissionNodeExisting = class extends i {
  constructor() {
    super(...arguments);
    this._loading = false;
  }
  firstUpdated() {
    void this._autofocusPairingCode().catch(err => console.warn("Autofocus failed:", err));
  }
  async _autofocusPairingCode() {
    await this._pairingCodeField.updateComplete;
    this._pairingCodeField.focus();
  }
  render() {
    return b`<md-outlined-text-field label="Share code" .disabled="${this._loading}"> </md-outlined-text-field>
            <br />
            <br />
            <md-outlined-button @click=${handleAsync(() => this._commissionNode())} .disabled="${this._loading}"
                >Commission</md-outlined-button
            >${this._loading ? b` <md-circular-progress indeterminate></md-circular-progress> ` : A}`;
  }
  async _commissionNode() {
    this._loading = true;
    try {
      const node = await this.client.commissionWithCode(this._pairingCodeField.value, true);
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
__decorateClass([c({
  context: clientContext,
  subscribe: true
}), n({
  attribute: false
})], CommissionNodeExisting.prototype, "client", 2);
__decorateClass([r()], CommissionNodeExisting.prototype, "_loading", 2);
__decorateClass([e("md-outlined-text-field[label='Share code']")], CommissionNodeExisting.prototype, "_pairingCodeField", 2);
CommissionNodeExisting = __decorateClass([t("commission-node-existing")], CommissionNodeExisting);

export { CommissionNodeExisting };
