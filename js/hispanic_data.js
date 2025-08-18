/*
 * Hispanic data loader
 *
 * This script asynchronously loads county‑level Hispanic population
 * percentages from a JSON file packaged with the extension.  The data
 * resides in js/hispanic_data.json and is declared as a web accessible
 * resource in the manifest.  When loaded, the data is stored in
 * window.countyHispanicData and a flag window.hispanicDataLoaded is
 * set to true.  Content scripts should check hispanicDataLoaded
 * before attempting to use countyHispanicData.
 */

// Initialise global variables for Hispanic data.  These will be
// populated once the JSON is fetched.  Using window.* ensures they
// reside on the same global object that other content scripts share.
window.countyHispanicData = undefined;
window.hispanicDataLoaded = false;

// Immediately invoke an async function to fetch the JSON.  This
// pattern allows top‑level await without requiring the script to be
// loaded as a module.  Errors are caught and logged; failure to load
// will leave countyHispanicData undefined and hispanicDataLoaded false.
(async () => {
  try {
    // Construct the URL for the JSON file relative to the extension root
    const url = chrome.runtime.getURL('js/hispanic_data.json');
    const response = await fetch(url);
    const data = await response.json();
    window.countyHispanicData = data;
    window.hispanicDataLoaded = true;
    console.log('[RUCC Highlighter] Hispanic data loaded successfully');
    // Dispatch a custom event to notify other scripts (e.g. content.js) that
    // the Hispanic data is ready.  Listeners can then call functions
    // dependent on this data, such as addHispanicLabels().
    try {
      window.dispatchEvent(new CustomEvent('hispanicDataLoaded'));
    } catch (e) {
      // If dispatching fails (e.g. in unsupported environments), just log it.
      console.warn('[RUCC Highlighter] Could not dispatch hispanicDataLoaded event:', e);
    }
  } catch (error) {
    console.error('[RUCC Highlighter] Failed to load Hispanic data:', error);
  }
})();