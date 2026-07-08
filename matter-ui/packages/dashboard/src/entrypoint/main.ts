/**
 * @license
 * Copyright 2025-2026 Open Home Foundation
 * SPDX-License-Identifier: Apache-2.0
 */

import { MatterClient } from "@matter-server/ws-client";
import "../util/theme-service.js"; // Initialize theme service early
import "../pages/login-screen.js";

async function main() {
    import("../pages/matter-dashboard-app.js");

    // Detect if we're running in the (production) webserver included in the matter server or not.
    // Priority: 1) Server-injected flag (for reverse proxy setups), 2) URL-based detection
    const isProductionServer =
        (window as unknown as { __MATTERJS_PRODUCTION_MODE__?: boolean }).__MATTERJS_PRODUCTION_MODE__ === true ||
        location.origin.includes(":5580") ||
        location.href.includes("hassio_ingress") ||
        location.href.includes("/api/ingress/");

    // Function to initialize dashboard once we have a URL
    const initDashboard = (socketUrl: string) => {
        const client = new MatterClient(socketUrl);
        client.isProduction = isProductionServer;

        const dashboard = document.createElement("matter-dashboard-app");
        dashboard.client = client;
        
        // Clear body and append dashboard
        document.body.innerHTML = "";
        document.body.append(dashboard);
    };

    // Build a ws:// URL from an IP/host string (mirrors the login screen's logic).
    const buildSocketUrl = (ipInput: string | null): string | null => {
        try {
            let host = (ipInput || location.host).trim();
            if (!host.startsWith("http") && !host.startsWith("ws")) host = "ws://" + host;
            const urlObj = new URL(host);
            // Home Assistant is on 8123; the Matter server WebSocket is on 5580.
            if (urlObj.port === "8123") urlObj.port = "5580";
            if (urlObj.protocol === "http:") urlObj.protocol = "ws:";
            if (urlObj.protocol === "https:") urlObj.protocol = "wss:";
            if (!urlObj.pathname.endsWith("/ws")) {
                urlObj.pathname = urlObj.pathname.replace(/\/$/, "") + "/ws";
            }
            return urlObj.toString();
        } catch {
            return null;
        }
    };

    // Auto-connect (skip the login screen) when deep-linked with ?ac=1 — used by the
    // analytics dashboard's Node / Thread tabs. The hash (e.g. #thread) is preserved,
    // so routing lands on the right view. Falls through to the login screen on failure.
    const params = new URLSearchParams(location.search);
    if (params.get("ac") === "1") {
        const autoUrl = buildSocketUrl(params.get("ip"));
        if (autoUrl) {
            localStorage.setItem("matterURL", autoUrl);
            localStorage.setItem("authToken", params.get("user") || "dhanush");
            initDashboard(autoUrl);
            return;
        }
    }

    // Always show login screen for now so you can connect to different Hubs
    const loginScreen = document.createElement("login-screen");
    loginScreen.addEventListener("login-success", (e: any) => {
        const finalUrl = e.detail.url;
        const user = e.detail.username;
        
        // Save to storage if needed by other parts of the app
        localStorage.setItem("matterURL", finalUrl);
        localStorage.setItem("authToken", user);
        
        // Start dashboard
        initDashboard(finalUrl);
    });
    
    document.body.innerHTML = "";
    document.body.append(loginScreen);
}

main();
