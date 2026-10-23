/**
 * Drive manifest — lists every file under an uploaded archive folder.
 *
 * This runs in YOUR Google account, not here: the app has no Drive credentials
 * and does not need any. It walks the folder you uploaded and writes a CSV of
 * `path,file_id,web_view_link`, which `npm run archive:drive` then matches
 * against the archive paths already recorded in the database.
 *
 * HOW TO RUN
 *   1. Open the uploaded folder in Drive. The URL ends with the folder id:
 *        https://drive.google.com/drive/folders/THIS_PART_IS_THE_ID
 *   2. Go to https://script.google.com → New project.
 *   3. Paste this whole file in, replacing the default `myFunction` stub.
 *   4. Put the folder id into ROOT_FOLDER_ID below.
 *   5. Run `writeManifest`. Google asks for Drive access the first time —
 *      that is this script reading your own Drive; approve it.
 *   6. The execution log prints where the CSV landed. Download it and save it
 *      as `archive-scan/drive-manifest.csv` in the project.
 *
 * The paths it writes are relative to the folder you point it at. If you
 * uploaded a single parent containing `Import - ATC`, `Import- Valuecon` and
 * `Import- Noto`, point it at that parent and leave INCLUDE_ROOT_NAME false.
 */

// The folder you uploaded, from its Drive URL.
var ROOT_FOLDER_ID = 'PASTE_THE_FOLDER_ID_HERE';

// Leave false so paths start at `Import - ATC/...` rather than
// `Whatever You Named The Upload/Import - ATC/...`. The backfill can strip a
// leading segment itself, so this only needs changing in odd cases.
var INCLUDE_ROOT_NAME = false;

function writeManifest() {
  if (ROOT_FOLDER_ID === 'PASTE_THE_FOLDER_ID_HERE') {
    throw new Error('Set ROOT_FOLDER_ID to the id of the folder you uploaded.');
  }

  var root = DriveApp.getFolderById(ROOT_FOLDER_ID);
  var name = 'drive-manifest.csv';

  // Clear the previous run BEFORE walking, so a re-run neither lists its own
  // last output as an archive file nor leaves two manifests to choose between.
  var existing = root.getFilesByName(name);
  while (existing.hasNext()) existing.next().setTrashed(true);

  var rows = [['path', 'file_id', 'web_view_link']];
  var seen = {};
  var duplicates = [];

  walk_(root, INCLUDE_ROOT_NAME ? root.getName() + '/' : '', rows, seen, duplicates);

  var csv = rows.map(function (row) { return row.map(csvCell_).join(','); }).join('\n');
  var file = root.createFile(name, csv, MimeType.PLAIN_TEXT);

  Logger.log('Wrote ' + (rows.length - 1) + ' files to ' + name);
  Logger.log('Inside the folder: ' + root.getName());
  Logger.log('Download it here: ' + file.getUrl());

  // Two files with the same path cannot both be the right answer, and guessing
  // would put the wrong link on a document. Report them and leave them out.
  if (duplicates.length) {
    Logger.log('');
    Logger.log(duplicates.length + ' duplicate path(s) — these are AMBIGUOUS and');
    Logger.log('the backfill will skip them. Tidy them in Drive and re-run:');
    for (var i = 0; i < Math.min(duplicates.length, 20); i++) Logger.log('  ' + duplicates[i]);
    if (duplicates.length > 20) Logger.log('  … and ' + (duplicates.length - 20) + ' more');
  }
}

function walk_(folder, prefix, rows, seen, duplicates) {
  var files = folder.getFiles();
  while (files.hasNext()) {
    var file = files.next();
    var path = prefix + file.getName();

    if (seen[path]) {
      duplicates.push(path);
      continue;
    }
    seen[path] = true;

    rows.push([path, file.getId(), file.getUrl()]);
  }

  var folders = folder.getFolders();
  while (folders.hasNext()) {
    var sub = folders.next();
    walk_(sub, prefix + sub.getName() + '/', rows, seen, duplicates);
  }
}

/** Quote anything with a comma, quote or newline — folder names have all three. */
function csvCell_(value) {
  var text = String(value == null ? '' : value);
  return /[",\n\r]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
}
