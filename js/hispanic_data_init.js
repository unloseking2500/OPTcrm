/*
 * Hispanic data initializer
 *
 * This small script runs after the large data file (hispanic_data_out.js)
 * has been injected into the page.  The data file defines a global
 * object `countyHispanicData` containing Hispanic population
 * percentages for each county in the US.  Here we promote that
 * object onto the `window` so it is accessible across content
 * scripts, and set a flag indicating that the data has loaded.  We
 * also dispatch a custom event to notify listeners (such as
 * content.js) that the data is available.
 */

(function() {
  try {
    // If the dataset is defined (from hispanic_data_out.js), expose it
    // on the window so other scripts can access it.  This is done
    // defensively so that if the dataset is missing for some reason,
    // we simply do nothing.
    if (typeof countyHispanicData !== 'undefined' && countyHispanicData) {
      window.countyHispanicData = countyHispanicData;
      window.hispanicDataLoaded = true;
      try {
        // Dispatch an event to inform any listeners that the data is ready
        window.dispatchEvent(new CustomEvent('hispanicDataLoaded'));
      } catch (err) {
        // Ignore errors dispatching the event; the flag above can still be used
        console.warn('[RUCC Highlighter] Failed to dispatch hispanicDataLoaded event:', err);
      }
    }
  } catch (e) {
    // Log unexpected errors; do not throw as this runs in a content script
    console.error('[RUCC Highlighter] Error initializing Hispanic data:', e);
  }
})();
