/* Enhanced Content script with ultra-aggressive persistence and inactivity handling */

// Store settings locally to work even if background script is inactive
let settings = {
  enableHighlighting: true,
  highlightColor: 'yellow',
  ruccCodesToHighlight: [4, 5, 6, 7, 8, 9],
  /**
   * Filter for Hispanic percentage labels.  Values mirror the popup
   * options:
   *   'lt10' – show labels only for counties with Hispanic population
   *            percentages below 10%;
   *   'lt25' – below 25%;
   *   'lt50' – below 50%;
   *   'all'  – always show labels regardless of percentage.
   *
   * When undefined the content script will treat it as 'all'.
   */
  hispanicFilter: 'all'
};

// Track highlighted elements to avoid duplicates
const highlightedElements = new Set();

// Track the current state
let currentState = '';

// Track connection status with background script
let backgroundConnected = false;
let lastBackgroundContact = 0;
let autonomousMode = false;

// Track highlighting state for persistence
let lastHighlightTime = 0;
let highlightCount = 0;
let highlightingActive = false;
let domStateHash = '';
let recoveryAttempts = 0;

// Track force highlight requests
let forceHighlightRequested = false;
let lastForceHighlightTime = 0;

// Status indicator element
let statusIndicator = null;

// Debug logging function
function debugLog(message) {
  console.log(`[RUCC Highlighter] ${message}`);
}

// Mapping of Florida counties to geographic regions.  This map is derived
// from the uploaded CSV "Financial Calculators - FL regions.csv".  Keys are
// county names including the "County" suffix and values are one of
// "North", "Central" or "South".  The content script uses this to append
// labels to county names when the current page is for Florida.
const flCountyRegions = {
  "Alachua County": "North",
  "Baker County": "North",
  "Bay County": "North",
  "Bradford County": "North",
  "Brevard County": "Central",
  "Broward County": "South",
  "Calhoun County": "North",
  "Charlotte County": "South",
  "Citrus County": "Central",
  "Clay County": "North",
  "Collier County": "South",
  "Columbia County": "North",
  "Desoto County": "South",
  "Dixie County": "North",
  "Duval County": "North",
  "Escambia County": "North",
  "Flagler County": "Central",
  "Franklin County": "North",
  "Gadsden County": "North",
  "Gilchrist County": "North",
  "Glades County": "South",
  "Gulf County": "North",
  "Hamilton County": "North",
  "Hardee County": "South",
  "Hendry County": "South",
  "Hernando County": "Central",
  "Highlands County": "South",
  "Hillsborough County": "Central",
  "Holmes County": "North",
  "Indian River County": "South",
  "Jackson County": "North",
  "Jefferson County": "North",
  "Lafayette County": "North",
  "Lake County": "Central",
  "Lee County": "South",
  "Leon County": "North",
  "Levy County": "North",
  "Liberty County": "North",
  "Madison County": "North",
  "Manatee County": "South",
  "Marion County": "Central",
  "Martin County": "South",
  "Miami-Dade County": "South",
  "Monroe County": "South",
  "Nassau County": "North",
  "Okaloosa County": "North",
  "Okeechobee County": "South",
  "Orange County": "Central",
  "Osceola County": "Central",
  "Palm Beach County": "South",
  "Pasco County": "Central",
  "Pinellas County": "Central",
  "Polk County": "Central",
  "Putnam County": "Central",
  "St.Johns County": "Central",
  "St.Lucie County": "South",
  "Santa Rosa County": "North",
  "Sarasota County": "South",
  "Seminole County": "Central",
  "Sumter County": "Central",
  "Suwannee County": "North",
  "Taylor County": "North",
  "Union County": "North",
  "Volusia County": "Central",
  "Wakulla County": "North",
  "Walton County": "North",
  "Washington County": "North"
};

/**
 * Hispanic population data keyed by state code and county name.  Loaded
 * asynchronously from data/hispanic.csv.  The CSV is included as a
 * web‑accessible resource via the manifest.  Each entry maps
 * county names (including the "County" suffix) to a numeric
 * percentage of the population that identifies as Hispanic/Latino.
 */
let hispanicData = {};
let hispanicDataLoaded = false;
let hispanicDataLoading = null;

/**
 * Ensure styling for Hispanic percentage labels is injected.  Hispanic
 * labels are displayed via a CSS pseudo‑element on table cells with the
 * `data-hispanic` attribute.  This function inserts the required
 * styles once per page.
 */
