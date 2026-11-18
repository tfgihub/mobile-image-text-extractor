# Stops & Packages prototype

A mobile browser prototype with two steps. No build step, backend, or image
upload service is required.

## Appearance

The compact layout keeps instructions out of the workflow and uses a short,
scrollable package editor that can be resized vertically. The sun/moon button
switches between white and black themes, including scanner cards and notices.
The initial theme follows the device preference; an explicit choice is saved
locally for future visits, separately from saved package records.
If browser storage is unavailable, the theme still switches
for the current page and a warning is logged.

## 1. Upload and check the package list

Select multiple screenshots together. They are read sequentially with one OCR
worker. The importer supports:

- Customer/recipient rows with a `#` reference and following `Package ID` rows.
  The code may be on the next line, including all-letter four-character codes.
- Street-address stops with `Unknown` package rows and longer package IDs.

Small screenshots are enlarged for OCR. Repeated customer references merge even
when names are redacted; street stops merge ignoring case, spacing, commas, and
periods. Identical IDs are deduplicated ignoring letter case. Four-character codes are normalized
to uppercase, and short/full forms of the same ID at one stop count once.
Conflicting assignments of the same package to different stops are reported and
are not added a second time. Clipped package rows and IDs before a stop heading
produce import notes rather than being silently assigned.
Unlabelled alphabetic four-letter text is not guessed as a package: known screen
words such as NEXT are ignored and other uncertain rows produce a review note.
All-letter IDs following an explicit `Package ID` label remain supported.

Import feedback shows only a short completion summary. Clean images do not
produce a log. Images needing review are listed once by filename, with the
affected stop, missing-ID count, readable package with no detected stop, or
assignment conflict. Unreadable/failed images and interrupted batches are
identified explicitly. A clean subsequent import clears the previous notices.
"No detection issues found" means no problems were flagged in the selected
images, not a guarantee that OCR found content it could not read at all; still
check the list against the screenshots.

Review the one editable text box. Use a stop/customer heading followed by IDs,
one per line, and leave a blank line between stops. Check OCR carefully: names,
reference numbers, and 0/O can be misread. The importer does not guess redacted
or unreadable content. `#` references are not interpreted as route stop numbers.
Screenshot checkmarks do not mark packages as found in this prototype.
The number of unique package IDs under each stop is its expected bag total.
Import all overlapping screenshots and review missing-ID warnings before
scanning. Overall cart counters such as `20 OF 40` are not per-stop totals.

Failed or unrecognized screenshots leave the existing list intact. Other files
in the batch are still processed. Invalid editor formatting blocks further
imports until fixed. **Copy list** copies the current editor exactly.

## 2. Scan and group packages

Tap **Continue to scan**, then **Open Live Camera** and allow camera access.
The rear camera is preferred. Show one Data Matrix or QR code at a time.

**Package identity comes from Data Matrix / QR decoding, not printed-ID OCR.**
The app uses ZXing-C++ WebAssembly, including on browsers without native barcode
detection. It first matches a decoded full ID; otherwise its last four characters
must uniquely identify a listed ID. Matching ignores letter case, but never
substitutes Q/O/0 or guesses other characters.

The camera does not run OCR or load an OCR worker. Once a known code is decoded,
it pauses and immediately displays the large stop number, decoded package code,
and **x bags of y bags** (with singular "bag" for one). Here, `x` is the number
of unique confirmed packages for that stop plus this pending package (unless it
was already confirmed); `y` is the
number of unique IDs in the current
edited screenshot list. Nothing counts until **OK**. **Rescan**
dismisses the notice without changing progress, and confirmed codes
never count twice.

Matched popups show only the large stop number, package code and bag progress,
plus **OK** and **Rescan**. The first popup for a stop number adds a separate
**NEW** badge above the number, with larger bold text on a pale-blue pill in
day mode and a deep-blue pill in night mode. Both color pairs maintain at
least 4.5:1 text contrast. Later popups omit the badge, without a "Seen before"
label. Showing the popup marks the stop
as appeared even when **Rescan** is selected. This history survives stopping
and reopening the camera, changing steps, or continuing a saved run.
**Reset Found Packages**, **Clear**, or an entirely cleared editor
resets the new-stop markers. Reset is available even if a popup was shown
without confirming any packages.

