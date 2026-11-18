# Mobile Image Text Extractor

A standalone, mobile-friendly page that extracts English text from pictures
with Tesseract.js. No build step or backend is needed.

## Use

Open the GitHub Pages HTTPS link on your phone, choose or take a photo, wait for
recognition, then review and copy the text. Camera options depend on your phone
and browser. Clear photos of printed English text work best.

### Stop and package list

This is a prototype with **one editable text box**, not separate extraction,
review, and final-list sections. Each scan updates that same box automatically.
Check and correct addresses and package IDs directly there. You can also type or
paste stops manually, with an address on the first line, package IDs on following
lines (optionally prefixed with `- `), and a blank line between stops.
Multiple stops in one screenshot are supported.

The parser recognizes common English street suffixes and package rows labeled
`Unknown`, plus standalone IDs beginning with `sp`. Symbols before `Unknown`
are not treated as package counts. Missing/unassigned IDs produce warnings.
Other formats may need manual correction; the parser cannot guarantee that
every package was detected. It never silently corrects the case of package IDs.

Repeated addresses (ignoring case, extra spaces, commas and periods) merge;
identical package IDs at the same stop appear once. New scans read your current
edited text rather than a separate saved list, preserving corrections and manual
additions. Delete stops or IDs directly in the box. **Copy List** copies exactly
what is currently in the box.

If existing text does not follow the list format, it is kept verbatim and new
stops are appended without merging, with a visible warning. If a scan has no
recognized street address, its raw OCR text is appended for manual correction.
Failed or empty scans leave the existing list untouched.

The list is kept in memory in the current tab only, not saved or uploaded.
Copy it before closing or refreshing the page. Clearing the list requires
confirmation. The editor is read-only while a scan runs.

### Live camera package matching

After checking the list, tap **Open Live Camera** and allow camera access.
The rear camera is preferred. Show one entire label with its four-character
package code and **n of m bags** text. Live OCR reads one frame at a time on the
device. It reads printed text, not barcodes. Both fields must be readable in the
same frame before a bag is counted. Hold the camera upright and keep the label
well lit and in focus.

The four-character label code matches the last four characters of a listed
package ID, ignoring letter case but never guessing similar characters such as
O/0. The match must identify exactly one listed package. The bottom code after
the Weight line is preferred so the separate `Sp #` value is not mistaken for
the package code. The label address is not used to assign a stop.
OCR can confuse Q, O, and 0 on angled or wrinkled labels. An unmatched reading
produces a check-package notice rather than a guessed assignment. Reposition
the camera and retry; automatic recognition is not guaranteed for every label.

A match pauses recognition and opens a large stop-number notice showing the
short code, full listed package ID, **Label: bag n of m**, and **Found x/m bags**.
The label position and found count are distinct: scanning bags 1 and 3 of 3
means 2/3 bags found, not complete. Tap **OK - Resume Camera** to resume.
Repeated readings of the same bag do not increase progress or repeat a match.

Unknown codes, suffixes shared by multiple IDs, conflicting totals, or a bag
position already used by another package show **Check this package** and are
never added or assigned to a stop. The same warning is shown once per camera
session for that reading; reopening the camera permits it again. Show only one
label at a time. Unreadable/partial labels keep scanning without counting.

The colored progress list below the editor turns a stop green and labels it
**Complete** only when all numbered bag positions and all listed package IDs
for the stop have been found with a consistent bag total. A list containing
only two IDs cannot turn green from bags 1 and 3 when the label says three bags.
Each card shows bag progress and listed-ID progress separately. Currently one
consistent bag group per stop is supported; conflicting groups require checking
the list and resetting progress. Explicit numbers such
as `7.` in the editor are used as stop numbers; otherwise list order is used.
Duplicate stop numbers and IDs assigned to multiple stops must be fixed before
opening the camera. Duplicate IDs within a stop count once.

Stop the camera to edit the list or import screenshots. Progress follows exact
package IDs across edits, and adding a package makes a completed stop incomplete
until that new ID is found. **Reset Found Packages** clears progress, not the
list. **Clear** clears both. Neither the list nor progress survives a reload.
Camera access requires HTTPS (or localhost during development). Frames are not
uploaded. **Stop Camera**, leaving the page, or backgrounding it releases camera
tracks; returning to the page requires opening the camera again.

Photos are processed locally in your browser, not uploaded. The page downloads
Tesseract.js 5.1.1, its WebAssembly engine, and English language data from external
CDNs. Internet access is required, especially on first use. Large pictures can
take longer or exceed memory on older phones. OCR is not guaranteed to be accurate.

Clipboard access requires HTTPS and browser permission. If copying is blocked,
the page selects the text so you can copy it manually.

## Preview locally

Run `python3 -m http.server 8080 --bind 127.0.0.1` in this directory and open
`http://localhost:8080`. Stop the server with Ctrl+C.

Run parser, matching, and camera lifecycle tests with
`node --test stops.test.mjs packages.test.mjs live-camera.test.mjs`.

## Publish

In the repository's **Settings > Pages**, choose **Deploy from a branch**,
select **main** and **/ (root)**, and save. Only this standalone directory
belongs in the public repository.
