import { LitElement, html, css } from "lit";
import { customElement, state } from "lit/decorators.js";
import "@material/web/button/filled-button.js";
import "@material/web/textfield/outlined-text-field.js";
import "@material/web/checkbox/checkbox.js";

@customElement("login-screen")
export class LoginScreen extends LitElement {
    @state() private _ipAddress = "";
    @state() private _username = "";
    @state() private _password = "";
    @state() private _loading = false;
    @state() private _error = "";

    private _handleLogin() {
        if (!this._ipAddress || !this._username || !this._password) {
            this._error = "Please fill in all fields.";
            return;
        }

        this._error = "";
        this._loading = true;

        // Simulate authentication delay
        setTimeout(() => {
            // Parse IP/Hostname and build websocket URL
            let host = this._ipAddress.trim();
            // If they provided a URL like http://192.168.0.41:8123, parse it
            if (!host.startsWith("http") && !host.startsWith("ws")) {
                host = "ws://" + host;
            }
            
            try {
                const urlObj = new URL(host);
                // If it's a typical Home Assistant port 8123, assume matter server is on 5580
                if (urlObj.port === "8123") {
                    urlObj.port = "5580";
                }
                if (urlObj.protocol === "http:") urlObj.protocol = "ws:";
                if (urlObj.protocol === "https:") urlObj.protocol = "wss:";
                
                // Ensure it ends with /ws
                if (!urlObj.pathname.endsWith("/ws")) {
                    urlObj.pathname = urlObj.pathname.replace(/\/$/, "") + "/ws";
                }

                const finalUrl = urlObj.toString();
                
                // Dispatch event to main.ts
                this.dispatchEvent(new CustomEvent("login-success", {
                    detail: {
                        url: finalUrl,
                        username: this._username
                    }
                }));
            } catch (e) {
                this._error = "Invalid IP address or URL.";
                this._loading = false;
            }
        }, 1000);
    }

    static override styles = css`
        :host {
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            background-color: #03a9f4; /* Home Assistant blue style background */
        }
        
        .login-card {
            background: var(--md-sys-color-surface, #ffffff);
            border-radius: 8px;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1), 0 1px 3px rgba(0,0,0,0.08);
            width: 100%;
            max-width: 400px;
            padding: 32px;
            display: flex;
            flex-direction: column;
            gap: 24px;
        }

        .header {
            text-align: center;
        }

        .header img {
            width: 64px;
            height: 64px;
            margin-bottom: 16px;
        }

        .header h1 {
            margin: 0;
            font-size: 24px;
            font-weight: 400;
            color: var(--md-sys-color-on-surface);
            font-family: Roboto, sans-serif;
        }

        .form-group {
            display: flex;
            flex-direction: column;
            gap: 16px;
        }

        md-outlined-text-field {
            width: 100%;
        }

        .actions {
            display: flex;
            justify-content: flex-end;
            margin-top: 8px;
        }

        .error {
            color: var(--md-sys-color-error, #b3261e);
            font-size: 14px;
            margin-top: -8px;
        }
    `;

    override render() {
        return html`
            <div class="login-card">
                <div class="header">
                    <!-- Simple Matter/HA Logo Placeholder -->
                    <svg viewBox="0 0 24 24" width="64" height="64" style="fill: #03a9f4; margin-bottom: 16px;">
                        <path d="M12,2A10,10 0 0,0 2,12A10,10 0 0,0 12,22A10,10 0 0,0 22,12A10,10 0 0,0 12,2M12,4A8,8 0 0,1 20,12A8,8 0 0,1 12,20A8,8 0 0,1 4,12A8,8 0 0,1 12,4M12,6A6,6 0 0,0 6,12A6,6 0 0,0 12,18A6,6 0 0,0 18,12A6,6 0 0,0 12,6M12,8A4,4 0 0,1 16,12A4,4 0 0,1 12,16A4,4 0 0,1 8,12A4,4 0 0,1 12,8Z" />
                    </svg>
                    <h1>Log In</h1>
                </div>

                <div class="form-group">
                    <md-outlined-text-field 
                        label="Hub IP Address (e.g. 192.168.0.41:8123)" 
                        value="${this._ipAddress}"
                        @input="${(e: any) => this._ipAddress = e.target.value}">
                    </md-outlined-text-field>

                    <md-outlined-text-field 
                        label="Username" 
                        value="${this._username}"
                        @input="${(e: any) => this._username = e.target.value}">
                    </md-outlined-text-field>

                    <md-outlined-text-field 
                        label="Password" 
                        type="password"
                        value="${this._password}"
                        @input="${(e: any) => this._password = e.target.value}"
                        @keydown="${(e: KeyboardEvent) => e.key === 'Enter' && this._handleLogin()}">
                    </md-outlined-text-field>

                    ${this._error ? html`<div class="error">${this._error}</div>` : ""}
                </div>

                <div class="actions">
                    <md-filled-button 
                        @click="${this._handleLogin}" 
                        ?disabled="${this._loading}">
                        ${this._loading ? "CONNECTING..." : "LOG IN"}
                    </md-filled-button>
                </div>
            </div>
        `;
    }
}