A one-package stop displays **1 bag of 1 bag**. No customer name, duplicate ID,
total caption, or per-stop "Only package"/"Last package" label clutters a
matched popup. The final unconfirmed package across the entire list adds
**Last package - OK completes the run**. **Rescan** leaves it incomplete;
only **OK** marks the run **All packages scanned**, without another dialog.
Screen-reader names still identify new stops and stop numbers.
Unknown/ambiguous barcode notices retain their warning explanations and never
count packages. OK is still required before a matched stop can complete.

An already confirmed package can show its existing-stop popup again, with
unchanged counts and no additional stop. Holding that same label after OK does
not immediately reopen it. Remove the code from view for at least about half a
second, show a different matched package, or restart the camera to show it again.
Brief blank-frame flicker does not rearm the same confirmed label. Repeating a
package after the whole run is complete shows **All packages scanned**.

**This is scanned progress, not the printed bag position.** Barcodes contain
the package ID, not `n of m bags`. Printed label totals and positions are no
longer read or validated. A listed one-package stop completes after its one
barcode is confirmed, even if the physical label says `1 of 3 bags`.

Unknown codes, unsupported payloads, ambiguous matches, and multiple labels
produce **Check this package** notices without modifying the list or progress.
The same unknown reading is shown once per camera session to avoid a popup loop.

Progress totals always come from the current list. Cards turn green after all
listed IDs at that stop are confirmed, regardless of scan order. Explicit editor
numbers such as `7.` are preserved for camera notices; otherwise list order is
used. Screenshot imports preserve existing route numbers and append new stops
after the highest existing number.

Stop the camera to go back and edit/import more screenshots. Progress follows
listed IDs across edits; deleted IDs lose their saved scans and must be scanned
again if re-added. Deleting a full package row or clearing its ID updates the
total and completion immediately. Empty package bullets are ignored. Stops
with no packages display an explicit skipped message, never turn green, and do
not block scanning other stops. At least one listed ID is required overall.
The app rereads the editor when changing steps and opening the camera, so the
camera list never relies on an earlier snapshot of the editor.
IDs must contain at least four letters/digits or `_`/`-`.
Equivalent case changes and short-to-full ID upgrades retain confirmation.
If an old short confirmation becomes ambiguous between multiple distinct full
IDs, it is cleared with an explicit review message rather than guessed; scan
those packages again using their full codes.
A confirmed package cannot change stop number, including through an ID alias
or renumbering. Such an edit restores the previous accepted list and explains
the problem. Correct the assignment before scanning, or explicitly reset
found-package progress first.
**Reset Found Packages** keeps the list; **Clear** clears both.
Camera tracks are released on Stop, navigation away, or moving the
page to the background. Stop unlocks controls immediately, even while decoder
loading or the browser permission request is pending. Late permission responses
are discarded without disturbing a newly opened camera.
Returning requires opening the camera again.

## Saved runs

The list, confirmed packages and NEW-stop history are automatically saved in
this browser's local storage. On reopening or refreshing, choose **Continue
previous run** or **Clear records and start fresh**. Continue restores progress
without opening the camera. A pending popup saves its appearance history, never
its unconfirmed package. A partially edited list is preserved too; fix its
format before scanning. Clearing package records does not reset the theme.

**Reset Found Packages** keeps the list but clears confirmations and NEW history.
**Clear**, an entirely empty editor, or clearing records at startup removes the
saved run. Storage failures are shown explicitly: changes may exist only in the
current page and older records may return after reopening. Corrupt records are
not overwritten automatically; startup requires an explicit clear.

Use one active tab for sorting. If another tab changes or clears the run, the
stale tab stops scanning and freezes editing instead of overwriting newer
records. Copy any unsaved list, then reload that tab.

Records stay on this browser/device, not in an account or across devices.
Normal release URLs with different query strings share the same records.
Clearing browser/site data, private browsing, or browser storage eviction can
remove them. Keep a copied list as a backup.

## Privacy and limitations

All images, decoded IDs, OCR, and progress remain in the browser. Internet is
required to download Tesseract.js 5.1.1 and ZXing-WASM 2.2.2 plus their engines
from external CDNs. Images are never sent to those CDNs.

Saved records do not make the app fully offline: opening the page and downloading
the OCR/barcode engines still require an internet connection. Browser caching
alone is not guaranteed offline support; no offline/PWA mode is provided.
Camera and clipboard access require HTTPS (or localhost
for development) and browser permission.

