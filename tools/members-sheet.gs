// Paper Pig members sheet: one row per family, every parent of that family on the same row.
// Every time someone joins, the Netlify function "joined" posts them here.
// Set up (once): open the Google Sheet > Extensions > Apps Script > paste this whole file > Save.
// Then Project Settings (gear) > Script properties > Add: SECRET = the same text as Netlify's JOINED_HOOK_SECRET.
// Then Deploy > New deployment > type: Web app > Execute as: Me > Who has access: Anyone > Deploy,
// and copy the Web app URL into Netlify as SHEET_WEBHOOK_URL.
// After changing this code: Deploy > Manage deployments > pencil > Version: New version > Deploy (the URL stays).

const TAB = 'Families';
const HEADERS = ['Family', 'Parents', 'Parents (#)', 'Joined', 'Last parent joined', 'Time zone', 'Family ID'];
const COL = { family: 1, parents: 2, count: 3, joined: 4, last: 5, tz: 6, id: 7 };

function doPost(e) {
  const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret || d.secret !== secret) return out('denied');
  if (!d.family_id) return out('no family');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = familiesTab();
    const when = d.joined_at ? new Date(d.joined_at) : new Date();
    const last = sh.getLastRow();
    const ids = last > 1 ? sh.getRange(2, COL.id, last - 1, 1).getValues().map(r => String(r[0])) : [];
    const i = ids.indexOf(String(d.family_id));
    if (i === -1) {
      sh.appendRow([d.family || '', d.email || '', d.email ? 1 : 0, when, when, d.timezone || '', d.family_id]);
    } else {
      const row = i + 2;
      const cur = sh.getRange(row, 1, 1, HEADERS.length).getValues()[0];
      const parents = String(cur[COL.parents - 1] || '').split(',').map(s => s.trim()).filter(Boolean);
      if (!d.email || parents.indexOf(d.email) !== -1) return out('dup');
      parents.push(d.email);
      const t = x => (x instanceof Date ? x.getTime() : new Date(x).getTime()) || 0;
      const first = t(cur[COL.joined - 1]) && t(cur[COL.joined - 1]) < when.getTime() ? cur[COL.joined - 1] : when;
      const latest = t(cur[COL.last - 1]) > when.getTime() ? cur[COL.last - 1] : when;
      sh.getRange(row, 1, 1, 6).setValues([[d.family || cur[0], parents.join(', '), parents.length, first, latest, d.timezone || cur[5]]]);
    }
    const n = sh.getLastRow();
    if (n > 1) {
      sh.getRange(2, COL.joined, n - 1, 2).setNumberFormat('yyyy-mm-dd h:mm am/pm');
      if (n > 2) sh.getRange(2, 1, n - 1, HEADERS.length).sort({ column: COL.joined, ascending: false });
    }
    return out('ok');
  } finally {
    lock.releaseLock();
  }
}

function familiesTab() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(TAB);
  if (!sh) sh = ss.insertSheet(TAB, 0);
  if (sh.getLastRow() === 0) {
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.hideColumns(COL.id);
  }
  return sh;
}

function out(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT); }
