// Paper Pig members sheet. Every time someone joins, the Netlify function "joined" posts them here.
// Set up (once): open the Google Sheet > Extensions > Apps Script > paste this whole file > Save.
// Then Project Settings (gear) > Script properties > Add: SECRET = the same text as Netlify's JOINED_HOOK_SECRET.
// Then Deploy > New deployment > type: Web app > Execute as: Me > Who has access: Anyone > Deploy,
// and copy the Web app URL into Netlify as SHEET_WEBHOOK_URL.

const HEADERS = ['Joined (Mountain)', 'Email', 'Family', 'How', 'Parents in family', 'Time zone', 'User ID', 'Family ID'];

function doPost(e) {
  const d = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  const secret = PropertiesService.getScriptProperties().getProperty('SECRET');
  if (!secret || d.secret !== secret) return out('denied');
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const sh = SpreadsheetApp.getActiveSpreadsheet().getSheets()[0];
    if (sh.getLastRow() === 0) sh.appendRow(HEADERS);
    if (sh.getFrozenRows() !== 1) {
      sh.getRange(1, 1, 1, HEADERS.length).setFontWeight('bold');
      sh.setFrozenRows(1);
    }
    // the same person in the same family is only listed once (the backfill can be run again safely)
    const last = sh.getLastRow();
    if (last > 1 && d.user_id) {
      const keys = sh.getRange(2, 7, last - 1, 2).getValues().map(r => r[0] + '|' + r[1]);
      if (keys.indexOf(d.user_id + '|' + d.family_id) !== -1) return out('dup');
    }
    const when = d.joined_at ? new Date(d.joined_at) : new Date();
    sh.appendRow([
      Utilities.formatDate(when, 'America/Denver', 'yyyy-MM-dd HH:mm'),
      d.email || '', d.family || '', d.kind === 'joined a family' ? 'Joined by invite' : 'New family',
      Number(d.members) || 1, d.timezone || '', d.user_id || '', d.family_id || '',
    ]);
    // newest at the top, under the header
    if (sh.getLastRow() > 2) sh.getRange(2, 1, sh.getLastRow() - 1, HEADERS.length).sort({ column: 1, ascending: false });
    return out('ok');
  } finally {
    lock.releaseLock();
  }
}

function out(s) { return ContentService.createTextOutput(s).setMimeType(ContentService.MimeType.TEXT); }