function injectHispanicStyles() {
  if (document.getElementById('hispanic-label-styles')) return;
  const style = document.createElement('style');
  style.id = 'hispanic-label-styles';
  style.textContent = `
    /* Hispanic percentage label styling */
    td[data-hispanic] {
      position: relative !important;
    }
    td[data-hispanic]::after {
      content: attr(data-hispanic);
      margin-left: 5px;
      padding: 2px 4px;
      border-radius: 3px;
      font-size: 85%;
      font-weight: bold;
      /* Use a subtle purple palette to differentiate from region labels */
      background-color: #f3e5f5;
      color: #6a1b9a;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Load Hispanic percentage data from the CSV file packaged with the
 * extension.  Returns a promise that resolves when the data has been
 * parsed and stored in the hispanicData object.  Subsequent calls will
 * return the same promise to avoid duplicate loading.
 */
function loadHispanicData() {
  if (hispanicDataLoaded) return Promise.resolve();
  if (hispanicDataLoading) return hispanicDataLoading;
  const csvUrl = chrome.runtime.getURL('data/hispanic.csv');
  hispanicDataLoading = fetch(csvUrl)
    .then(resp => resp.text())
    .then(text => {
      // Parse CSV lines
      const lines = text.trim().split(/\r?\n/);
      // Expect header: State,County_Name,% hispanic
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        const parts = line.split(',');
        if (parts.length < 3) continue;
        const stateCode = parts[0].trim();
        const countyName = parts[1].trim();
        const percentStr = parts.slice(2).join(',').trim();
        const percent = parseFloat(percentStr);
        if (!isNaN(percent)) {
          if (!hispanicData[stateCode]) {
            hispanicData[stateCode] = {};
          }
          hispanicData[stateCode][countyName] = percent;
        }
      }
      hispanicDataLoaded = true;
    })
    .catch(err => {
      debugLog(`Error loading hispanic data: ${err.message}`);
    });
  return hispanicDataLoading;
}

/**
 * Get the Hispanic population percentage for a given state and county.  If
 * the data is not available or the data has not yet been loaded this
 * function returns null.  County names should include the "County"
 * suffix for a direct match; this function also tries a fuzzy match
 * without the suffix if necessary.  Percentages are stored as numbers
 * and returned as numbers (e.g. 12.34).  Caller can round as needed.
 */
function getHispanicPercent(stateCode, countyName) {
  if (!hispanicDataLoaded) return null;
  if (!stateCode || !countyName) return null;
  const stateData = hispanicData[stateCode];
  if (!stateData) return null;
  // Direct match
  if (stateData[countyName]) return stateData[countyName];
  // Try without " County" suffix
  if (countyName.endsWith(' County')) {
    const shortName = countyName.substring(0, countyName.length - 7);
    if (stateData[shortName]) return stateData[shortName];
  }
  // Fuzzy match: search for a key containing the countyName or vice versa
  for (const key in stateData) {
    if (key && (countyName.includes(key) || key.includes(countyName.replace(' County','')))) {
      return stateData[key];
    }
  }
  return null;
}

/**
 * Append Hispanic percentage labels to each county cell in the current
 * state table.  Labels are added based on the current hispanicFilter
 * setting.  This function will load the data if it is not already
 * available.  Existing labels are removed before applying new ones.  If
 * no county table is found or highlighting is disabled the function
 * returns without doing anything.
 */
function addHispanicLabels() {
  // If highlighting is disabled, skip adding labels
  if (!settings.enableHighlighting) return;
  // Ensure styles are injected
  injectHispanicStyles();
  // Ensure data is loaded
  loadHispanicData().then(() => {
    const countyTable = findCountyTable();
    if (!countyTable) return;
    const countyRows = findCountyRows(countyTable);
    const thresholdMap = { 'lt10': 10, 'lt25': 25, 'lt50': 50, 'all': Infinity };
    const filter = settings.hispanicFilter || 'all';
    const threshold = thresholdMap[filter] !== undefined ? thresholdMap[filter] : Infinity;
    const stateCode = getStateCode(currentState);
    countyRows.forEach(row => {
      const countyName = extractCountyName(row);
      if (!countyName) return;
      
	  
      const cell = row.querySelector('td:first-child');
      if (!cell) return;
      
      const percent = getHispanicPercent(stateCode, countyName);

      // If the percent is unavailable, ensure no stale label remains
      if (percent === null || percent === undefined) {
        if (cell.hasAttribute('data-hispanic')) {
          cell.removeAttribute('data-hispanic');
        }
        return;
      }
      
	  
      const shouldShow = threshold === Infinity || percent < threshold;
	  const labelValue = `${percent.toFixed(1)}%`;

      if (shouldShow) {
        // Only update the attribute if the value has changed to avoid
        // triggering unnecessary mutation events that can lead to
        // highlighting loops and page freezes.
        if (cell.getAttribute('data-hispanic') !== labelValue) {
          cell.setAttribute('data-hispanic', labelValue);
        }
      } else if (cell.hasAttribute('data-hispanic')) {
        cell.removeAttribute('data-hispanic');
      }
    });
  });
}

/**
 * Remove all Hispanic percentage labels from the current page.  This is
 * invoked when highlighting is disabled or when highlights are cleared.
 */
function removeHispanicLabels() {
  try {
    const cells = document.querySelectorAll('td[data-hispanic]');
    cells.forEach(cell => {
      cell.removeAttribute('data-hispanic');
    });
  } catch (error) {
    debugLog(`Error in removeHispanicLabels: ${error.message}`);
  }
}

/**
 * Ensure region label styles are available in the document.  Region labels are
 * small colored badges appended to county names indicating whether the county
 * is in the North, Central or South part of Florida.  Styles are injected
 * once per page to avoid duplication.
 */
function injectRegionStyles() {
  if (document.getElementById('fl-region-label-styles')) return;
  const style = document.createElement('style');
  style.id = 'fl-region-label-styles';
  style.textContent = `
    /* Region label styling: use a data attribute instead of modifying text */
    td[data-fl-region] {
      position: relative !important;
    }
    td[data-fl-region]::after {
      content: attr(data-fl-region);
      font-weight: bold;
      margin-left: 5px;
      padding: 2px 4px;
      border-radius: 3px;
      font-size: 90%;
    }
    td[data-fl-region="North"]::after {
      background-color: #e6f7ff;
      color: #007acc;
    }
    td[data-fl-region="Central"]::after {
      background-color: #fffbe6;
      color: #c79a00;
    }
    td[data-fl-region="South"]::after {
      background-color: #ffe6e6;
      color: #cc3300;
    }
  `;
  document.head.appendChild(style);
}

/**
 * Append region labels to Florida counties in the currently detected state table.
 * A region label is added only when the current page is displaying Florida data
 * and the user has selected that region in the popup.  Labels are appended to
 * the first cell of each county row.  Existing region labels are removed before
 * new ones are added to avoid duplication.
 */
function addRegionLabels() {
  try {
    // Determine which regions are enabled; default to all if undefined
    const selectedRegions = (settings.regionFilters && settings.regionFilters.length > 0)
      ? settings.regionFilters
      : ['North', 'Central', 'South'];
    // Only label counties when the current state is Florida
    const state = currentState || detectCurrentState();
    const stateCode = getStateCode(state);
    if (stateCode !== 'FL') {
      return;
    }
    // Inject styling for labels
    injectRegionStyles();
    const countyTable = findCountyTable();
    if (!countyTable) return;
    const countyRows = findCountyRows(countyTable);
    countyRows.forEach(row => {
      const countyName = extractCountyName(row);
      if (countyName && flCountyRegions[countyName]) {
        const region = flCountyRegions[countyName];
        const cells = row.querySelectorAll('td');
        if (cells.length === 0) return;
        const countyCell = cells[0];
        // Check any existing region labels (old span based implementation) and remove them
        const existing = countyCell.querySelectorAll('.fl-region-label');
        existing.forEach(el => el.remove());
        if (selectedRegions.includes(region)) {
          // Only set the attribute when it changes to avoid unnecessary mutations
          if (countyCell.getAttribute('data-fl-region') !== region) {
            countyCell.setAttribute('data-fl-region', region);
          }
        } else {
          // Only remove the attribute when it exists
          if (countyCell.hasAttribute('data-fl-region')) {
            countyCell.removeAttribute('data-fl-region');
          }
        }
      }
    });
  } catch (error) {
    debugLog(`Error in addRegionLabels: ${error.message}`);
  }
}

/**
 * Remove all region labels from the current page.  This is called when
 * highlights are removed or when settings are updated to ensure that labels
 * do not persist incorrectly.
 */
function removeRegionLabels() {
  try {
    // Remove any legacy span based labels
    const labels = document.querySelectorAll('.fl-region-label');
    labels.forEach(label => label.remove());
    // Also remove the data attribute used for region pseudo‑labels
    const regionCells = document.querySelectorAll('td[data-fl-region]');
    regionCells.forEach(cell => cell.removeAttribute('data-fl-region'));
  } catch (error) {
    debugLog(`Error in removeRegionLabels: ${error.message}`);
  }
}

// Initialize the content script
function initialize() {
  debugLog('Content script initializing');
  
  // Create status indicator
  createStatusIndicator();
  
  // Load any locally saved settings first
  loadLocalSettings().then(() => {
    // Then try to register with the background script
    registerWithBackgroundScript();
    
    // Set up mutation observer to detect DOM changes
    setupMutationObserver();
    
    // Set up targeted mutation observer for table elements
    setupTableMutationObserver();
    
    // Set up periodic check for new content (ultra-frequent)
    setInterval(checkForNewContent, 500);
    
    // Set up background connection check
    setInterval(checkBackgroundConnection, 5000);
    
    // Set up periodic forced rehighlighting (every 5 seconds - ultra aggressive)
    setInterval(forceRehighlight, 5000);
    
    // Set up highlight verification (every 3 seconds - ultra aggressive)
    setInterval(verifyHighlighting, 3000);
    
    // Set up DOM state verification (every 2 seconds)
    setInterval(verifyDomState, 2000);
    
    // Set up style reinforcement (every 10 seconds)
    setInterval(reinforceStyles, 10000);
    
    // Apply highlighting with current settings
    if (settings.enableHighlighting) {
      setTimeout(highlightCounties, 1000);
    }
    
    // Show initial status
    updateStatusIndicator('Initialized', 'active');
  });
}

// Create status indicator element
function createStatusIndicator() {
  if (statusIndicator) return;
  
  statusIndicator = document.createElement('div');
  statusIndicator.className = 'rucc-status-indicator';
  statusIndicator.id = 'rucc-status-indicator';
  statusIndicator.style.position = 'fixed';
  statusIndicator.style.bottom = '10px';
  statusIndicator.style.right = '10px';
  statusIndicator.style.backgroundColor = 'rgba(0, 0, 0, 0.7)';
  statusIndicator.style.color = 'white';
  statusIndicator.style.padding = '5px 10px';
  statusIndicator.style.borderRadius = '3px';
  statusIndicator.style.fontSize = '12px';
  statusIndicator.style.zIndex = '10000';
  statusIndicator.style.opacity = '0';
  statusIndicator.style.transition = 'opacity 0.3s';
  
  document.body.appendChild(statusIndicator);
}

// Update status indicator
function updateStatusIndicator(message, type = 'info', duration = 3000) {
  if (!statusIndicator) {
    createStatusIndicator();
  }
  
  statusIndicator.textContent = message;
  statusIndicator.className = 'rucc-status-indicator';
  
  if (type === 'active') {
    statusIndicator.style.backgroundColor = 'rgba(76, 175, 80, 0.9)';
  } else if (type === 'warning') {
    statusIndicator.style.backgroundColor = 'rgba(255, 152, 0, 0.9)';
  } else if (type === 'error') {
    statusIndicator.style.backgroundColor = 'rgba(244, 67, 54, 0.9)';
  } else if (type === 'highlight') {
    statusIndicator.style.backgroundColor = 'rgba(33, 150, 243, 0.9)';
  }
  
  statusIndicator.style.opacity = '1';
  
  setTimeout(() => {
    statusIndicator.style.opacity = '0';
  }, duration);
}

// Load settings from local storage
async function loadLocalSettings() {
  try {
    const localData = await chrome.storage.local.get('settings');
    if (localData.settings) {
      settings = localData.settings;
      debugLog('Loaded settings from local storage');
    } else {
      debugLog('No settings found in local storage, using defaults');
    }
  } catch (error) {
    debugLog(`Error loading local settings: ${error.message}`);
  }
}

// Save settings to local storage
async function saveLocalSettings() {
  try {
    await chrome.storage.local.set({settings: settings});
    debugLog('Saved settings to local storage');
  } catch (error) {
    debugLog(`Error saving local settings: ${error.message}`);
  }
}

// Register with the background script
function registerWithBackgroundScript() {
  try {
    chrome.runtime.sendMessage({action: 'contentScriptActive'}, function(response) {
      if (response && response.settings) {
        settings = response.settings;
        backgroundConnected = true;
        lastBackgroundContact = Date.now();
        autonomousMode = false;
        debugLog('Connected to background script and received settings');
        
        // Save settings locally for backup
        saveLocalSettings();
        
        // Apply highlighting with the received settings
        if (settings.enableHighlighting) {
          setTimeout(highlightCounties, 500);
        }
        
        updateStatusIndicator('Connected to service worker', 'active');
      } else {
        debugLog('No response from background script, entering autonomous mode');
        enterAutonomousMode();
      }
    });
  } catch (error) {
    debugLog(`Error registering with background script: ${error.message}`);
    enterAutonomousMode();
  }
}

// Enter autonomous mode when background script is unavailable
function enterAutonomousMode() {
  if (!autonomousMode) {
    autonomousMode = true;
    backgroundConnected = false;
    debugLog('Entering autonomous mode - will operate independently');
    
    // Apply highlighting with local settings
    if (settings.enableHighlighting) {
      highlightCounties();
    }
    
    updateStatusIndicator('Running in autonomous mode', 'warning', 5000);
  }
}

// Check connection with background script
function checkBackgroundConnection() {
  try {
    chrome.runtime.sendMessage({action: 'heartbeat'}, function(response) {
      if (response && response.active) {
        if (!backgroundConnected) {
          debugLog('Reconnected to background script');
          // We've reconnected, get latest settings
          chrome.runtime.sendMessage({action: 'getSettings'}, function(settingsResponse) {
            if (settingsResponse && settingsResponse.settings) {
              settings = settingsResponse.settings;
              debugLog('Received updated settings after reconnection');
              saveLocalSettings();
              
              // Apply highlighting with the updated settings
              if (settings.enableHighlighting) {
                removeAllHighlights();
                highlightCounties();
              }
              
              updateStatusIndicator('Reconnected to service worker', 'active');
            }
          });
        }
        
        backgroundConnected = true;
        lastBackgroundContact = Date.now();
        autonomousMode = false;
      } else {
        const timeSinceContact = (Date.now() - lastBackgroundContact) / 1000;
        if (backgroundConnected && timeSinceContact > 10) {
          debugLog(`Lost connection to background script (${timeSinceContact.toFixed(1)}s since last contact)`);
          enterAutonomousMode();
        }
      }
    });
  } catch (error) {
    debugLog(`Error checking background connection: ${error.message}`);
    enterAutonomousMode();
  }
}

// Set up mutation observer to detect DOM changes
function setupMutationObserver() {
  const observer = new MutationObserver(function(mutations) {
    if (settings.enableHighlighting) {
      // Wait a bit for the DOM to stabilize
      setTimeout(highlightCounties, 200);
    }
  });
  
  // Start observing the document body for DOM changes
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    characterData: true
  });
  
  debugLog('Mutation observer set up with enhanced monitoring');
}

// Set up targeted mutation observer specifically for table elements
function setupTableMutationObserver() {
  // Function to find and observe tables
  function findAndObserveTables() {
    const tables = document.querySelectorAll('table');
    tables.forEach(table => {
      if (!table.dataset.ruccObserved) {
        const tableObserver = new MutationObserver(function(mutations) {
          if (settings.enableHighlighting) {
            debugLog('Table mutation detected, rehighlighting');
            // Immediately rehighlight when table changes
            highlightCounties();
            updateStatusIndicator('Table updated, rehighlighting', 'info', 1500);
          }
        });
        
        // Observe the table for changes to its structure and attributes
        tableObserver.observe(table, {
          childList: true,
          subtree: true,
          attributes: true,
          characterData: true
        });
        
        // Mark the table as observed
        table.dataset.ruccObserved = 'true';
        debugLog('Table observer set up');
      }
    });
  }
  
  // Initial setup
  setTimeout(findAndObserveTables, 1000);
  
  // Periodically check for new tables (more frequently)
  setInterval(findAndObserveTables, 2000);
}

// Force rehighlight regardless of detected changes
function forceRehighlight() {
  if (settings.enableHighlighting) {
    const timeSinceLastHighlight = (Date.now() - lastHighlightTime) / 1000;
    debugLog(`Force rehighlight check (${timeSinceLastHighlight.toFixed(1)}s since last highlight)`);
    
    // If it's been more than 5 seconds since last highlight or force highlight was requested, force it
    if (timeSinceLastHighlight > 5 || forceHighlightRequested) {
      debugLog('Forcing rehighlight due to timeout or explicit request');
      removeAllHighlights();
      highlightCounties();
      
      if (forceHighlightRequested) {
        updateStatusIndicator('Force highlighting applied', 'highlight', 3000);
        forceHighlightRequested = false;
      }
    }
  }
}

// Verify highlighting is still active and recover if needed
function verifyHighlighting() {
  if (settings.enableHighlighting && highlightingActive) {
    const highlightedNow = document.querySelectorAll('.rucc-highlighted').length;
    
    // If we previously had highlights but now have none or fewer, try to recover
    if (highlightCount > 0 && highlightedNow < highlightCount) {
      debugLog(`Highlighting verification failed: Expected ${highlightCount} highlights, found ${highlightedNow}`);
      recoveryAttempts++;
      
      if (recoveryAttempts <= 3) {
        debugLog(`Attempting recovery (attempt ${recoveryAttempts})`);
        removeAllHighlights();
        highlightCounties();
        updateStatusIndicator(`Recovering highlights (${recoveryAttempts}/3)`, 'warning', 2000);
      } else if (recoveryAttempts === 4) {
        // More aggressive recovery - try to reinject styles
        debugLog('Attempting aggressive recovery - reinject styles');
        injectStyles();
        removeAllHighlights();
        highlightCounties();
        updateStatusIndicator('Aggressive highlight recovery', 'warning', 2000);
      } else {
        // Ultra aggressive recovery - force page elements to be highlighted
        debugLog('Attempting ultra aggressive recovery');
        forceElementHighlighting();
        updateStatusIndicator('Ultra aggressive recovery', 'warning', 2000);
        
        // Reset recovery counter but continue monitoring
        recoveryAttempts = 0;
      }
    } else {
      // Update our count and reset recovery attempts if everything looks good
      highlightCount = highlightedNow;
      if (highlightedNow > 0) {
        recoveryAttempts = 0;
      }
    }
  }
}

// Verify DOM state hasn't changed significantly
function verifyDomState() {
  if (settings.enableHighlighting) {
    const newDomState = generateDomStateHash();
    if (newDomState !== domStateHash && domStateHash !== '') {
      debugLog('DOM state changed significantly, rehighlighting');
      domStateHash = newDomState;
      removeAllHighlights();
      highlightCounties();
      updateStatusIndicator('DOM changed, rehighlighting', 'info', 1500);
    } else if (domStateHash === '') {
      domStateHash = newDomState;
    }
  }
}

// Force element highlighting with direct DOM manipulation
function forceElementHighlighting() {
  try {
    const countyTable = findCountyTable();
    if (!countyTable) return;
    
    const countyRows = findCountyRows(countyTable);
    debugLog(`Ultra aggressive recovery: Found ${countyRows.length} county rows`);
    
    countyRows.forEach(row => {
      const countyName = extractCountyName(row);
      if (countyName) {
        const ruccCode = findRuccCode(currentState, countyName);
        if (ruccCode && settings.ruccCodesToHighlight.includes(ruccCode)) {
          // Apply direct styling with !important flags
          applyDirectStyling(row, ruccCode);
        }
      }
    });
  } catch (error) {
    debugLog(`Error in forceElementHighlighting: ${error.message}`);
  }
}

// Apply direct styling to elements
function applyDirectStyling(element, ruccCode) {
  try {
    // Get color values based on settings
    const bgColors = {
      'yellow': 'rgba(255, 255, 0, 0.5)',
      'green': 'rgba(0, 255, 0, 0.5)',
      'blue': 'rgba(0, 0, 255, 0.3)'
    };
    
    const borderColors = {
      'yellow': 'rgba(255, 215, 0, 0.7)',
      'green': 'rgba(0, 128, 0, 0.7)',
      'blue': 'rgba(0, 0, 139, 0.7)'
    };
    
    const bgColor = bgColors[settings.highlightColor] || bgColors['yellow'];
    const borderColor = borderColors[settings.highlightColor] || borderColors['yellow'];
    
    // Apply direct styling to row
    element.style.setProperty('background-color', bgColor, 'important');
    element.style.setProperty('border', `2px solid ${borderColor}`, 'important');
    element.style.setProperty('box-shadow', '0 0 5px rgba(0, 0, 0, 0.2)', 'important');
    element.style.setProperty('position', 'relative', 'important');
    element.style.setProperty('z-index', '1', 'important');
    
    // Apply styling to all cells in the row
    const cells = element.querySelectorAll('td');
    cells.forEach(cell => {
      cell.style.setProperty('background-color', bgColor, 'important');
    });
    
    // Add RUCC code next to county name in the first cell
    if (cells.length > 0) {
      const countyCell = cells[0];
      const countyName = countyCell.textContent.trim();
      
      // Check if RUCC code is already displayed
      if (!countyCell.textContent.includes('[RUCC:')) {
        countyCell.innerHTML = `${countyName} <span style="font-weight: bold !important; color: #d32f2f !important; margin-left: 5px !important;">[RUCC: ${ruccCode}]</span>`;
      }
    }
    
    // Force a repaint
    void element.offsetHeight;
  } catch (error) {
    debugLog(`Error in applyDirectStyling: ${error.message}`);
  }
}

// Reinforce styles by reinjecting them
function reinforceStyles() {
  if (settings.enableHighlighting) {
    injectStyles();
    
    // Also check if we need to reapply highlighting
    const highlightedElements = document.querySelectorAll('.rucc-highlighted');
    if (highlightedElements.length < highlightCount && highlightCount > 0) {
      debugLog('Style reinforcement detected missing highlights, reapplying');
      removeAllHighlights();
      highlightCounties();
    }
  }
}

// Inject styles directly to ensure they're always available
function injectStyles() {
  try {
    // Remove any existing injected styles
    const existingStyle = document.getElementById('rucc-injected-styles');
    if (existingStyle) {
      existingStyle.remove();
    }
    
    // Create new style element
    const style = document.createElement('style');
    style.id = 'rucc-injected-styles';
    style.textContent = `
      /* Highlighted row styles with high specificity */
      tr.rucc-highlighted,
      table tr.rucc-highlighted,
      .table tr.rucc-highlighted,
      div table tr.rucc-highlighted,
      #content table tr.rucc-highlighted,
      [class*="table"] tr.rucc-highlighted,
      *[class] tr.rucc-highlighted,
      body tr.rucc-highlighted {
        background-color: rgba(255, 255, 0, 0.5) !important;
        border: 2px solid rgba(255, 215, 0, 0.7) !important;
        box-shadow: 0 0 5px rgba(0, 0, 0, 0.2) !important;
        position: relative !important;
        z-index: 1 !important;
      }
      
      /* Highlighted cell styles with high specificity */
      tr.rucc-highlighted td,
      table tr.rucc-highlighted td,
      .table tr.rucc-highlighted td,
      div table tr.rucc-highlighted td,
      #content table tr.rucc-highlighted td,
      [class*="table"] tr.rucc-highlighted td,
      *[class] tr.rucc-highlighted td,
      body tr.rucc-highlighted td {
        background-color: rgba(255, 255, 0, 0.5) !important;
      }
      
      /* Yellow highlight variant */
      tr.rucc-highlighted.yellow,
      table tr.rucc-highlighted.yellow,
      .table tr.rucc-highlighted.yellow,
      div table tr.rucc-highlighted.yellow,
      #content table tr.rucc-highlighted.yellow,
      [class*="table"] tr.rucc-highlighted.yellow,
      *[class] tr.rucc-highlighted.yellow,
      body tr.rucc-highlighted.yellow {
        background-color: rgba(255, 255, 0, 0.5) !important;
        border: 2px solid rgba(255, 215, 0, 0.7) !important;
      }
      
      tr.rucc-highlighted.yellow td,
      table tr.rucc-highlighted.yellow td,
      .table tr.rucc-highlighted.yellow td,
      div table tr.rucc-highlighted.yellow td,
      #content table tr.rucc-highlighted.yellow td,
      [class*="table"] tr.rucc-highlighted.yellow td,
      *[class] tr.rucc-highlighted.yellow td,
      body tr.rucc-highlighted.yellow td {
        background-color: rgba(255, 255, 0, 0.5) !important;
      }
      
      /* Green highlight variant */
      tr.rucc-highlighted.green,
      table tr.rucc-highlighted.green,
      .table tr.rucc-highlighted.green,
      div table tr.rucc-highlighted.green,
      #content table tr.rucc-highlighted.green,
      [class*="table"] tr.rucc-highlighted.green,
      *[class] tr.rucc-highlighted.green,
      body tr.rucc-highlighted.green {
        background-color: rgba(0, 255, 0, 0.5) !important;
        border: 2px solid rgba(0, 128, 0, 0.7) !important;
      }
      
      tr.rucc-highlighted.green td,
      table tr.rucc-highlighted.green td,
      .table tr.rucc-highlighted.green td,
      div table tr.rucc-highlighted.green td,
      #content table tr.rucc-highlighted.green td,
      [class*="table"] tr.rucc-highlighted.green td,
      *[class] tr.rucc-highlighted.green td,
      body tr.rucc-highlighted.green td {
        background-color: rgba(0, 255, 0, 0.5) !important;
      }
      
      /* Blue highlight variant */
      tr.rucc-highlighted.blue,
      table tr.rucc-highlighted.blue,
      .table tr.rucc-highlighted.blue,
      div table tr.rucc-highlighted.blue,
      #content table tr.rucc-highlighted.blue,
      [class*="table"] tr.rucc-highlighted.blue,
      *[class] tr.rucc-highlighted.blue,
      body tr.rucc-highlighted.blue {
        background-color: rgba(0, 0, 255, 0.3) !important;
        border: 2px solid rgba(0, 0, 139, 0.7) !important;
      }
      
      tr.rucc-highlighted.blue td,
      table tr.rucc-highlighted.blue td,
      .table tr.rucc-highlighted.blue td,
      div table tr.rucc-highlighted.blue td,
      #content table tr.rucc-highlighted.blue td,
      [class*="table"] tr.rucc-highlighted.blue td,
      *[class] tr.rucc-highlighted.blue td,
      body tr.rucc-highlighted.blue td {
        background-color: rgba(0, 0, 255, 0.3) !important;
      }
      
      /* RUCC code display styling */
      .rucc-code {
        font-weight: bold !important;
        color: #d32f2f !important;
        margin-left: 5px !important;
        display: inline-block !important;
      }
      
      /* Tooltip for RUCC information */
      tr.rucc-highlighted[data-rucc]:hover::after {
        content: attr(data-rucc);
        position: absolute;
        left: 0;
        top: -30px;
        background: rgba(0, 0, 0, 0.8);
        color: white;
        padding: 5px 10px;
        border-radius: 3px;
        font-size: 12px;
        z-index: 1000;
      }
      
      /* Status indicator for autonomous mode */
      .rucc-status-indicator {
        position: fixed;
        bottom: 10px;
        right: 10px;
        background-color: rgba(0, 0, 0, 0.7);
        color: white;
        padding: 5px 10px;
        border-radius: 3px;
        font-size: 12px;
        z-index: 10000;
        opacity: 0;
        transition: opacity 0.3s;
      }
      
      .rucc-status-indicator.visible {
        opacity: 1;
      }
      
      /* Ensure highlighting persists even with website's CSS */
      @keyframes rucc-highlight-persist {
        0% { opacity: 0.99; }
        100% { opacity: 1; }
      }
      
      tr.rucc-highlighted {
        animation: rucc-highlight-persist 1s infinite alternate;
        transform: translateZ(0);
        will-change: opacity;
      }
    `;
    
    // Add to document
    document.head.appendChild(style);
    debugLog('Styles injected directly into page');
  } catch (error) {
    debugLog(`Error injecting styles: ${error.message}`);
  }
}

// Periodically check for new content
function checkForNewContent() {
  if (settings.enableHighlighting) {
    // Check if the state has changed
    const newState = detectCurrentState();
    if (newState !== currentState) {
      debugLog(`State changed from ${currentState} to ${newState}`);
      currentState = newState;
      
      // Clear existing highlights when state changes
      removeAllHighlights();
      
      // Apply new highlights
      highlightCounties();
      
      updateStatusIndicator(`State changed to ${newState}`, 'info', 2000);
    } else {
      // Check if DOM has changed significantly
      const newDomState = generateDomStateHash();
      if (newDomState !== domStateHash) {
        debugLog('DOM state changed, rehighlighting');
        domStateHash = newDomState;
        highlightCounties();
      } else {
        // Still check for missing highlights
        verifyHighlightingIntegrity();
      }
    }
  }
}

// Generate a simple hash of the DOM state for change detection
function generateDomStateHash() {
  try {
    const countyTable = findCountyTable();
    if (!countyTable) return 'no-table';
    
    // Get a representation of the table structure
    const rows = countyTable.querySelectorAll('tbody tr');
    const rowCount = rows.length;
    const firstRowText = rows.length > 0 ? rows[0].textContent.trim() : '';
    const lastRowText = rows.length > 0 ? rows[rows.length - 1].textContent.trim() : '';
    
    // Include more elements in the hash for better detection
    const tableClasses = countyTable.className;
    const tableId = countyTable.id;
    const tableParentId = countyTable.parentElement ? countyTable.parentElement.id : '';
    
    // Create a more comprehensive hash
    return `rows:${rowCount}|first:${firstRowText.substring(0, 20)}|last:${lastRowText.substring(0, 20)}|classes:${tableClasses}|id:${tableId}|parentId:${tableParentId}`;
  } catch (error) {
    debugLog(`Error generating DOM state hash: ${error.message}`);
    return 'error';
  }
}

// Verify highlighting integrity - check if any rows lost their highlighting
function verifyHighlightingIntegrity() {
  try {
    if (!settings.enableHighlighting) return;
    
    const countyTable = findCountyTable();
    if (!countyTable) return;
    
    const countyRows = findCountyRows(countyTable);
    let missingHighlights = 0;
    
    countyRows.forEach(row => {
      const countyName = extractCountyName(row);
      if (countyName) {
        const ruccCode = findRuccCode(currentState, countyName);
        if (ruccCode && settings.ruccCodesToHighlight.includes(ruccCode)) {
          // This row should be highlighted - check if it is
          if (!row.classList.contains('rucc-highlighted')) {
            missingHighlights++;
            // Highlight this specific row
            highlightElement(row, ruccCode);
          }
        }
      }
    });
    
    if (missingHighlights > 0) {
      debugLog(`Restored highlighting for ${missingHighlights} rows that lost it`);
      updateStatusIndicator(`Restored ${missingHighlights} highlights`, 'info', 1500);
    }
  } catch (error) {
    debugLog(`Error in verifyHighlightingIntegrity: ${error.message}`);
  }
}

// Detect the current state from the page
function detectCurrentState() {
  try {
    // Try to find state from dropdown
    const stateDropdown = document.querySelector('button.btn.dropdown-toggle');
    if (stateDropdown && stateDropdown.textContent) {
      const stateText = stateDropdown.textContent.trim();
      if (stateText.length > 0 && stateText !== 'SVG Map') {
        return stateText.split('-')[0].trim();
      }
    }
    
    // Try to find state from page title or other elements
    const pageTitle = document.title;
    if (pageTitle && pageTitle.includes(' - ')) {
      const statePart = pageTitle.split(' - ')[0].trim();
      if (statePart.length > 0) {
        return statePart;
      }
    }
    
    // Try to find state from URL parameters
    const urlParams = new URLSearchParams(window.location.search);
    const stateParam = urlParams.get('state');
    if (stateParam) {
      return stateParam;
    }
    
    // Try to find state from any visible text that looks like a state name
    const pageText = document.body.innerText;
    const stateNames = [
      'Alabama', 'Alaska', 'Arizona', 'Arkansas', 'California', 'Colorado', 'Connecticut', 
      'Delaware', 'Florida', 'Georgia', 'Hawaii', 'Idaho', 'Illinois', 'Indiana', 'Iowa', 
      'Kansas', 'Kentucky', 'Louisiana', 'Maine', 'Maryland', 'Massachusetts', 'Michigan', 
      'Minnesota', 'Mississippi', 'Missouri', 'Montana', 'Nebraska', 'Nevada', 'New Hampshire', 
      'New Jersey', 'New Mexico', 'New York', 'North Carolina', 'North Dakota', 'Ohio', 
      'Oklahoma', 'Oregon', 'Pennsylvania', 'Rhode Island', 'South Carolina', 'South Dakota', 
      'Tennessee', 'Texas', 'Utah', 'Vermont', 'Virginia', 'Washington', 'West Virginia', 
      'Wisconsin', 'Wyoming', 'District of Columbia'
    ];
    
    for (const state of stateNames) {
      if (pageText.includes(state)) {
        return state;
      }
    }
    
    // Default to empty if we can't detect
    return '';
  } catch (error) {
    debugLog(`Error detecting state: ${error.message}`);
    return '';
  }
}

// Highlight counties based on their RUCC codes
function highlightCounties() {
  try {
    if (!settings.enableHighlighting) {
      debugLog('Highlighting is disabled');
      return;
    }
    
    debugLog('Highlighting counties');
    lastHighlightTime = Date.now();
    
    // Ensure styles are injected
    injectStyles();
    
    // Detect the current state
    const state = detectCurrentState();
    currentState = state;
    
    debugLog(`Current state: ${state}`);
    
    // Find the county table
    const countyTable = findCountyTable();
    if (!countyTable) {
      debugLog('County table not found');
      return;
    }
    
    // Find all county rows in the table
    const countyRows = findCountyRows(countyTable);
    debugLog(`Found ${countyRows.length} county rows`);
    
    // Highlight matching counties
    let highlightCount = 0;
    
    countyRows.forEach(row => {
      const countyName = extractCountyName(row);
      if (countyName) {
        const ruccCode = findRuccCode(state, countyName);
        if (ruccCode && settings.ruccCodesToHighlight.includes(ruccCode)) {
          highlightElement(row, ruccCode);
          highlightCount++;
        }
      }
    });
    
    // Update highlighting state
    highlightingActive = highlightCount > 0;
    this.highlightCount = highlightCount;
    
    // Update DOM state hash
    domStateHash = generateDomStateHash();
    
    debugLog(`Highlighted ${highlightCount} counties`);
    
    // Show status if this was a force highlight request
    if (forceHighlightRequested) {
      updateStatusIndicator(`Highlighted ${highlightCount} counties`, 'highlight', 3000);
      forceHighlightRequested = false;
    }

    // After highlighting RUCC codes, append region labels to Florida counties.
    // This call is safe for non‑Florida pages; it will return immediately
    // if the detected state is not Florida or no regions are selected.
    addRegionLabels();

    // Append Hispanic percentage labels based on the selected filter.  This
    // operates across all states and will load the data if necessary.  It
    // runs after region labels to ensure it does not interfere with their
    // insertion.
    addHispanicLabels();
  } catch (error) {
    debugLog(`Error in highlightCounties: ${error.message}`);
  }
}

// Find the county table in the page
function findCountyTable() {
  try {
    // Look for tables with specific headers or structure
    const tables = document.querySelectorAll('table');
    
    for (const table of tables) {
      // Check if this table has county-related headers
      const headers = table.querySelectorAll('th');
      for (const header of headers) {
        const headerText = header.textContent.trim().toLowerCase();
        if (headerText.includes('county') || headerText.includes('state') || headerText === 'dm-a' || headerText === 'cl-a') {
          return table;
        }
      }
      
      // Check if this table has county names in the first column
      const firstCells = table.querySelectorAll('td:first-child');
      for (const cell of firstCells) {
        const cellText = cell.textContent.trim();
        if (cellText.includes('County') || cellText.endsWith('County')) {
          return table;
        }
      }
    }
    
    // If no specific county table found, look for any table with many rows
    for (const table of tables) {
      const rows = table.querySelectorAll('tbody tr');
      if (rows.length > 10) {
        return table;
      }
    }
    
    return null;
  } catch (error) {
    debugLog(`Error finding county table: ${error.message}`);
    return null;
  }
}

// Find county rows in a table
function findCountyRows(table) {
  try {
    const rows = table.querySelectorAll('tbody tr');
    return Array.from(rows).filter(row => {
      const firstCell = row.querySelector('td:first-child');
      return firstCell && firstCell.textContent.trim().length > 0;
    });
  } catch (error) {
    debugLog(`Error finding county rows: ${error.message}`);
    return [];
  }
}

// Extract county name from a table row
function extractCountyName(row) {
  try {
    const firstCell = row.querySelector('td:first-child');
    if (!firstCell) return null;
    
    let countyText = firstCell.textContent.trim();

    // Remove any existing RUCC code display
    if (countyText.includes('[RUCC:')) {
      countyText = countyText.split('[RUCC:')[0].trim();
    }

    // Remove region labels appended by this extension (North, Central or South)
    // Region labels are appended after the county name separated by a space. If
    // present, strip the region from the end of the string. Use a regular
    // expression to handle optional trailing whitespace and ignore case so that
    // "north" or other case variations are also removed. This ensures the
    // original county name is recovered for lookup.
    countyText = countyText.replace(/\s+(North|Central|South)\s*$/i, '');

    // Check if it ends with "County" after cleaning
    if (!countyText.endsWith('County')) {
      countyText += ' County';
    }

    return countyText;
  } catch (error) {
    debugLog(`Error extracting county name: ${error.message}`);
    return null;
  }
}

// Find RUCC code for a county in a state
function findRuccCode(state, countyName) {
  try {
    // Check if we have county data
    if (typeof countyData === 'undefined') {
      debugLog('County data not available');
      return null;
    }
    
    // Convert state name to state code if needed
    const stateCode = getStateCode(state);
    if (!stateCode) {
      debugLog(`Could not determine state code for: ${state}`);
      return null;
    }
    
    // Look up the county in the data
    if (countyData[stateCode] && countyData[stateCode][countyName]) {
      return countyData[stateCode][countyName];
    }
    
    // Try without "County" suffix
    if (countyName.endsWith(' County')) {
      const shortName = countyName.substring(0, countyName.length - 7);
      if (countyData[stateCode] && countyData[stateCode][shortName]) {
        return countyData[stateCode][shortName];
      }
    }
    
    // Try with fuzzy matching
    if (countyData[stateCode]) {
      for (const dataCountyName in countyData[stateCode]) {
        if (countyName.includes(dataCountyName) || dataCountyName.includes(countyName.replace(' County', ''))) {
          return countyData[stateCode][dataCountyName];
        }
      }
    }
    
    debugLog(`RUCC code not found for ${countyName} in ${stateCode}`);
    return null;
  } catch (error) {
    debugLog(`Error finding RUCC code: ${error.message}`);
    return null;
  }
}

// Convert state name to state code
function getStateCode(stateName) {
  const stateMap = {
    'Alabama': 'AL',
    'Alaska': 'AK',
    'Arizona': 'AZ',
    'Arkansas': 'AR',
    'California': 'CA',
    'Colorado': 'CO',
    'Connecticut': 'CT',
    'Delaware': 'DE',
    'Florida': 'FL',
    'Georgia': 'GA',
    'Hawaii': 'HI',
    'Idaho': 'ID',
    'Illinois': 'IL',
    'Indiana': 'IN',
    'Iowa': 'IA',
    'Kansas': 'KS',
    'Kentucky': 'KY',
    'Louisiana': 'LA',
    'Maine': 'ME',
    'Maryland': 'MD',
    'Massachusetts': 'MA',
    'Michigan': 'MI',
    'Minnesota': 'MN',
    'Mississippi': 'MS',
    'Missouri': 'MO',
    'Montana': 'MT',
    'Nebraska': 'NE',
    'Nevada': 'NV',
    'New Hampshire': 'NH',
    'New Jersey': 'NJ',
    'New Mexico': 'NM',
    'New York': 'NY',
    'North Carolina': 'NC',
    'North Dakota': 'ND',
    'Ohio': 'OH',
    'Oklahoma': 'OK',
    'Oregon': 'OR',
    'Pennsylvania': 'PA',
    'Rhode Island': 'RI',
    'South Carolina': 'SC',
    'South Dakota': 'SD',
    'Tennessee': 'TN',
    'Texas': 'TX',
    'Utah': 'UT',
    'Vermont': 'VT',
    'Virginia': 'VA',
    'Washington': 'WA',
    'West Virginia': 'WV',
    'Wisconsin': 'WI',
    'Wyoming': 'WY',
    'District of Columbia': 'DC'
  };
  
  // Direct match
  if (stateMap[stateName]) {
    return stateMap[stateName];
  }
  
  // Check if it's already a state code
  if (Object.values(stateMap).includes(stateName)) {
    return stateName;
  }
  
  // Check for partial matches
  for (const [name, code] of Object.entries(stateMap)) {
    if (stateName.includes(name) || name.includes(stateName)) {
      return code;
    }
  }
  
  return null;
}

// Apply highlighting to an element
function highlightElement(element, ruccCode) {
  try {
    // Skip if already highlighted
    if (highlightedElements.has(element)) {
      return;
    }
    
    debugLog(`Highlighting element for RUCC code ${ruccCode}`);
    
    // Add the highlight class
    element.classList.add('rucc-highlighted');
    
    // Add the color class based on settings
    element.classList.remove('yellow', 'green', 'blue');
    element.classList.add(settings.highlightColor);
    
    // Set the RUCC code as a data attribute for the tooltip
    element.setAttribute('data-rucc', `RUCC: ${ruccCode}`);
    
    // Apply direct styling to ensure it works (with !important)
    const bgColors = {
      'yellow': 'rgba(255, 255, 0, 0.5)',
      'green': 'rgba(0, 255, 0, 0.5)',
      'blue': 'rgba(0, 0, 255, 0.3)'
    };
    
    const borderColors = {
      'yellow': 'rgba(255, 215, 0, 0.7)',
      'green': 'rgba(0, 128, 0, 0.7)',
      'blue': 'rgba(0, 0, 139, 0.7)'
    };
    
    const bgColor = bgColors[settings.highlightColor] || bgColors['yellow'];
    const borderColor = borderColors[settings.highlightColor] || borderColors['yellow'];
    
    element.style.setProperty('background-color', bgColor, 'important');
    element.style.setProperty('border', `2px solid ${borderColor}`, 'important');
    element.style.setProperty('box-shadow', '0 0 5px rgba(0, 0, 0, 0.2)', 'important');
    element.style.setProperty('position', 'relative', 'important');
    element.style.setProperty('z-index', '1', 'important');
    
    // Apply styling to all cells in the row if it's a table row
    if (element.tagName === 'TR') {
      const cells = element.querySelectorAll('td');
      cells.forEach(cell => {
        // Add a class to cells for better CSS targeting
        cell.classList.add('rucc-highlighted-cell');
        // Apply direct styling with !important
        cell.style.setProperty('background-color', bgColor, 'important');
      });
      
      // Add RUCC code next to county name in the first cell
      if (cells.length > 0) {
        const countyCell = cells[0];
        const countyName = countyCell.textContent.trim();
        
        // Check if RUCC code is already displayed
        if (!countyCell.textContent.includes('[RUCC:')) {
          countyCell.innerHTML = `${countyName} <span class="rucc-code" style="font-weight: bold !important; color: #d32f2f !important; margin-left: 5px !important;">[RUCC: ${ruccCode}]</span>`;
        }
      }
    }
    
    // Add to the set of highlighted elements
    highlightedElements.add(element);
    
    // Force a repaint to ensure styles are applied
    void element.offsetHeight;
  } catch (error) {
    debugLog(`Error in highlightElement: ${error.message}`);
  }
}

// Remove all highlights
function removeAllHighlights() {
  try {
    const highlightedElements = document.querySelectorAll('.rucc-highlighted');
    debugLog(`Removing highlights from ${highlightedElements.length} elements`);
    
    highlightedElements.forEach(element => {
      element.classList.remove('rucc-highlighted');
      element.classList.remove('yellow', 'green', 'blue');
      element.removeAttribute('data-rucc');
      element.style.removeProperty('background-color');
      element.style.removeProperty('border');
      element.style.removeProperty('box-shadow');
      element.style.removeProperty('position');
      element.style.removeProperty('z-index');
      
      // Remove styling from cells if it's a table row
      if (element.tagName === 'TR') {
        const cells = element.querySelectorAll('td');
        cells.forEach(cell => {
          cell.classList.remove('rucc-highlighted-cell');
          cell.style.removeProperty('background-color');
        });
        
        // Remove RUCC code from county name in the first cell
        if (cells.length > 0) {
          const countyCell = cells[0];
          const countyText = countyCell.textContent;
          
          // Check if RUCC code is displayed
          if (countyText.includes('[RUCC:')) {
            const originalName = countyText.split('[RUCC:')[0].trim();
            countyCell.textContent = originalName;
          }
        }
      }
    });

    // Also remove any region labels that may have been added to county names.
    removeRegionLabels();

    // Remove any Hispanic percentage labels that may have been added.  This
    // ensures that no stale labels persist when highlights are cleared.
    removeHispanicLabels();
    
    // Clear the set of highlighted elements
    highlightedElements.clear();
  } catch (error) {
    debugLog(`Error in removeAllHighlights: ${error.message}`);
  }
}

// Listen for messages from the background script
chrome.runtime.onMessage.addListener(function(message, sender, sendResponse) {
  debugLog(`Received message: ${JSON.stringify(message)}`);
  
  // Update connection status
  backgroundConnected = true;
  lastBackgroundContact = Date.now();
  autonomousMode = false;
  
  if (message.action === 'updateSettings') {
    settings = message.settings;
    debugLog('Updated settings from background script');
    
    // Save settings locally for backup
    saveLocalSettings();
    
    // Apply or remove highlighting based on the new settings
    if (settings.enableHighlighting) {
      // First remove all highlights to ensure color changes are applied
      removeAllHighlights();
      highlightCounties();
      updateStatusIndicator('Settings updated', 'active', 2000);
    } else {
      // When highlighting is disabled we still want to control region labels.  First
      // remove any existing highlights and region labels, then append labels
      // according to the current settings.  addRegionLabels() will only add
      // labels on Florida pages and will respect the selected regionFilters.
      removeAllHighlights();
      // Append region labels when appropriate
      addRegionLabels();
      updateStatusIndicator('Highlighting disabled', 'info', 2000);
    }
    
    sendResponse({success: true});
  }
  else if (message.action === 'forceHighlight') {
    debugLog('Force highlighting requested');
    
    // Set the force highlight flag
    forceHighlightRequested = true;
    lastForceHighlightTime = Date.now();
    
    // Force highlighting regardless of current state
    removeAllHighlights();
    highlightCounties();
    
    // Show visual feedback
    updateStatusIndicator('Force highlighting applied', 'highlight', 3000);
    
    sendResponse({success: true});
  }
  else if (message.action === 'heartbeat') {
    // Respond to heartbeat to confirm content script is active
    debugLog(`Received heartbeat from ${message.source || 'background'}`);
    sendResponse({
      active: true, 
      autonomousMode: autonomousMode,
      highlightCount: highlightCount,
      lastHighlightTime: lastHighlightTime
    });
  }
  
  // Return true to indicate we'll send a response asynchronously
  return true;
});

// Initialize the content script
initialize();