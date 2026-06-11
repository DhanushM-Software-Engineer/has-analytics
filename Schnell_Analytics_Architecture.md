# Schnell Fleet Analytics Architecture

This document provides a comprehensive, deep-dive architectural overview of the Schnell Smart Home Analytics ecosystem. It covers the data generation process, the raw CSV data models, the processing pipeline, UI rendering, and the core mathematical formulas that drive the fleet KPIs.

---

## 1. High-Level Architecture

The analytics ecosystem is a **client-side, serverless visualization pipeline**. It operates in three distinct phases:

1. **Data Generation (The Mock Hardware Layer)**
   Raw log files (`.csv`) are generated per-hub to simulate distributed telemetry from physical hubs, mobile apps, and hardware docks.
2. **Data Processing (The Aggregation Layer)**
   A Python build script parses all CSVs, applies mathematical formulas, calculates reliability and latency, and aggregates the data into a single, highly structured JSON payload.
3. **Data Visualization (The Client UI Layer)**
   A static HTML/JS dashboard consumes the JSON payload to render interactive charts, dynamic tables, and enterprise-grade KPI cards in real-time.

---

## 2. File & Directory Structure

The project lives under the `/Analytics/sample_logs/` directory.

### Core Scripts & UI
*   `generate_sample_logs.py`: The simulation engine. It programmatically generates realistic, distributed log events, simulating network latency, Thread mesh transit loss, and physical hardware interactions.
*   `build_dashboard.py`: The aggregation engine. It parses all CSVs, calculates KPIs, and compiles the data into `dashboard_data.js`.
*   `dashboard_data.js`: The compiled JSON payload injected into the global window object.
*   `dashboard.html`: The markup for the dashboard interface.
*   `dashboard_app.js`: The client-side logic driving the Fleet Overview, Hub drill-downs, dynamic modals, and Chart.js renderings.

### Per-Hub Raw Data Directories
Each hub (e.g., `hub001/`, `hub002/`) contains independent data streams:
*   `unified_event_log.csv`: The core chronological ledger of all state changes seen by the hub.
*   `dock_offline_logs.csv`: The hardware-level truth reported directly from the physical docks.
*   `app_logs.csv` & `ha_logs.csv`: Deeper component-level telemetry.
*   `failure_log.csv`: Specific error records with reasons (e.g., `TIMEOUT`, `THREAD_MESH_FAIL`).
*   `hourly_heatmap.csv` / `daily_summary.csv` / `device_summary.csv`: Aggregated caches (used primarily for legacy rendering or specific chart views).
*   `*_registry.csv`: Static configurations linking device IDs to physical rooms and floors.

---

## 3. Core Data Models (The CSVs)

The entire dashboard is built upon two critically distinct data sources. Understanding their separation is key to understanding the analytics.

### A. The Hub Ledger: `unified_event_log.csv`
This is the central nervous system. Every row represents an event that the **Hub successfully received and processed**.
*   **Key Fields**:
    *   `source`: Who triggered it? (`app`, `docklet`, `automation`, `remote_app`).
    *   `use_case`: The specific flow (e.g., UC1 for local app control, UC2 for dock control).
    *   `latency_ms`: The end-to-end response time.
    *   `success`: Boolean indicating if the hardware state actually changed.
*   *Note on Docks*: When a dock event appears here (source = `docklet`), it means the button press successfully traversed the Thread mesh and reached the Hub.

### B. The Hardware Ledger: `dock_offline_logs.csv`
This represents the dock's **own internal memory**. It is completely independent of the hub.
*   **Key Fields**:
    *   `dock_id`: The physical hardware ID (e.g., `W-Dock001-01`).
    *   `event`: The specific action (`toggle`, `increment`, `decrement`).
    *   `total_event_count`: How many times the button was pressed.
    *   `success_count` / `failure_count`: Did the dock itself experience an internal hardware failure?
*   *Crucial Relationship*: The dock might record 132 button presses internally, but due to wireless interference, the Hub might only record 121 of them in the `unified_event_log`. This discrepancy is how we calculate Thread Mesh Transit Loss.

---

## 4. Mathematical Formulas & Core KPIs