Barcode decoding is usually faster and more reliable than reading printed IDs,
but depends on focus, light, code size, and device performance.
Screenshot imports still use OCR and need human review.

## Development and publishing

Run `python3 -m http.server 8080 --bind 127.0.0.1` here, then open
`http://localhost:8080`. Stop the server with Ctrl+C.

### Regression tests

Use Node.js 22 or newer. Install the test dependencies and Chromium once:

```sh
npm ci
npx playwright install --with-deps chromium --only-shell
npm test
```

**Before merging or publishing a feature, add regression coverage for its
behavior and run `npm test`.** This runs the unit tests followed by
the mobile browser integration cases. Target a workflow during development with
`npm run test:integration -- tests/scanning.spec.mjs`, or run just the unit
suite with `npm run test:unit`.

To watch tests slowly on a desktop with a graphical display, install the full
browser once and start Inspector:

```sh
npx playwright install chromium
npm run test:integration -- --debug
```

Click **Resume (F8)** in Inspector to continue from its initial pause. Local
debug runs add one second between browser actions and keep the final screen
open for three seconds before the next test. Use **Step Over (F10)** for one
action at a time. Stop an existing run with Ctrl+C and restart it to pick up
configuration changes. Normal runs and CI add neither of these viewing delays.

The browser suite uses the real page, file uploads, editor, camera frame loop,
dialogs and buttons. A real Tesseract worker reads a generated two-stop image;
real ZXing-WASM decodes generated QR and Data Matrix frames. All test names,
addresses, IDs and images are synthetic. Other OCR/barcode results and device
failures are controlled to test edge cases deterministically. Pinned engines
and English language data are served from installed test dependencies, so the
browser tests do not depend on CDN availability or require a physical camera.
No test hooks are shipped in the application modules.

| Workflow | Regression coverage |
| --- | --- |
| Screenshot import | Real OCR, both screenshot formats, multiple/overlapping images, preserved route numbers, deduplicated case/short/full IDs, progress migration, edited-list merging, conflicts, unlabelled screen words, orphan/clipped rows, empty/unrecognized results |
| Import failures | Bad files, continuing after a failed image, worker startup/cleanup, disabled busy controls, invalid-editor preservation |
| Barcode matching | Real QR/Data Matrix decoding, full/suffix and case-insensitive matches, exact-match priority, unknown/unsupported/ambiguous/multiple codes, no Q/0 guessing, duplicate suppression |
| Notices and completion | Minimal accessible popup, separate NEW badge, per-stop history, Rescan/OK, held-label suppression and rearming, repeat notices without double counting, final-package preview versus committed completion |
| Editing and reset | Cleared bullets, deletion/re-add, confirmed-move rejection including after invalid edits/reload, empty stops/all-empty headings, current camera totals, reset without confirmations, Clear/empty editor, cancelled confirmations |
| Saved runs | Continue/Clear choices, exact list/count/history recovery, pending versus confirmed scans, theme independence, corrupt/unsupported records, blocked/quota/clear failures, stale-tab protection, narrow light/dark dialogs |
| Camera lifecycle | No camera OCR, operation without Tesseract, rear-camera constraints, locked controls, permission/decoder failures, immediate cancellation, late old-session versus restarted-camera races, blank frames, background/pagehide and disconnection |
| Phone UI | 320/390 px layouts, compact scrolling editor, unclipped light/dark popups and completion colors, device theme/persistence, unavailable storage, clipboard success/fallback |

These are mobile Chromium tests, not a substitute for checking physical phone
camera focus, permissions, background behavior, or Safari compatibility.
Tests start and stop their own loopback server on port 4173; an occupied port
fails instead of reusing an unrelated server. Failures save screenshots and
Playwright traces under ignored `test-results/`.

GitHub Actions runs `npm test` on pull requests and pushes to `main` and uploads
failure reports for seven days. The workflow does not change repository branch
protection or gate the existing branch-based Pages deployment; require its
`regression` check in branch protection if a mandatory merge gate is needed.

### Publishing

In GitHub **Settings > Pages**, choose **Deploy from a branch**, **main**,
and **/ (root)**. Publish only this standalone website, never private images or
other workspace files.

Browser module URLs carry a release query string. Bump it consistently in the
HTML and module imports for browser code changes so phones do not mix cached
modules from different releases.
