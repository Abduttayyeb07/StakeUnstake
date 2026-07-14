import { google, sheets_v4 } from "googleapis";

export interface SnapshotRow {
  address: string;
  /** UTC date the snapshot was taken, e.g. "2026-07-14" */
  day: string;
  zigBalance: string;
  stZigBalance: string;
  delegation: string;
  dailyRewards: string;
}

/**
 * Appends one row per tracked-wallet event to that wallet's sheet tab.
 * Auth is a Google service account (JSON key file); the spreadsheet must be
 * shared with that service account's client_email as an Editor.
 */
export class SheetsClient {
  private readonly api: sheets_v4.Sheets;

  constructor(
    credentialsPath: string,
    private readonly spreadsheetId: string,
  ) {
    const auth = new google.auth.GoogleAuth({
      keyFile: credentialsPath,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });
    this.api = google.sheets({ version: "v4", auth });
  }

  async appendRow(sheetName: string, row: SnapshotRow): Promise<void> {
    await this.api.spreadsheets.values.append({
      spreadsheetId: this.spreadsheetId,
      range: `${sheetName}!A:F`,
      valueInputOption: "USER_ENTERED",
      insertDataOption: "INSERT_ROWS",
      requestBody: {
        values: [
          [row.address, row.day, row.zigBalance, row.stZigBalance, row.delegation, row.dailyRewards],
        ],
      },
    });
  }
}

/** Extracts the spreadsheet id from a full Google Sheets URL, or passes through a bare id. */
export function parseSpreadsheetId(urlOrId: string): string {
  const match = urlOrId.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return match ? match[1] : urlOrId;
}