The dashboard calculates enterprise-grade metrics using the following strict formulas during the `build_dashboard.py` execution:

### 4.1 Fleet-Level KPIs
*   **Total Fleet Events**: 
    $$\sum \text{Total Events (All Hubs)}$$
*   **Fleet Reliability**: 
    $$\frac{\sum \text{Successful Events (All Hubs)}}{\sum \text{Total Events (All Hubs)}} \times 100$$
*   **Avg P50 Latency**: 
    $$\frac{\sum \text{P50 Latency (All Hubs)}}{\text{Total Number of Hubs}}$$
*   **North Star (Sub-1s) Fleet Average**: 
    $$\frac{\sum \text{Daily Sub-1s Percentages}}{\text{Total Data Points}}$$

### 4.2 Hub-Level Granular Reliability
These metrics isolate the failure points in the system architecture.

*   **App Trigger $\rightarrow$ Feedback**
    *   **Measures**: Success rate of user commands initiated from the mobile app.
    *   **Formula**: $\frac{\text{App Feedbacks (Successful UC1/UC3 events in unified log)}}{\text{App Triggers}}$

*   **Dock Trigger $\rightarrow$ Feedback**
    *   **Measures**: Success rate of physical dock interactions that the hub actually processed.
    *   **Formula**: $\frac{\text{Dock Feedbacks (Successful UC2 events in unified log)}}{\text{Dock Triggers (All UC2 events in unified log)}}$

*   **Dock $\rightarrow$ Hub Reliability (Transit Loss)**
    *   **Measures**: How reliably wireless dock commands reach the main hub across the Thread mesh network.
    *   **Formula**: $\frac{\text{Hub Unified Dock Events (Count of UC2 logs)}}{\text{Dock Offline Direct Events (Sum of total\_event\_count from dock\_offline\_logs)}}$
    *   *Why this matters*: A low score here indicates poor wireless coverage, not necessarily broken hardware.

*   **Hub $\rightarrow$ App Reliability**
    *   **Measures**: How reliably the hub's state changes are pushed back to the user's mobile app.
    *   **Formula**: $\frac{\text{Feedback from App (Successful app events)}}{\text{Hub to SNAP (Total HA broadcasts)}}$

---

## 5. Data Processing Logic (`build_dashboard.py`)

The aggregation script acts as the ETL (Extract, Transform, Load) pipeline. 
1.  **Ingestion**: Loops through each folder in `HUBS`.
2.  **Cross-Referencing**: Iterates through `unified_event_log.csv` and cross-references hardware IDs against `device_registry.csv` to map physical rooms.
3.  **Speed Aggregation**: Extracts all `latency_ms` values > 0. It sorts them to find the true mathematical median (P50) rather than an average, preventing extreme outliers from skewing the data.
4.  **Dock Aggregation**: Reads `dock_offline_logs.csv` and aggregates by `dock_id` AND `event` type (e.g., separating `toggle` vs `increment`). It calculates a weighted average response time based on the event volume per action.
5.  **Output**: Dumps a minimized, highly nested JavaScript object into `dashboard_data.js`.

---

## 6. User Interface Logic (`dashboard_app.js`)

The front-end is a vanilla JavaScript application prioritizing speed and lack of external framework dependencies (other than Chart.js).

1.  **State Management**: `activeHub` stores the currently viewed hub context. If `null`, the UI renders the Fleet Overview.
2.  **Fleet Rendering (`renderLanding`)**: Loops through the global `DASHBOARD_DATA` object to calculate fleet-wide aggregates on the fly. It dynamically alters CSS classes (e.g., `tag-green`, `tag-red`) based on threshold logic (e.g., $< 93\%$ is Critical).
3.  **Detail Rendering (`renderDetail`)**: Triggers specific rendering functions (`renderOverall`, `renderSpeed`, `renderReliability`) that populate the DOM elements for the selected hub.
4.  **Modals (`showModal`)**: Highly interactive drill-downs. Functions like `showFleetModal(type)` or `showDockDetailModal(idx)` dynamically construct HTML tables on the fly to show exactly how a specific metric was calculated, exposing the raw numerators and denominators to the user.
