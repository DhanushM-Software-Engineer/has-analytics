/**
 * @license
 * Copyright 2025-2026 Open Home Foundation
 * SPDX-License-Identifier: Apache-2.0
 */
import WebSocket from "ws";
import {
  CommandTimeoutError,
  ConnectionClosedError,
  DEFAULT_COMMAND_TIMEOUT,
  MatterClient
} from "../src/index.js";
import { parseBigIntAwareJson, toBigIntAwareJson } from "../src/json-utils.js";
import { MockMatterServer } from "./MockMatterServer.js";
function createNodeWebSocket(url) {
  return new WebSocket(url);
}
describe("ws-client", () => {
  describe("json-utils", () => {
    describe("parseBigIntAwareJson", () => {
      it("should parse simple JSON with small numbers", () => {
        const json = '{"value":123}';
        const result = parseBigIntAwareJson(json);
        expect(result.value).to.equal(123);
      });
      it("should convert large numbers to BigInt", () => {
        const json = '{"node_id":18446744069414584320}';
        const result = parseBigIntAwareJson(json);
        expect(typeof result.node_id).to.equal("bigint");
        expect(result.node_id).to.equal(BigInt("18446744069414584320"));
      });
      it("should NOT convert large numbers inside string values", () => {
        const json = '{"dump":"compressed_fabric_id: 18258567453835851999"}';
        const result = parseBigIntAwareJson(json);
        expect(typeof result.dump).to.equal("string");
        expect(result.dump).to.equal("compressed_fabric_id: 18258567453835851999");
      });
      it("should handle nested JSON strings with large numbers", () => {
        const innerJson = '{"compressed_fabric_id": 18258567453835851999}';
        const outerJson = JSON.stringify({ dump: innerJson });
        const result = parseBigIntAwareJson(outerJson);
        expect(typeof result.dump).to.equal("string");
        expect(result.dump).to.equal(innerJson);
      });
      it("should handle mixed: large numbers in strings AND as actual values", () => {
        const json = '{"dump":"id: 18258567453835851999","actual_id":18446744069414584320}';
        const result = parseBigIntAwareJson(json);
        expect(typeof result.dump).to.equal("string");
        expect(result.dump).to.equal("id: 18258567453835851999");
        expect(typeof result.actual_id).to.equal("bigint");
        expect(result.actual_id).to.equal(BigInt("18446744069414584320"));
      });
      it("should handle escaped quotes in strings with large numbers", () => {
        const json = '{"msg":"value with \\"quote\\" and number: 18258567453835851999"}';
        const result = parseBigIntAwareJson(json);
        expect(typeof result.msg).to.equal("string");
        expect(result.msg).to.equal('value with "quote" and number: 18258567453835851999');
      });
      it("should handle arrays with large numbers", () => {
        const json = '{"nodes":[18446744069414584320,18446744069414584321]}';
        const result = parseBigIntAwareJson(json);
        expect(result.nodes).to.have.length(2);
        expect(typeof result.nodes[0]).to.equal("bigint");
        expect(result.nodes[0]).to.equal(BigInt("18446744069414584320"));
      });
      it("should handle large numbers in arrays inside strings", () => {
        const json = '{"dump":"[18258567453835851999, 12345678901234567890]"}';
        const result = parseBigIntAwareJson(json);
        expect(typeof result.dump).to.equal("string");
        expect(result.dump).to.equal("[18258567453835851999, 12345678901234567890]");
      });
      it("should handle real-world import_test_node message", () => {
        const dumpString = `{
                    "server_info": {
                        "fabric_id": 2,
                        "compressed_fabric_id": 18258567453835851999,
                    },
                    "node": {
                        "node_id": 115,
                        "attributes": { "0/40/1": "Test Vendor" },
                    },
                }`;
        const outerMessage = {
          message_id: "2",
          command: "import_test_node",
          args: { dump: dumpString }
        };
        const json = JSON.stringify(outerMessage);
        const result = parseBigIntAwareJson(json);
        expect(result.message_id).to.equal("2");
        expect(result.command).to.equal("import_test_node");
        expect(typeof result.args.dump).to.equal("string");
        expect(result.args.dump).to.equal(dumpString);
      });
      it("should handle negative large numbers", () => {
        const json = '{"value":-18446744069414584320}';
        const result = parseBigIntAwareJson(json);
        expect(typeof result.value).to.equal("bigint");
        expect(result.value).to.equal(BigInt("-18446744069414584320"));
      });
      it("should handle negative large numbers in arrays", () => {
        const json = '{"values":[-18446744069414584320, 18446744069414584321]}';
        const result = parseBigIntAwareJson(json);
        expect(result.values).to.have.length(2);
        expect(result.values[0]).to.equal(BigInt("-18446744069414584320"));
        expect(result.values[1]).to.equal(BigInt("18446744069414584321"));
      });
      it("should NOT convert negative large numbers inside strings", () => {
        const json = '{"dump":"value: -18258567453835851999"}';
        const result = parseBigIntAwareJson(json);
        expect(typeof result.dump).to.equal("string");
        expect(result.dump).to.equal("value: -18258567453835851999");
      });
      it("should handle floating point numbers", () => {
        const json = '{"value":3.14159}';
        const result = parseBigIntAwareJson(json);
        expect(typeof result.value).to.equal("number");
        expect(result.value).to.equal(3.14159);
      });
      it("should handle negative floating point numbers", () => {
        const json = '{"value":-123.456}';
        const result = parseBigIntAwareJson(json);
        expect(typeof result.value).to.equal("number");
        expect(result.value).to.equal(-123.456);
      });
      it("should handle numbers with exponents", () => {
        const json = '{"value":1.5e10}';
        const result = parseBigIntAwareJson(json);
        expect(typeof result.value).to.equal("number");
        expect(result.value).to.equal(15e9);
      });
      it("should handle mixed integers and floats", () => {
        const json = '{"int":18446744069414584320,"float":3.14}';
        const result = parseBigIntAwareJson(json);
        expect(typeof result.int).to.equal("bigint");
        expect(result.int).to.equal(BigInt("18446744069414584320"));
        expect(typeof result.float).to.equal("number");
        expect(result.float).to.equal(3.14);
      });
    });
    describe("toBigIntAwareJson", () => {
      it("should serialize small numbers as numbers", () => {
        const result = toBigIntAwareJson({ value: 123 });
        expect(result).to.equal('{"value":123}');
      });
      it("should serialize small BigInt as numbers", () => {
        const result = toBigIntAwareJson({ value: BigInt(123) });
        expect(result).to.equal('{"value":123}');
      });
      it("should serialize large BigInt as raw numbers (not strings)", () => {
        const result = toBigIntAwareJson({ node_id: BigInt("18446744069414584320") });
        expect(result).to.equal('{"node_id":18446744069414584320}');
      });
    });
    describe("round-trip", () => {
      it("should round-trip large BigInt values", () => {
        const original = { node_id: BigInt("18446744069414584320") };
        const json = toBigIntAwareJson(original);
        const parsed = parseBigIntAwareJson(json);
        expect(parsed.node_id).to.equal(original.node_id);
      });
    });
  });
  describe("MatterClient with MockMatterServer", () => {
    let server;
    let client;
    beforeEach(async () => {
      server = new MockMatterServer();
      await server.start();
      client = new MatterClient(server.url, createNodeWebSocket);
    });
    afterEach(async () => {
      if (client?.connection?.connected) {
        client.disconnect();
      }
      await server?.stop();
    });
    describe("connection", () => {
      it("should connect and receive server info", async () => {
        await client.connect();
        expect(client.connection.connected).to.be.true;
        expect(client.serverInfo).to.exist;
        expect(client.serverInfo.schema_version).to.equal(11);
      });
      it("should receive BigInt fabric_id from server info", async () => {
        await client.connect();
        expect(typeof client.serverInfo.fabric_id).to.equal("bigint");
        expect(client.serverInfo.fabric_id).to.equal(BigInt("1234567890123456789"));
      });
      it("should receive BigInt compressed_fabric_id from server info", async () => {
        await client.connect();
        expect(typeof client.serverInfo.compressed_fabric_id).to.equal("bigint");
        expect(client.serverInfo.compressed_fabric_id).to.equal(BigInt("18258567453835851999"));
      });
    });
    describe("commands", () => {
      it("should send command and receive response", async () => {
        server.onCommand("get_nodes", () => []);
        await client.connect();
        const nodes = await client.getNodes();
        expect(nodes).to.deep.equal([]);
      });
      it("should send BigInt node_id in commands", async () => {
        const nodeId = BigInt("18446744069414584320");
        server.onCommand("get_node", (args) => {
          const typedArgs = args;
          expect(typeof typedArgs.node_id).to.equal("bigint");
          expect(typedArgs.node_id).to.equal(nodeId);
          return {
            node_id: typedArgs.node_id,
            date_commissioned: "2025-01-01T00:00:00.000000",
            last_interview: "2025-01-01T00:00:00.000000",
            interview_version: 6,
            available: true,
            is_bridge: false,
            attributes: {}
          };
        });
        await client.connect();
        const node = await client.getNode(nodeId);
        expect(node.node_id).to.equal(nodeId);
      });
      it("should receive BigInt values in response", async () => {
        const nodeId = BigInt("18446744069414584320");
        server.onCommand("get_nodes", () => [
          {
            node_id: nodeId,
            date_commissioned: "2025-01-01T00:00:00.000000",
            last_interview: "2025-01-01T00:00:00.000000",
            interview_version: 6,
            available: true,
            is_bridge: false,
            attributes: {}
          }
        ]);
        await client.connect();
        const nodes = await client.getNodes();
        expect(nodes).to.have.length(1);
        expect(typeof nodes[0].node_id).to.equal("bigint");
        expect(nodes[0].node_id).to.equal(nodeId);
      });
      it("should handle import_test_node with large numbers in dump string", async () => {
        let receivedDump;
        server.onCommand("import_test_node", (args) => {
          const typedArgs = args;
          receivedDump = typedArgs.dump;
          return null;
        });
        await client.connect();
        const dumpWithLargeNumber = '{"compressed_fabric_id": 18258567453835851999}';
        await client.importTestNode(dumpWithLargeNumber);
        expect(receivedDump).to.equal(dumpWithLargeNumber);
      });
      it("should handle error responses", async () => {
        server.onCommand("remove_node", () => {
          throw new Error("Node not found");
        });
        await client.connect();
        try {
          await client.removeNode(BigInt(999));
          expect.fail("Should have thrown an error");
        } catch (error) {
          expect(error).to.be.instanceOf(Error);
          expect(error.message).to.equal("Node not found");
        }
      });
    });
    describe("loglevel", () => {
      it("should round-trip native level names via get_loglevel", async () => {
        server.onCommand("get_loglevel", () => ({
          console_loglevel: "notice",
          file_loglevel: "debug"
        }));
        await client.connect();
        const result = await client.getLogLevel();
        expect(result.console_loglevel).to.equal("notice");
        expect(result.file_loglevel).to.equal("debug");
      });
      it("should accept matter.js aliases on set_loglevel while reporting contract names", async () => {
        let received;
        server.onCommand("set_loglevel", (args) => {
          received = args;
          return { console_loglevel: "critical", file_loglevel: "warning" };
        });
        await client.connect();
        const result = await client.setLogLevel("fatal", "warn");
        expect(received?.console_loglevel).to.equal("fatal");
        expect(received?.file_loglevel).to.equal("warn");
        expect(result.console_loglevel).to.equal("critical");
        expect(result.file_loglevel).to.equal("warning");
      });
    });
    describe("events", () => {
      it("should receive node_added event with BigInt node_id", async () => {
        server.onCommand("start_listening", () => []);
        await client.startListening();
        const nodeId = BigInt("18446744069414584320");
        let nodesChangedCalled = false;
        client.addEventListener("nodes_changed", () => {
          nodesChangedCalled = true;
        });
        server.sendEvent("node_added", {
          node_id: nodeId,
          date_commissioned: "2025-01-01T00:00:00.000000",
          last_interview: "2025-01-01T00:00:00.000000",
          interview_version: 6,
          available: true,
          is_bridge: false,
          attributes: {}
        });
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(nodesChangedCalled).to.be.true;
        const nodeKey = String(nodeId);
        expect(client.nodes[nodeKey]).to.exist;
      });
      it("should receive attribute_updated event with BigInt node_id", async () => {
        const nodeId = BigInt("18446744069414584320");
        server.onCommand("start_listening", () => [
          {
            node_id: nodeId,
            date_commissioned: "2025-01-01T00:00:00.000000",
            last_interview: "2025-01-01T00:00:00.000000",
            interview_version: 6,
            available: true,
            is_bridge: false,
            attributes: { "1/6/0": false }
          }
        ]);
        await client.startListening();
        let nodesChangedCalled = false;
        client.addEventListener("nodes_changed", () => {
          nodesChangedCalled = true;
        });
        server.sendEvent("attribute_updated", [nodeId, "1/6/0", true]);
        await new Promise((resolve) => setTimeout(resolve, 100));
        expect(nodesChangedCalled).to.be.true;
        const nodeKey = String(nodeId);
        expect(client.nodes[nodeKey]?.attributes["1/6/0"]).to.equal(true);
      });
    });
    describe("raw message handling", () => {
      it("should correctly parse messages with large numbers only as JSON values", async () => {
        await client.connect();
        server.clearReceivedCommands();
        server.onCommand("write_attribute", (args) => {
          return args;
        });
        const testValue = "Device ID: 18258567453835851999";
        await client.writeAttribute(BigInt(1), "0/40/5", testValue);
        const commands = server.getReceivedCommands();
        expect(commands).to.have.length(1);
        const parsed = parseBigIntAwareJson(commands[0].raw);
        expect(parsed.args.value).to.equal(testValue);
      });
    });
  });
  describe("Connection class", () => {
    let server;
    beforeEach(async () => {
      server = new MockMatterServer();
      await server.start();
    });
    afterEach(async () => {
      await server?.stop();
    });
    it("should throw if connecting when already connected", async () => {
      const client = new MatterClient(server.url, createNodeWebSocket);
      await client.connect();
      try {
        await client.connect();
      } catch {
      } finally {
        client.disconnect();
      }
    });
    it("should handle disconnect gracefully", async () => {
      const client = new MatterClient(server.url, createNodeWebSocket);
      await client.connect();
      expect(client.connection.connected).to.be.true;
      client.disconnect();
      expect(client.connection.connected).to.be.false;
    });
  });
  describe("command timeouts", () => {
    let server;
    let client;
    beforeEach(async () => {
      server = new MockMatterServer();
      await server.start();
      client = new MatterClient(server.url, createNodeWebSocket);
    });
    afterEach(async () => {
      if (client?.connection?.connected) {
        client.disconnect();
      }
      await server?.stop();
    });
    it("should have default timeout of 5 minutes", () => {
      expect(DEFAULT_COMMAND_TIMEOUT).to.equal(5 * 60 * 1e3);
      expect(client.commandTimeout).to.equal(DEFAULT_COMMAND_TIMEOUT);
    });
    it("should timeout command and throw CommandTimeoutError", async () => {
      server.onCommand("ping_node", () => new Promise(() => {
      }));
      await client.connect();
      client.commandTimeout = 50;
      try {
        await client.pingNode(BigInt(1));
        expect.fail("Should have thrown CommandTimeoutError");
      } catch (error) {
        expect(error).to.be.instanceOf(CommandTimeoutError);
        const timeoutError = error;
        expect(timeoutError.command).to.equal("ping_node");
        expect(timeoutError.timeoutMs).to.equal(50);
        expect(timeoutError.message).to.include("timed out after 50ms");
      }
    });
    it("should clear timeout on successful response", async () => {
      let handlerCalled = false;
      server.onCommand("get_nodes", () => {
        handlerCalled = true;
        return [];
      });
      await client.connect();
      client.commandTimeout = 100;
      const result = await client.getNodes();
      expect(handlerCalled).to.be.true;
      expect(result).to.deep.equal([]);
    });
    it("should clear timeout on error response", async () => {
      server.onCommand("remove_node", () => {
        throw new Error("Node not found");
      });
      await client.connect();
      client.commandTimeout = 100;
      try {
        await client.removeNode(BigInt(999));
        expect.fail("Should have thrown an error");
      } catch (error) {
        expect(error).to.not.be.instanceOf(CommandTimeoutError);
        expect(error.message).to.equal("Node not found");
      }
    });
    it("should allow per-command timeout override", async () => {
      server.onCommand("ping_node", () => new Promise(() => {
      }));
      await client.connect();
      client.commandTimeout = 1e4;
      try {
        await client.pingNode(BigInt(1), 1, 30);
        expect.fail("Should have thrown CommandTimeoutError");
      } catch (error) {
        expect(error).to.be.instanceOf(CommandTimeoutError);
        expect(error.timeoutMs).to.equal(30);
      }
    });
    it("should disable timeout when set to 0", async function() {
      this.timeout(500);
      server.onCommand("get_nodes", async () => {
        await new Promise((resolve) => setTimeout(resolve, 100));
        return [];
      });
      await client.connect();
      client.commandTimeout = 0;
      const result = await client.getNodes();
      expect(result).to.deep.equal([]);
    });
    it("should use default timeout when no per-command timeout provided", async () => {
      server.onCommand("ping_node", () => new Promise(() => {
      }));
      await client.connect();
      client.commandTimeout = 25;
      try {
        await client.pingNode(BigInt(1));
        expect.fail("Should have thrown CommandTimeoutError");
      } catch (error) {
        expect(error).to.be.instanceOf(CommandTimeoutError);
        expect(error.timeoutMs).to.equal(25);
      }
    });
  });
  describe("connection closed handling", () => {
    let server;
    let client;
    beforeEach(async () => {
      server = new MockMatterServer();
      await server.start();
      client = new MatterClient(server.url, createNodeWebSocket);
    });
    afterEach(async () => {
      await server?.stop();
    });
    it("should reject pending commands with ConnectionClosedError on disconnect", async () => {
      server.onCommand("ping_node", () => new Promise(() => {
      }));
      await client.connect();
      client.commandTimeout = 0;
      const commandPromise = client.pingNode(BigInt(1));
      await new Promise((resolve) => setTimeout(resolve, 20));
      client.disconnect();
      try {
        await commandPromise;
        expect.fail("Should have thrown ConnectionClosedError");
      } catch (error) {
        expect(error).to.be.instanceOf(ConnectionClosedError);
        expect(error.message).to.include("Connection closed");
      }
    });
    it("should reject multiple pending commands on disconnect", async () => {
      server.onCommand("ping_node", () => new Promise(() => {
      }));
      server.onCommand("get_nodes", () => new Promise(() => {
      }));
      await client.connect();
      client.commandTimeout = 0;
      const promise1 = client.pingNode(BigInt(1));
      const promise2 = client.getNodes();
      await new Promise((resolve) => setTimeout(resolve, 20));
      client.disconnect();
      const results = await Promise.allSettled([promise1, promise2]);
      expect(results[0].status).to.equal("rejected");
      expect(results[1].status).to.equal("rejected");
      expect(results[0].reason).to.be.instanceOf(ConnectionClosedError);
      expect(results[1].reason).to.be.instanceOf(ConnectionClosedError);
    });
    it("should reject pending commands when server closes connection", async () => {
      server.onCommand("ping_node", () => new Promise(() => {
      }));
      await client.connect();
      client.commandTimeout = 0;
      const commandPromise = client.pingNode(BigInt(1));
      await new Promise((resolve) => setTimeout(resolve, 20));
      await server.stop();
      try {
        await commandPromise;
        expect.fail("Should have thrown ConnectionClosedError");
      } catch (error) {
        expect(error).to.be.instanceOf(ConnectionClosedError);
      }
    });
  });
});
//# sourceMappingURL=WsClientTest.js.map
