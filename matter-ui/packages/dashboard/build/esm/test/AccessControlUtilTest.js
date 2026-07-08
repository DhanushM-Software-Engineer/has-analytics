/**
 * @license
 * Copyright 2025-2026 Open Home Foundation
 * SPDX-License-Identifier: Apache-2.0
 */
import { MatterNode } from "@matter-server/ws-client";
import {
  Privilege,
  aclCapacity,
  aclEntryKey,
  entriesForFabric,
  entryMatchesTarget,
  isProtectedAdmin,
  isWholeNode,
  nodeIdKey,
  readAclEntries
} from "../src/util/access-control.js";
import { detectBindingRelationship } from "../src/util/binding.js";
function node(attributes, opts = {}) {
  const data = {
    node_id: opts.node_id ?? 1,
    date_commissioned: "",
    last_interview: "",
    interview_version: 1,
    available: opts.available ?? true,
    is_bridge: false,
    attributes,
    attribute_subscriptions: []
  };
  return new MatterNode(data);
}
function entry(p) {
  return {
    privilege: Privilege.Operate,
    authMode: 2,
    subjects: [1],
    targets: void 0,
    fabricIndex: 1,
    ...p
  };
}
describe("access-control util", () => {
  it("nodeIdKey normalizes number and bigint to the same string", () => {
    expect(nodeIdKey(112233)).to.equal(nodeIdKey(112233n));
  });
  it("readAclEntries parses the raw acl attribute", () => {
    const n = node({ "0/31/0": [{ "1": 5, "2": 2, "3": [112233], "4": void 0, "254": 1 }] });
    const entries = readAclEntries(n);
    expect(entries).to.have.length(1);
    expect(entries[0].privilege).to.equal(Privilege.Administer);
    expect(isWholeNode(entries[0])).to.equal(true);
  });
  it("treats null target fields as wildcard (undefined), not 0", () => {
    const n = node({ "0/31/0": [{ "1": 3, "2": 2, "3": [1], "4": [{ "0": 6, "1": null }], "254": 1 }] });
    const target = readAclEntries(n)[0].targets[0];
    expect(target.cluster).to.equal(6);
    expect(target.endpoint).to.equal(void 0);
  });
  it("entriesForFabric filters by fabricIndex", () => {
    const all = [entry({ fabricIndex: 1 }), entry({ subjects: [2], fabricIndex: 2 })];
    expect(entriesForFabric(all, 1)).to.have.length(1);
    expect(entriesForFabric(all, void 0)).to.have.length(2);
  });
  it("entryMatchesTarget matches whole-node and endpoint/cluster", () => {
    expect(entryMatchesTarget(entry({ targets: void 0 }), 1, 6)).to.equal(true);
    const scoped = entry({ targets: [{ endpoint: 1, cluster: 6, deviceType: void 0 }] });
    expect(entryMatchesTarget(scoped, 1, 6)).to.equal(true);
    expect(entryMatchesTarget(scoped, 2, 6)).to.equal(false);
    expect(entryMatchesTarget(scoped, 1, 8)).to.equal(false);
  });
  it("entryMatchesTarget handles wildcard endpoint and directional cluster matching", () => {
    const wildEp = entry({ targets: [{ endpoint: void 0, cluster: 6, deviceType: void 0 }] });
    expect(entryMatchesTarget(wildEp, 5, 6)).to.equal(true);
    const wildCl = entry({ targets: [{ endpoint: 1, cluster: void 0, deviceType: void 0 }] });
    expect(entryMatchesTarget(wildCl, 1, 6)).to.equal(true);
    const specific = entry({ targets: [{ endpoint: 1, cluster: 6, deviceType: void 0 }] });
    expect(entryMatchesTarget(specific, 1, void 0)).to.equal(false);
    expect(entryMatchesTarget(wildCl, 1, void 0)).to.equal(true);
  });
  it("aclCapacity reads the limit attributes", () => {
    const n = node({ "0/31/4": 4, "0/31/2": 4, "0/31/3": 3 });
    expect(aclCapacity(n)).to.deep.equal({ max: 4, subjectsMax: 4, targetsMax: 3 });
  });
  it("isProtectedAdmin flags the controller's admin entry across number/bigint", () => {
    expect(isProtectedAdmin(entry({ privilege: Privilege.Administer, subjects: [112233n] }), 112233)).to.equal(
      true
    );
    expect(isProtectedAdmin(entry({ privilege: Privilege.Operate, subjects: [112233] }), 112233)).to.equal(false);
    expect(isProtectedAdmin(entry({ privilege: Privilege.Administer, subjects: [112233n] }), void 0)).to.equal(
      false
    );
  });
  it("aclEntryKey is stable across number/bigint subjects and target order", () => {
    const a = entry({ subjects: [112233], targets: [{ endpoint: 1, cluster: 6, deviceType: void 0 }] });
    const b = entry({ subjects: [112233n], targets: [{ endpoint: 1, cluster: 6, deviceType: void 0 }] });
    expect(aclEntryKey(a)).to.equal(aclEntryKey(b));
    const c = entry({ subjects: [112233], targets: void 0 });
    expect(aclEntryKey(a)).to.not.equal(aclEntryKey(c));
  });
  it("detectBindingRelationship marks backs / overPrivileged / none", () => {
    const viewed = 2588119612;
    const source = node({ "1/30/0": [{ "1": viewed, "3": 1, "4": 6 }] }, { node_id: 976328453 });
    const all = [source];
    const operate = entry({
      privilege: Privilege.Operate,
      subjects: [976328453],
      targets: [{ endpoint: 1, cluster: 6, deviceType: void 0 }]
    });
    expect(detectBindingRelationship(operate, viewed, all).kind).to.equal("backs");
    const admin = entry({
      privilege: Privilege.Administer,
      subjects: [976328453],
      targets: [{ endpoint: 1, cluster: 6, deviceType: void 0 }]
    });
    expect(detectBindingRelationship(admin, viewed, all).kind).to.equal("overPrivileged");
    const unrelated = entry({ subjects: [555], targets: [{ endpoint: 1, cluster: 6, deviceType: void 0 }] });
    expect(detectBindingRelationship(unrelated, viewed, all).kind).to.equal("none");
  });
  it("detectBindingRelationship ignores an offline source node", () => {
    const viewed = 2588119612;
    const source = node({ "1/30/0": [{ "1": viewed, "3": 1, "4": 6 }] }, { node_id: 976328453, available: false });
    const operate = entry({
      privilege: Privilege.Operate,
      subjects: [976328453],
      targets: [{ endpoint: 1, cluster: 6, deviceType: void 0 }]
    });
    expect(detectBindingRelationship(operate, viewed, [source]).kind).to.equal("none");
  });
});
//# sourceMappingURL=AccessControlUtilTest.js.map
