import { c, a as clientContext, P as Privilege, n as nodeIdKey, i as aclCapacity, s as showAlertDialog, j as targetServerClusters, k as clusters, A as AuthMode, l as addAclEntry, o as PRIVILEGE_NAMES, p as mdiClose, q as getDeviceName, h as handleAsync } from './matter-dashboard-app-A2CxdMlw.js';
import { a as i, n, r, i as i$1, b, t } from './main.js';
import { p as preventDefault } from './prevent_default-D-ohDGsN.js';

var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __decorateClass = (decorators, target, key, kind) => {
  var result = kind > 1 ? void 0 : kind ? __getOwnPropDesc(target, key) : target;
  for (var i = decorators.length - 1, decorator; i >= 0; i--) if (decorator = decorators[i]) result = (kind ? decorator(target, key, result) : decorator(result)) || result;
  if (kind && result) __defProp(target, key, result);
  return result;
};
let NodeAclAddDialog = class extends i$1 {
  constructor() {
    super(...arguments);
    this._privilege = Privilege.Operate;
    this._subjects = new Array();
    this._subjectInput = "";
    this._targets = new Array();
    this._targetEndpoint = "all";
    this._targetCluster = "";
    this._busy = false;
  }
  _knownNodes() {
    return Object.values(this.client.nodes).sort((a, b) => {
      const x = BigInt(a.node_id);
      const y = BigInt(b.node_id);
      return x < y ? -1 : x > y ? 1 : 0;
    });
  }
  _addSubject(raw) {
    const value = raw.trim();
    if (!/^\d+$/.test(value)) return;
    const id = BigInt(value);
    const key = nodeIdKey(id);
    if (this._subjects.some(s => nodeIdKey(s) === key)) return;
    const max = aclCapacity(this.node).subjectsMax;
    if (max > 0 && this._subjects.length >= max) {
      void showAlertDialog({
        title: "Limit reached",
        text: `At most ${max} subjects per entry.`
      });
      return;
    }
    this._subjects = [...this._subjects, id];
    this._subjectInput = "";
  }
  _removeSubject(key) {
    this._subjects = this._subjects.filter(s => nodeIdKey(s) !== key);
  }
  _nodeEndpoints() {
    const eps = /* @__PURE__ */new Set();
    for (const key of Object.keys(this.node.attributes)) {
      const m = /^(\d+)\/29\/0$/.exec(key);
      if (m) eps.add(Number(m[1]));
    }
    return Array.from(eps).sort((a, b) => a - b);
  }
  _clusterOptions() {
    if (this._targetEndpoint === "all") {
      const all = /* @__PURE__ */new Set();
      for (const ep of this._nodeEndpoints()) targetServerClusters(this.node, ep).forEach(c => all.add(c));
      return Array.from(all).sort((a, b) => a - b);
    }
    return targetServerClusters(this.node, Number(this._targetEndpoint)).sort((a, b) => a - b);
  }
  _clusterLabel(id) {
    return `${clusters[id]?.label ?? "Cluster"} (0x${id.toString(16).padStart(2, "0").toUpperCase()})`;
  }
  _addTarget() {
    const max = aclCapacity(this.node).targetsMax;
    if (max > 0 && this._targets.length >= max) {
      void showAlertDialog({
        title: "Limit reached",
        text: `At most ${max} targets per entry.`
      });
      return;
    }
    const endpoint = this._targetEndpoint === "all" || this._targetEndpoint === "" ? void 0 : Number(this._targetEndpoint);
    const cluster = this._targetCluster === "all" || this._targetCluster === "" ? void 0 : Number(this._targetCluster);
    if (endpoint === void 0 && cluster === void 0) {
      void showAlertDialog({
        title: "Validation error",
        text: "Pick an endpoint and/or a cluster for the target."
      });
      return;
    }
    this._targets = [...this._targets, {
      endpoint,
      cluster,
      deviceType: void 0
    }];
    this._targetEndpoint = "all";
    this._targetCluster = "all";
  }
  _removeTarget(index) {
    this._targets = this._targets.filter((_, i) => i !== index);
  }
  async _save() {
    if (this._subjects.length === 0) {
      await showAlertDialog({
        title: "Validation error",
        text: "Add at least one subject node."
      });
      return;
    }
    const entry = {
      privilege: this._privilege,
      authMode: AuthMode.Case,
      subjects: this._subjects,
      targets: this._targets.length ? this._targets : void 0,
      fabricIndex: 0
    };
    this._busy = true;
    try {
      await addAclEntry(this.client, this.node.node_id, entry);
      this._close();
    } catch (err) {
      await showAlertDialog({
        title: "Failed to add entry",
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
  render() {
    return b`
            <md-dialog open @cancel=${preventDefault} @closed=${this._handleClosed}>
                <div slot="headline">Add ACL entry</div>
                <div slot="content">
                    <div class="form">
                        <md-outlined-select
                            label="Privilege"
                            .value=${String(this._privilege)}
                            ?disabled=${this._busy}
                            @change=${e => this._privilege = Number(e.target.value)}
                        >
                            ${[Privilege.View, Privilege.Operate, Privilege.Manage, Privilege.Administer].map(p => b`<md-select-option value=${String(p)}
                                        ><div slot="headline">${PRIVILEGE_NAMES[p]} · ${p}</div></md-select-option
                                    >`)}
                        </md-outlined-select>
                        <div class="note">Auth mode: CASE (node). Group subjects are not supported yet.</div>

                        <div class="label">Subjects (nodes)</div>
                        <div class="chips">
                            ${this._subjects.length === 0 ? b`<span class="mut">none — add at least one</span>` : this._subjects.map(s => {
      const known = this.client.nodes[nodeIdKey(s)];
      return b`<span class="chip"
                                          >${known ? getDeviceName(known) : "Node"} · ${s.toString()}
                                          <ha-svg-icon
                                              class="x"
                                              .path=${mdiClose}
                                              @click=${() => this._removeSubject(nodeIdKey(s))}
                                          ></ha-svg-icon
                                      ></span>`;
    })}
                        </div>
                        <div class="row">
                            <md-outlined-select
                                label="Known nodes"
                                ?disabled=${this._busy}
                                @change=${e => {
      const v = e.target.value;
      if (v) this._addSubject(v);
    }}
                            >
                                <md-select-option value=""><div slot="headline">— pick —</div></md-select-option>
                                ${this._knownNodes().map(n => b`<md-select-option value=${nodeIdKey(n.node_id)}
                                            ><div slot="headline">
                                                ${n.node_id.toString()} · ${getDeviceName(n)}
                                            </div></md-select-option
                                        >`)}
                            </md-outlined-select>
                            <md-outlined-text-field
                                label="or raw node id"
                                type="text"
                                pattern="[0-9]+"
                                .value=${this._subjectInput}
                                ?disabled=${this._busy}
                                @input=${e => this._subjectInput = e.target.value}
                            ></md-outlined-text-field>
                            <md-text-button ?disabled=${this._busy} @click=${() => this._addSubject(this._subjectInput)}
                                >Add</md-text-button
                            >
                        </div>

                        <div class="label">Targets (optional — none means whole node)</div>
                        <div class="chips">
                            ${this._targets.length === 0 ? b`<span class="mut">whole node</span>` : this._targets.map((t, i) => b`<span class="chip"
                                              >${t.endpoint != null ? `EP ${t.endpoint}` : "All endpoints"}
                                              ${t.cluster != null ? `\xB7 ${this._clusterLabel(t.cluster)}` : "\xB7 all clusters"}
                                              <ha-svg-icon
                                                  class="x"
                                                  .path=${mdiClose}
                                                  @click=${() => this._removeTarget(i)}
                                              ></ha-svg-icon
                                          ></span>`)}
                        </div>
                        <div class="row">
                            <md-outlined-select
                                label="endpoint"
                                .value=${this._targetEndpoint}
                                ?disabled=${this._busy}
                                @change=${e => {
      this._targetEndpoint = e.target.value;
      this._targetCluster = "";
    }}
                            >
                                <md-select-option value="all"
                                    ><div slot="headline">All endpoints</div></md-select-option
                                >
                                ${this._nodeEndpoints().map(ep => b`<md-select-option value=${String(ep)}
                                            ><div slot="headline">EP ${ep}</div></md-select-option
                                        >`)}
                            </md-outlined-select>
                            <md-outlined-select
                                label="cluster"
                                .value=${this._targetCluster}
                                ?disabled=${this._busy}
                                @change=${e => this._targetCluster = e.target.value}
                            >
                                <md-select-option value="all"><div slot="headline">All clusters</div></md-select-option>
                                ${this._clusterOptions().map(c => b`<md-select-option value=${String(c)}
                                            ><div slot="headline">${this._clusterLabel(c)}</div></md-select-option
                                        >`)}
                            </md-outlined-select>
                            <md-text-button ?disabled=${this._busy} @click=${() => this._addTarget()}
                                >Add target</md-text-button
                            >
                        </div>
                    </div>
                </div>
                <div slot="actions">
                    <md-text-button ?disabled=${this._busy} @click=${handleAsync(() => this._save())}
                        >Add</md-text-button
                    >
                    <md-text-button ?disabled=${this._busy} @click=${this._close}>Cancel</md-text-button>
                </div>
            </md-dialog>
        `;
  }
};
NodeAclAddDialog.styles = i`
        .form {
            display: flex;
            flex-direction: column;
            gap: 10px;
            min-width: 360px;
        }
        .label {
            font-size: 11px;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            opacity: 0.65;
            margin-top: 6px;
        }
        .note {
            font-size: 12px;
            opacity: 0.7;
        }
        .row {
            display: flex;
            gap: 8px;
            align-items: center;
            flex-wrap: wrap;
        }
        .chips {
            display: flex;
            flex-wrap: wrap;
            gap: 6px;
        }
        .chip {
            display: inline-flex;
            align-items: center;
            gap: 4px;
            padding: 3px 8px;
            border-radius: 6px;
            font-size: 12px;
            background: var(--md-sys-color-surface-container-high);
            color: var(--md-sys-color-on-surface);
        }
        .chip .x {
            cursor: pointer;
            --mdc-icon-size: 16px;
            width: 16px;
            height: 16px;
        }
        .mut {
            opacity: 0.6;
            font-size: 12px;
        }
    `;
__decorateClass([c({
  context: clientContext,
  subscribe: true
}), n({
  attribute: false
})], NodeAclAddDialog.prototype, "client", 2);
__decorateClass([n({
  attribute: false
})], NodeAclAddDialog.prototype, "node", 2);
__decorateClass([r()], NodeAclAddDialog.prototype, "_privilege", 2);
__decorateClass([r()], NodeAclAddDialog.prototype, "_subjects", 2);
__decorateClass([r()], NodeAclAddDialog.prototype, "_subjectInput", 2);
__decorateClass([r()], NodeAclAddDialog.prototype, "_targets", 2);
__decorateClass([r()], NodeAclAddDialog.prototype, "_targetEndpoint", 2);
__decorateClass([r()], NodeAclAddDialog.prototype, "_targetCluster", 2);
__decorateClass([r()], NodeAclAddDialog.prototype, "_busy", 2);
NodeAclAddDialog = __decorateClass([t("node-acl-add-dialog")], NodeAclAddDialog);

export { NodeAclAddDialog };
