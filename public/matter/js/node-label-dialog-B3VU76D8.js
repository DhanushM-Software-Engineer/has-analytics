import { M as MAX_NODE_LABEL_LENGTH, w as writeNodeLabel, s as showAlertDialog } from './matter-dashboard-app-A2CxdMlw.js';
import { r, n, t, i, b } from './main.js';
import { p as preventDefault } from './prevent_default-D-ohDGsN.js';

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--) if (decorator = decorators[i]) result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};
let NodeLabelDialog = class extends i {
  constructor() {
    super(...arguments);
    this._nodeLabel = "";
    this._saving = false;
  }
  firstUpdated() {
    this._nodeLabel = this.node.nodeLabel;
  }
  render() {
    return b`
            <md-dialog open @cancel=${preventDefault} @closed=${this._handleClosed}>
                <div slot="headline">Edit Node Label</div>
                <div slot="content">
                    <md-outlined-text-field
                        label="Node Label"
                        .value=${this._nodeLabel}
                        @input=${this._handleInput}
                        maxlength=${MAX_NODE_LABEL_LENGTH}
                        ?disabled=${this._saving}
                        supporting-text="Max ${MAX_NODE_LABEL_LENGTH} characters"
                        style="width: 100%; margin-top: 8px;"
                    ></md-outlined-text-field>
                </div>
                <div slot="actions">
                    <md-text-button @click=${this._close} ?disabled=${this._saving}>Cancel</md-text-button>
                    <md-text-button @click=${this._save} ?disabled=${this._saving}>Save</md-text-button>
                </div>
            </md-dialog>
        `;
  }
  _handleInput(e) {
    const input = e.target;
    this._nodeLabel = input.value;
  }
  _close() {
    this.shadowRoot.querySelector("md-dialog").close();
  }
  _handleClosed() {
    this.parentNode.removeChild(this);
  }
  async _save() {
    this._saving = true;
    try {
      await writeNodeLabel(this.client, this.node, this._nodeLabel);
      this._close();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      showAlertDialog({
        title: "Failed to set node label",
        text: errorMessage
      });
    } finally {
      this._saving = false;
    }
  }
};
__decorateClass([n({
  attribute: false
})], NodeLabelDialog.prototype, "client", 2);
__decorateClass([n({
  attribute: false
})], NodeLabelDialog.prototype, "node", 2);
__decorateClass([r()], NodeLabelDialog.prototype, "_nodeLabel", 2);
__decorateClass([r()], NodeLabelDialog.prototype, "_saving", 2);
NodeLabelDialog = __decorateClass([t("node-label-dialog")], NodeLabelDialog);

export { NodeLabelDialog };
