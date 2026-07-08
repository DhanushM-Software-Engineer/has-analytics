import { c, a as clientContext, n as nodeIdKey, k as clusters, s as showAlertDialog, r as targetAclCapacityForBinding, u as addBinding, v as bindableClusters, q as getDeviceName, x as getEndpointDeviceTypes, h as handleAsync } from './matter-dashboard-app-A2CxdMlw.js';
import { a as i, n, r, i as i$1, A, b, t } from './main.js';
import { p as preventDefault } from './prevent_default-D-ohDGsN.js';

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--) if (decorator = decorators[i]) result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};
const ALL_CLUSTERS = "all";
const CUSTOM_CLUSTER = "custom";
let NodeBindingDialog = class extends i$1 {
  constructor() {
    super(...arguments);
    this._nodeIdInput = "";
    this._endpointInput = "";
    this._clusterSelection = ALL_CLUSTERS;
    this._customClusterInput = "";
    this._busy = false;
  }
  _knownNodes() {
    return Object.values(this.client.nodes).sort((a, b) => {
      const x = BigInt(a.node_id);
      const y = BigInt(b.node_id);
      return x < y ? -1 : x > y ? 1 : 0;
    });
  }
  _resolveTarget() {
    const raw = this._nodeIdInput.trim();
    if (!/^\d+$/.test(raw)) return void 0;
    return this.client.nodes[nodeIdKey(BigInt(raw))];
  }
  _nodeEndpoints(target) {
    const eps = /* @__PURE__ */new Set();
    for (const key of Object.keys(target.attributes)) {
      const m = /^(\d+)\/29\/0$/.exec(key);
      if (m) eps.add(Number(m[1]));
    }
    return Array.from(eps).sort((a, b) => a - b);
  }
  _clusterLabel(id) {
    return `${clusters[id]?.label ?? "Cluster"} (0x${id.toString(16).padStart(2, "0").toUpperCase()})`;
  }
  _onNodeSelect(e) {
    const select = e.target;
    this._nodeIdInput = select.value;
    this._endpointInput = "";
    this._clusterSelection = ALL_CLUSTERS;
  }
  async _add() {
    const target = this._resolveTarget();
    const rawNodeId = this._nodeIdInput.trim();
    if (!/^\d+$/.test(rawNodeId) || BigInt(rawNodeId) <= 0n) {
      await showAlertDialog({
        title: "Validation error",
        text: "Please enter a valid target node id."
      });
      return;
    }
    const targetNodeId = BigInt(rawNodeId);
    const endpoint = parseInt(this._endpointInput, 10);
    if (Number.isNaN(endpoint) || endpoint < 0 || endpoint > 65534) {
      await showAlertDialog({
        title: "Validation error",
        text: "Please enter a valid target endpoint."
      });
      return;
    }
    let cluster;
    if (this._clusterSelection === ALL_CLUSTERS) {
      cluster = void 0;
    } else if (this._clusterSelection === CUSTOM_CLUSTER) {
      const c = parseInt(this._customClusterInput, 10);
      if (Number.isNaN(c) || c < 0 || c > 32767) {
        await showAlertDialog({
          title: "Validation error",
          text: "Please enter a valid cluster id."
        });
        return;
      }
      cluster = c;
    } else {
      cluster = parseInt(this._clusterSelection, 10);
    }
    if (target) {
      const capacity = targetAclCapacityForBinding(target, this.node.node_id);
      if (!capacity.canAdd) {
        await showAlertDialog({
          title: "Cannot add binding",
          text: capacity.reason ?? "Target ACL is full."
        });
        return;
      }
    }
    this._busy = true;
    try {
      await addBinding(this.client, this.node, this.endpoint, targetNodeId, endpoint, cluster);
      this._close();
    } catch (err) {
      await showAlertDialog({
        title: "Failed to add binding",
        text: err instanceof Error ? err.message : String(err)
      });
    } finally {
      this._busy = false;
    }
  }
  _close() {
    this.shadowRoot.querySelector("md-dialog").close();
  }
  _handleClosed() {
    this.parentNode?.removeChild(this);
  }
  _renderClusterField(target, endpoint) {
    const known = target !== void 0 && endpoint !== void 0 && !Number.isNaN(endpoint);
    const split = known ? bindableClusters(this.node, this.endpoint, target, endpoint) : void 0;
    const nonBindable = split !== void 0 && this._clusterSelection !== ALL_CLUSTERS && this._clusterSelection !== CUSTOM_CLUSTER && split.otherTarget.includes(parseInt(this._clusterSelection, 10));
    return b`
            <md-outlined-select
                label="Cluster"
                .value=${this._clusterSelection}
                ?disabled=${this._busy}
                @change=${e => this._clusterSelection = e.target.value}
            >
                <md-select-option value=${ALL_CLUSTERS}>
                    <div slot="headline">All clusters (any eligible)</div>
                </md-select-option>
                ${split && split.bindable.length ? b`<md-select-option disabled><div slot="headline">— Bindable —</div></md-select-option>
                          ${split.bindable.map(c => b`<md-select-option value=${String(c)}
                                      ><div slot="headline">${this._clusterLabel(c)}</div></md-select-option
                                  >`)}` : A}
                ${split && split.otherTarget.length ? b`<md-select-option disabled
                              ><div slot="headline">— Other target clusters (⚠) —</div></md-select-option
                          >
                          ${split.otherTarget.map(c => b`<md-select-option value=${String(c)}
                                      ><div slot="headline">${this._clusterLabel(c)}</div></md-select-option
                                  >`)}` : A}
                <md-select-option value=${CUSTOM_CLUSTER}
                    ><div slot="headline">Custom cluster id…</div></md-select-option
                >
            </md-outlined-select>
            ${this._clusterSelection === CUSTOM_CLUSTER ? b`<md-outlined-text-field
                      label="cluster id"
                      type="number"
                      min="0"
                      max="32767"
                      .value=${this._customClusterInput}
                      ?disabled=${this._busy}
                      @input=${e => this._customClusterInput = e.target.value}
                  ></md-outlined-text-field>` : A}
            ${nonBindable ? b`<div class="warn">
                      ⚠ This cluster is not a client cluster on the source endpoint. The binding may not function — it
                      will be added anyway on your request.
                  </div>` : A}
        `;
  }
  render() {
    if (!this.node) return A;
    const target = this._resolveTarget();
    const endpoint = this._endpointInput === "" ? void 0 : parseInt(this._endpointInput, 10);
    const endpoints = target ? this._nodeEndpoints(target) : [];
    return b`
            <md-dialog open @cancel=${preventDefault} @closed=${this._handleClosed}>
                <div slot="headline">Add binding</div>
                <div slot="content">
                    <div class="form">
                        <md-outlined-select
                            label="Known nodes"
                            ?disabled=${this._busy}
                            .value=${target ? this._nodeIdInput : ""}
                            @change=${this._onNodeSelect}
                        >
                            <md-select-option value=""><div slot="headline">— pick a node —</div></md-select-option>
                            ${this._knownNodes().map(n => b`<md-select-option value=${nodeIdKey(n.node_id)}>
                                        <div slot="headline">${n.node_id.toString()} · ${getDeviceName(n)}</div>
                                    </md-select-option>`)}
                        </md-outlined-select>
                        <md-outlined-text-field
                            label="Target node id"
                            type="text"
                            pattern="[0-9]+"
                            supporting-text="required — pick above or enter a raw node id"
                            .value=${this._nodeIdInput}
                            ?disabled=${this._busy}
                            @input=${e => {
      this._nodeIdInput = e.target.value;
      this._endpointInput = "";
      this._clusterSelection = ALL_CLUSTERS;
    }}
                        ></md-outlined-text-field>

                        ${target ? b`<md-outlined-select
                                  label="Target endpoint"
                                  ?disabled=${this._busy}
                                  .value=${this._endpointInput}
                                  @change=${e => {
      this._endpointInput = e.target.value;
      this._clusterSelection = ALL_CLUSTERS;
    }}
                              >
                                  ${endpoints.map(ep => {
      const dt = getEndpointDeviceTypes(target, ep)[0];
      return b`<md-select-option value=${String(ep)}>
                                          <div slot="headline">EP ${ep}${dt ? ` \xB7 ${dt.label}` : ""}</div>
                                      </md-select-option>`;
    })}
                              </md-outlined-select>` : b`<md-outlined-text-field
                                  label="Target endpoint"
                                  type="number"
                                  min="0"
                                  max="65534"
                                  supporting-text=${this._nodeIdInput.trim() === "" ? "enter a node id first" : "unknown node \u2014 enter endpoint manually"}
                                  ?disabled=${this._busy || this._nodeIdInput.trim() === ""}
                                  .value=${this._endpointInput}
                                  @input=${e => this._endpointInput = e.target.value}
                              ></md-outlined-text-field>`}
                        ${this._renderClusterField(target, endpoint)}
                    </div>
                </div>
                <div slot="actions">
                    <md-text-button ?disabled=${this._busy} @click=${handleAsync(() => this._add())}
                        >Add</md-text-button
                    >
                    <md-text-button ?disabled=${this._busy} @click=${this._close}>Cancel</md-text-button>
                </div>
            </md-dialog>
        `;
  }
};
NodeBindingDialog.styles = i`
        .form {
            display: flex;
            flex-direction: column;
            gap: 12px;
            min-width: 320px;
        }
        .warn {
            font-size: 12px;
            padding: 8px 10px;
            border-radius: 7px;
            background: var(--md-sys-color-error-container);
            color: var(--md-sys-color-on-error-container);
        }
    `;
__decorateClass([c({
  context: clientContext,
  subscribe: true
}), n({
  attribute: false
})], NodeBindingDialog.prototype, "client", 2);
__decorateClass([n()], NodeBindingDialog.prototype, "node", 2);
__decorateClass([n({
  attribute: false
})], NodeBindingDialog.prototype, "endpoint", 2);
__decorateClass([r()], NodeBindingDialog.prototype, "_nodeIdInput", 2);
__decorateClass([r()], NodeBindingDialog.prototype, "_endpointInput", 2);
__decorateClass([r()], NodeBindingDialog.prototype, "_clusterSelection", 2);
__decorateClass([r()], NodeBindingDialog.prototype, "_customClusterInput", 2);
__decorateClass([r()], NodeBindingDialog.prototype, "_busy", 2);
NodeBindingDialog = __decorateClass([t("node-binding-dialog")], NodeBindingDialog);

export { NodeBindingDialog };
