/* global Zotero, Services */
/* eslint-disable no-unused-vars, no-var */

// Defined by content/lib.js and content/citecounts.js (loaded below).
var CiteCountsLib;
var CiteCounts;

function install() {}

// From Firefox 153.3 ESR the script loader refuses jar:/file: URIs unless
// allowUnsafeURL is set (Mozilla bug 1974213; Zotero commit ba2d6ece). Zotero
// relaxes this with a temporary pref that will go away, so opt in explicitly.
function loadScript(url) {
  const loader = Services.scriptloader;
  if (typeof loader.loadSubScriptWithOptions === "function") {
    try {
      loader.loadSubScriptWithOptions(url, { allowUnsafeURL: true });
      return;
    } catch (e) {
      if (!/allowUnsafeURL|options/i.test(String(e))) throw e;
    }
  }
  loader.loadSubScript(url);
}

async function startup({ id, version, rootURI }) {
  await Zotero.initializationPromise;
  loadScript(rootURI + "content/lib.js");
  loadScript(rootURI + "content/citecounts.js");
  CiteCounts.init({ id, version, rootURI });
  await CiteCounts.startup();
  // Windows that were already open before the plugin started
  for (const win of Zotero.getMainWindows()) CiteCounts.onMainWindowLoad(win);
}

function onMainWindowLoad({ window }) {
  if (CiteCounts) CiteCounts.onMainWindowLoad(window);
}

function onMainWindowUnload({ window }) {
  if (CiteCounts) CiteCounts.onMainWindowUnload(window);
}

function shutdown() {
  if (CiteCounts) CiteCounts.shutdown();
  CiteCounts = undefined;
  CiteCountsLib = undefined;
}

function uninstall() {}
