/**
 * Schnell Dock Data — Google Sheet → BigQuery auto-sync
 *
 * Lives inside the Google Sheet (Extensions → Apps Script).
 * On every change to the sheet, replaces the whole
 * schnell_analytics.dock_logs table with the sheet's current rows —
 * BigQuery always mirrors the sheet exactly.
 *
 * Setup (one time):
 *   1. Open the Sheet → Extensions → Apps Script
 *   2. Delete any code there, paste this whole file, press Save (⌘S)
 *   3. Left sidebar → Services → "+" → find "BigQuery API" → Add
 *   4. Left sidebar → Triggers (clock icon) → Add Trigger:
 *        function:        onChangeSync
 *        event source:    From spreadsheet
 *        event type:      On change
 *      → Save → a Google sign-in appears → choose your account → Allow
 *   5. Test: run syncToBigQuery once from the ▶ Run button — check for errors
 */

const PROJECT_ID = 'schnell-home-automation';
const DATASET_ID = 'schnell_analytics';
const TABLE_ID   = 'dock_logs';

// Expected sheet columns, in order (row 1 = headers):
// hub_id | date | day_of_week | dock_id | docklet_id | action |
// total_action_count | success_count | failure_count

function syncToBigQuery() {
  const sheet  = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
  const values = sheet.getDataRange().getValues();
  if (values.length < 2) return;   // headers only — nothing to sync

  const rows = values.slice(1).filter(r => r[0] !== '' && r[0] !== null);

  const csv = rows.map(r => r.map((v, i) => {
    if (v instanceof Date) {
      // the date column — force YYYY-MM-DD regardless of sheet formatting
      return Utilities.formatDate(v, 'Asia/Kolkata', 'yyyy-MM-dd');
    }
    return String(v).replace(/"/g, '""');
  }).map(v => '"' + v + '"').join(',')).join('\n');

  const job = {
    configuration: {
      load: {
        destinationTable: { projectId: PROJECT_ID, datasetId: DATASET_ID, tableId: TABLE_ID },
        writeDisposition: 'WRITE_TRUNCATE',   // full replace — table always mirrors the sheet
        sourceFormat: 'CSV',
        schema: { fields: [
          { name: 'hub_id',             type: 'STRING' },
          { name: 'date',               type: 'STRING' },
          { name: 'day_of_week',        type: 'STRING' },
          { name: 'dock_id',            type: 'STRING' },
          { name: 'docklet_id',         type: 'STRING' },
          { name: 'action',             type: 'STRING' },
          { name: 'total_action_count', type: 'INT64'  },
          { name: 'success_count',      type: 'INT64'  },
          { name: 'failure_count',      type: 'INT64'  },
        ]},
      },
    },
  };

  const blob = Utilities.newBlob(csv, 'application/octet-stream');
  BigQuery.Jobs.insert(job, PROJECT_ID, blob);
  console.log('Synced ' + rows.length + ' rows to ' + PROJECT_ID + '.' + DATASET_ID + '.' + TABLE_ID);
}

/** Installable trigger target — fires on every sheet change. */
function onChangeSync(e) {
  syncToBigQuery();
}
