
// TODO: Add a feature that lets you highlight certain words in the terminal.

// GateOne.Terminal gets its own sandbox to avoid a constant barrage of circular references on the garbage collector
(function(window, undefined) {
"use strict";

// Sandbox-wide shortcuts
var go = GateOne,
    prefix = go.prefs.prefix,
    u = go.Utils,
    v = go.Visual,
    E = go.Events,
    urlObj = (window.URL || window.webkitURL),
    logFatal = GateOne.Logging.logFatal,
    logError = GateOne.Logging.logError,
    logWarning = GateOne.Logging.logWarning,
    logInfo = GateOne.Logging.logInfo,
    logDebug = GateOne.Logging.logDebug;

// Setup some defaults for our terminal-specific prefs
go.prefs['webWorker'] = null; // This is the fallback path to the Terminal's screen processing Web Worker (term_ww.js).  You should only ever have to change this when embedding and your Gate One server is listening on a different port than your app's web server.  In such situations you'd want to copy term_ww.js to some location on your server and set this variable to that path (e.g. 'https://your-app.company.com/static/term_ww.js').
go.prefs['scrollback'] = 500, // Amount of lines to keep in the scrollback buffer
go.prefs['rows'] =  null; // Override the automatically calculated value (null means fill the window)
go.prefs['cols'] =  null; // Ditto
go.prefs['colors'] = 'default'; // The color scheme to use (e.g. 'default', 'gnome-terminal', etc)
go.prefs['disableTermTransitions'] = false; // Disabled the sliding animation on terminals to make switching faster
go.prefs['rowAdjust'] = 0;   // When the terminal rows are calculated they will be decreased by this amount (e.g. to make room for the playback controls).
                            // rowAdjust is necessary so that plugins can increment it if they're adding things to the top or bottom of GateOne.
go.prefs['colAdjust'] = 0;  // Just like rowAdjust but it controls how many columns are removed from the calculated terminal dimensions before they're sent to the server.
// This ensures that the webWorker setting isn't stored in the user's prefs in localStorage:
go.noSavePrefs['webWorker'] = null;
go.noSavePrefs['rowAdjust'] = null;
go.noSavePrefs['colAdjust'] = null;

go.Base.module(GateOne, "Terminal", "1.2", ['Base', 'Utils', 'Visual']);
GateOne.Terminal.terminals = { // For keeping track of running terminals
    count: function() { // A useful function (terminals can be differentiated because they'll always be integers)
        // Returns the number of open terminals
        var counter = 0;
        for (var term in GateOne.Terminal.terminals) {
            if (term % 1 === 0) {
                counter += 1;
            }
        }
        return counter;
    }
}
// These two variables are semi-constants that are used in determining the size of terminals.  They make room for...
go.Terminal.colAdjust = 3; // The scrollbar (3 chars of width is usually enough)
go.Terminal.rowAdjust = 1; // The row that gets cut off at the top of the terminal by the browser (when doing our row/cols calculation)
// All updateTermCallbacks are executed whenever a terminal is updated like so: callback(<term number>)
// Plugins can register updateTermCallbacks by simply doing a push():  GateOne.Terminal.updateTermCallbacks.push(myFunc);
go.Terminal.updateTermCallbacks = []; // DEPRECATED
// All defined newTermCallbacks are executed whenever a new terminal is created like so: callback(<term number>)
go.Terminal.newTermCallbacks = []; // DEPRECATED
// All defined closeTermCallbacks are executed whenever a terminal is closed just like newTermCallbacks:  callback(<term number>)
go.Terminal.closeTermCallbacks = []; // DEPRECATED
// All defined reattachTerminalsCallbacks are executed whenever the reattachTerminalsAction is called.  It is important to register a callback here when in embedded mode (if you want to place terminals in a specific location).
go.Terminal.reattachTerminalsCallbacks = []; // DEPRECATED
go.Terminal.scrollbackToggle = false;
go.Terminal.textTransforms = {}; // Can be used to transform text (e.g. into clickable links).  Use registerTextTransform() to add new ones.
go.Terminal.lastTermNumber = 0; // Starts at 0 since newTerminal() increments it by 1
go.Terminal.manualTitle = false; // If a user overrides the title this variable will be used to keep track of that so setTitleAction won't overwrite it
go.Terminal.scrollbarWidth = null; // Used to keep track of the scrollbar width so we can adjust the toolbar appropriately.  It is saved here since we have to measure the inside of a terminal to get this value reliably.
go.Base.update(GateOne.Terminal, {
    init: function() {
        logDebug("Terminal.init()");
        var t = go.Terminal,
            term = localStorage[prefix+'selectedTerminal'],
            div = u.createElement('div', {'id': 'info_actions', 'style': {'padding-bottom': '0.4em'}}),
            tableDiv = u.createElement('div', {'class': 'paneltable', 'style': {'display': 'table', 'padding': '0.5em'}}),
            tableDiv2 = u.createElement('div', {'class': 'paneltable', 'style': {'display': 'table', 'padding': '0.5em'}}),
            toolbarClose = u.createElement('div', {'id': 'icon_closeterm', 'class': 'toolbar', 'title': "Close This Terminal"}),
            toolbarNewTerm = u.createElement('div', {'id': 'icon_newterm', 'class': 'toolbar', 'title': "New Terminal"}),
            toolbarInfo = u.createElement('div', {'id': 'icon_info', 'class': 'toolbar', 'title': "Terminal Application Panel"}),
            infoPanel = u.createElement('div', {'id': 'panel_info', 'class': 'panel'}),
            panelClose = u.createElement('div', {'id': 'icon_closepanel', 'class': 'panel_close_icon', 'title': "Close This Panel"}),
            infoPanelRow1 = u.createElement('div', {'class': 'paneltablerow', 'id': 'panel_inforow1'}),
            infoPanelRow2 = u.createElement('div', {'class': 'paneltablerow', 'id': 'panel_inforow2'}),
            infoPanelRow3 = u.createElement('div', {'class': 'paneltablerow', 'id': 'panel_inforow3'}),
            infoPanelRow4 = u.createElement('div', {'class': 'paneltablerow', 'id': 'panel_inforow4'}),
            infoPanelRow5 = u.createElement('div', {'class': 'paneltablerow', 'id': 'panel_inforow5'}),
            infoPanelRow6 = u.createElement('div', {'class': 'paneltablerow', 'id': 'panel_inforow5'}),
            infoPanelH2 = u.createElement('h2', {'id': 'termtitle'}),
            infoPanelTimeLabel = u.createElement('span', {'id': 'term_time_label', 'style': {'display': 'table-cell'}}),
            infoPanelTime = u.createElement('span', {'id': 'term_time', 'style': {'display': 'table-cell'}}),
            infoPanelRowsLabel = u.createElement('span', {'id': 'rows_label', 'style': {'display': 'table-cell'}}),
            infoPanelRows = u.createElement('span', {'id': 'rows', 'style': {'display': 'table-cell'}}),
            infoPanelColsLabel = u.createElement('span', {'id': 'cols_label', 'style': {'display': 'table-cell'}}),
            infoPanelCols = u.createElement('span', {'id': 'cols', 'style': {'display': 'table-cell'}}),
            infoPanelBackspaceLabel = u.createElement('span', {'id': 'backspace_label', 'style': {'display': 'table-cell'}}),
            infoPanelBackspace = u.createElement('span', {'id': 'backspace', 'style': {'display': 'table-cell'}}),
            infoPanelBackspaceCheckH = u.createElement('input', {'type': 'radio', 'id': 'backspace_h', 'name': 'backspace', 'value': '^H', 'style': {'display': 'table-cell'}}),
            infoPanelBackspaceCheckQ = u.createElement('input', {'type': 'radio', 'id': 'backspace_q', 'name': 'backspace', 'value': '^?', 'style': {'display': 'table-cell'}}),
            infoPanelEncodingLabel = u.createElement('span', {'id': 'encoding_label', 'style': {'display': 'table-cell'}}),
            infoPanelEncoding = u.createElement('input', {'type': 'text', 'id': 'encoding', 'name': 'encoding', 'value': 'utf-8', 'style': {'display': 'table-cell'}}),
            infoPanelSaveRecording = u.createElement('button', {'id': 'saverecording', 'type': 'submit', 'value': 'Submit', 'class': 'button black'}),
            infoPanelMonitorActivity = u.createElement('input', {'id': 'monitor_activity', 'type': 'checkbox', 'name': 'monitor_activity', 'value': 'monitor_activity', 'style': {'margin-right': '0.5em'}}),
            infoPanelMonitorActivityLabel = u.createElement('span'),
            infoPanelMonitorInactivity = u.createElement('input', {'id': 'monitor_inactivity', 'type': 'checkbox', 'name': 'monitor_inactivity', 'value': 'monitor_inactivity', 'style': {'margin-right': '0.5em'}}),
            infoPanelMonitorInactivityLabel = u.createElement('span'),
            infoPanelInactivityInterval = u.createElement('input', {'id': 'inactivity_interval', 'name': prefix+'inactivity_interval', 'size': 3, 'value': 10, 'style': {'margin-right': '0.5em', 'text-align': 'right', 'width': '4em'}}),
            infoPanelInactivityIntervalLabel = u.createElement('span'),
            goDiv = u.getNode(go.prefs.goDiv),
            resetTermButton = u.createElement('button', {'id': 'reset_terminal', 'type': 'submit', 'value': 'Submit', 'class': 'button black'}),
            toolbarPrefs = u.getNode('#'+prefix+'icon_prefs'),
            toolbar = u.getNode('#'+prefix+'toolbar'),
            cmdQueryString = u.getQueryVariable('terminal_cmd'),
            switchTerm = function() {
                go.Terminal.switchTerminal(localStorage[prefix+'selectedTerminal'])
            };
        if (cmdQueryString) {
            go.Terminal.defaultCommand = cmdQueryString;
        }
        // Create our info panel
        go.Icons['magnifyingGlass'] = '<svg xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://www.w3.org/2000/svg" height="18" width="18" version="1.1" xmlns:cc="http://creativecommons.org/ns#" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/"><defs><linearGradient id="infoGradient" y2="294.5" gradientUnits="userSpaceOnUse" x2="253.59" gradientTransform="translate(244.48201,276.279)" y1="276.28" x1="253.59"><stop class="stop1" offset="0"/><stop class="stop2" offset="0.4944"/><stop class="stop3" offset="0.5"/><stop class="stop4" offset="1"/></linearGradient></defs><metadata><rdf:RDF><cc:Work rdf:about=""><dc:format>image/svg+xml</dc:format><dc:type rdf:resource="http://purl.org/dc/dcmitype/StillImage"/><dc:title/></cc:Work></rdf:RDF></metadata><g transform="translate(-396.60679,-820.39654)"><g transform="translate(152.12479,544.11754)"><path fill="url(#infoGradient)" d="m257.6,278.53c-3.001-3-7.865-3-10.867,0-3,3.001-3,7.868,0,10.866,2.587,2.59,6.561,2.939,9.53,1.062l4.038,4.039,2.397-2.397-4.037-4.038c1.878-2.969,1.527-6.943-1.061-9.532zm-1.685,9.18c-2.07,2.069-5.426,2.069-7.494,0-2.071-2.069-2.071-5.425,0-7.494,2.068-2.07,5.424-2.07,7.494,0,2.068,2.069,2.068,5.425,0,7.494z"/></g></g></svg>';
        GateOne.Icons['info'] = '<svg xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://www.w3.org/2000/svg" height="15.938" width="18" version="1.1" xmlns:cc="http://creativecommons.org/ns#" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/"><defs><linearGradient id="linearGradient10820" y2="756.67" gradientUnits="userSpaceOnUse" x2="567.96" gradientTransform="matrix(0.21199852,0,0,0.19338189,198.64165,418.2867)" y1="674.11" x1="567.96"><stop class="stop1" offset="0"/><stop class="stop2" offset="0.4944"/><stop class="stop3" offset="0.5"/><stop class="stop4" offset="1"/></linearGradient></defs><metadata><rdf:RDF><cc:Work rdf:about=""><dc:format>image/svg+xml</dc:format><dc:type rdf:resource="http://purl.org/dc/dcmitype/StillImage"/><dc:title/></cc:Work></rdf:RDF></metadata><g transform="translate(-310.03125,-548.65625)"><path fill="url(#linearGradient10820)" d="m310.03,548.66,0,13.5,6.4062,0-0.40625,2.4375,5.6562-0.0312-0.46875-2.4062,6.8125,0,0-13.5-18,0zm1.25,1.125,15.531,0,0,11.219-15.531,0,0-11.219z"/></g></svg>';
        toolbarInfo.innerHTML = go.Icons['info'];
        go.Icons['close'] = '<svg xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://www.w3.org/2000/svg" height="18" width="18" version="1.1" xmlns:cc="http://creativecommons.org/ns#" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/"><defs><linearGradient id="closeGradient" y2="252.75" gradientUnits="userSpaceOnUse" y1="232.75" x2="487.8" x1="487.8"><stop class="stop1" offset="0"/><stop class="stop2" offset="0.4944"/><stop class="stop3" offset="0.5"/><stop class="stop4" offset="1"/></linearGradient></defs><metadata><rdf:RDF><cc:Work rdf:about=""><dc:format>image/svg+xml</dc:format><dc:type rdf:resource="http://purl.org/dc/dcmitype/StillImage"/><dc:title/></cc:Work></rdf:RDF></metadata><g transform="matrix(1.115933,0,0,1.1152416,-461.92317,-695.12248)"><g transform="translate(-61.7655,388.61318)" fill="url(#closeGradient)"><polygon points="483.76,240.02,486.5,242.75,491.83,237.42,489.1,234.68"/><polygon points="478.43,250.82,483.77,245.48,481.03,242.75,475.7,248.08"/><polygon points="491.83,248.08,486.5,242.75,483.77,245.48,489.1,250.82"/><polygon points="475.7,237.42,481.03,242.75,483.76,240.02,478.43,234.68"/><polygon points="483.77,245.48,486.5,242.75,483.76,240.02,481.03,242.75"/><polygon points="483.77,245.48,486.5,242.75,483.76,240.02,481.03,242.75"/></g></g></svg>';
        toolbarClose.innerHTML = go.Icons['close'];
        go.Icons['newTerm'] = '<svg xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns="http://www.w3.org/2000/svg" height="18" width="18" version="1.1" xmlns:cc="http://creativecommons.org/ns#" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/"><defs><linearGradient id="newTermGradient" y2="234.18" gradientUnits="userSpaceOnUse" x2="561.42" y1="252.18" x1="561.42"><stop class="stop1" offset="0"/><stop class="stop2" offset="0.4944"/><stop class="stop3" offset="0.5"/><stop class="stop4" offset="1"/></linearGradient></defs><metadata><rdf:RDF><cc:Work rdf:about=""><dc:format>image/svg+xml</dc:format><dc:type rdf:resource="http://purl.org/dc/dcmitype/StillImage"/><dc:title/></cc:Work></rdf:RDF></metadata><g transform="translate(-261.95455,-486.69334)"><g transform="matrix(0.94996733,0,0,0.94996733,-256.96226,264.67838)"><rect height="3.867" width="7.54" y="241.25" x="557.66" fill="url(#newTermGradient)"/><rect height="3.866" width="7.541" y="241.25" x="546.25" fill="url(#newTermGradient)"/><rect height="7.541" width="3.867" y="245.12" x="553.79" fill="url(#newTermGradient)"/><rect height="7.541" width="3.867" y="233.71" x="553.79" fill="url(#newTermGradient)"/><rect height="3.867" width="3.867" y="241.25" x="553.79" fill="url(#newTermGradient)"/><rect height="3.867" width="3.867" y="241.25" x="553.79" fill="url(#newTermGradient)"/></g></g></svg>';
        toolbarNewTerm.innerHTML = go.Icons['newTerm'];
        infoPanelH2.innerHTML = "Gate One";
        infoPanelH2.title = "Click to edit.  Leave blank for default.";
        panelClose.innerHTML = go.Icons['panelclose'];
        panelClose.onclick = function(e) {
            go.Visual.togglePanel('#'+prefix+'panel_info'); // Scale away, scale away, scale away.
        }
        infoPanelTimeLabel.innerHTML = "<b>Connected Since:</b> ";
        infoPanelRowsLabel.innerHTML = "<b>Rows:</b> ";
        infoPanelRows.innerHTML = go.prefs.rows; // Will be replaced
        infoPanelColsLabel.innerHTML = "<b>Columns:</b> ";
        infoPanelCols.innerHTML = go.prefs.cols; // Will be replaced
        infoPanelBackspaceLabel.innerHTML = "<b>Backspace Key:</b> ";
        infoPanelBackspaceCheckQ.checked = true;
        infoPanelBackspaceCheckQ.onclick = function(e) {
            go.Terminal.terminals[term]['backspace'] = String.fromCharCode(127);
        }
        infoPanelBackspaceCheckH.onclick = function(e) {
            go.Terminal.terminals[term]['backspace'] = String.fromCharCode(8);
        }
        infoPanelBackspace.appendChild(infoPanelBackspaceCheckH);
        infoPanelBackspace.appendChild(infoPanelBackspaceCheckQ);
        infoPanelEncodingLabel.innerHTML = "<b>Encoding:</b> ";
        infoPanelEncoding.onblur = function(e) {
            // When the user is done editing their encoding make the change immediately
            go.Terminal.terminals[term]['encoding'] = this.value;
            go.ws.send(JSON.stringify({'terminal:set_encoding': {'term': term, 'encoding': this.value}}));
        }
        infoPanel.appendChild(infoPanelH2);
        infoPanel.appendChild(panelClose);
        infoPanel.appendChild(div);
        infoPanel.appendChild(tableDiv);
        infoPanel.appendChild(tableDiv2);
        infoPanelBackspaceCheckQ.insertAdjacentHTML('afterend', "^?");
        infoPanelBackspaceCheckH.insertAdjacentHTML('afterend', "^H");
        infoPanelRow1.appendChild(infoPanelTimeLabel);
        infoPanelRow1.appendChild(infoPanelTime);
        infoPanelRow2.appendChild(infoPanelRowsLabel);
        infoPanelRow2.appendChild(infoPanelRows);
        infoPanelRow3.appendChild(infoPanelColsLabel);
        infoPanelRow3.appendChild(infoPanelCols);
        infoPanelRow4.appendChild(infoPanelBackspaceLabel);
        infoPanelRow4.appendChild(infoPanelBackspace);
        infoPanelRow5.appendChild(infoPanelEncodingLabel);
        infoPanelRow5.appendChild(infoPanelEncoding);
        tableDiv.appendChild(infoPanelRow1);
        tableDiv.appendChild(infoPanelRow2);
        tableDiv.appendChild(infoPanelRow3);
        tableDiv.appendChild(infoPanelRow4);
        tableDiv.appendChild(infoPanelRow5);
        infoPanelMonitorActivityLabel.innerHTML = "Monitor for Activity<br />";
        infoPanelMonitorInactivityLabel.innerHTML = "Monitor for ";
        infoPanelInactivityIntervalLabel.innerHTML = "Seconds of Inactivity";
        infoPanelRow6.appendChild(infoPanelMonitorActivity);
        infoPanelRow6.appendChild(infoPanelMonitorActivityLabel);
        infoPanelRow6.appendChild(infoPanelMonitorInactivity);
        infoPanelRow6.appendChild(infoPanelMonitorInactivityLabel);
        infoPanelRow6.appendChild(infoPanelInactivityInterval);
        infoPanelRow6.appendChild(infoPanelInactivityIntervalLabel);
        tableDiv2.appendChild(infoPanelRow6);
        u.hideElement(infoPanel); // Start out hidden
        v.applyTransform(infoPanel, 'scale(0)');
        goDiv.appendChild(infoPanel); // Doesn't really matter where it goes
        infoPanelMonitorInactivity.onclick = function(e) {
            // Turn on/off inactivity monitoring
            var term = localStorage[prefix+'selectedTerminal'],
                monitorInactivity = u.getNode('#'+prefix+'monitor_inactivity'),
                monitorActivity = u.getNode('#'+prefix+'monitor_activity'),
                termTitle = go.Terminal.terminals[term]['title'];
            if (monitorInactivity.checked) {
                var inactivity = function() {
                    go.Terminal.notifyInactivity(term + ': ' + termTitle);
                    // Restart the timer
                    go.Terminal.terminals[term]['inactivityTimer'] = setTimeout(inactivity, go.Terminal.terminals[term]['inactivityTimeout']);
                }
                go.Terminal.terminals[term]['inactivityTimeout'] = 10000; // Ten second default--might want to make user-modifiable
                go.Terminal.terminals[term]['inactivityTimer'] = setTimeout(inactivity, go.Terminal.terminals[term]['inactivityTimeout']);
                if (go.Terminal.terminals[term]['activityNotify']) {
                    // Turn off monitoring for activity if we're now going to monitor for inactivity
                    go.Terminal.terminals[term]['activityNotify'] = false;
                    monitorActivity.checked = false;
                }
            } else {
                monitorInactivity.checked = false;
                clearTimeout(go.Terminal.terminals[term]['inactivityTimer']);
                go.Terminal.terminals[term]['inactivityTimer'] = false;
            }
        }
        infoPanelMonitorActivity.onclick = function() {
            // Turn on/off activity monitoring
            var term = localStorage[prefix+'selectedTerminal'],
                monitorInactivity = u.getNode('#'+prefix+'monitor_inactivity'),
                monitorActivity = u.getNode('#'+prefix+'monitor_activity'),
                termTitle = go.Terminal.terminals[term]['title'];
            if (monitorActivity.checked) {
                go.Terminal.terminals[term]['activityNotify'] = true;
                if (go.Terminal.terminals[term]['inactivityTimer']) {
                    // Turn off monitoring for activity if we're now going to monitor for inactivity
                    clearTimeout(go.Terminal.terminals[term]['inactivityTimer']);
                    go.Terminal.terminals[term]['inactivityTimer'] = false;
                    monitorInactivity.checked = false;
                }
            } else {
                monitorActivity.checked = false;
                go.Terminal.terminals[term]['activityNotify'] = false;
            }
        }
        infoPanelInactivityInterval.onblur = function(e) {
            // Update go.Terminal.terminals[term]['inactivityTimeout'] with the this.value
            var term = localStorage[prefix+'selectedTerminal'];
            go.Terminal.terminals[term]['inactivityTimeout'] = parseInt(this.value) * 1000;
        }
        var editTitle =  function(e) {
            var term = localStorage[prefix+'selectedTerminal'],
                title = go.Terminal.terminals[term]['title'],
                titleEdit = u.createElement('input', {'type': 'text', 'name': 'title', 'value': title, 'id': go.prefs.prefix + 'title_edit'}),
                finishEditing = function(e) {
                    var newTitle = titleEdit.value,
                        termObj = u.getNode('#'+prefix+'term' + term),
                        sideInfo = u.getNode('#'+prefix+'sideinfo');
                    // Send a message to the server with the new title so it can stay in sync if the user reloads the page or reconnects from a different browser/machine
                    go.ws.send(JSON.stringify({'terminal:manual_title': {'term': term, 'title': newTitle}}));
                    infoPanelH2.onclick = editTitle;
                    go.Terminal.displayTermInfo(term);
                    go.Terminal.Input.capture();
                };
            go.Terminal.Input.disableCapture();
            titleEdit.onblur = finishEditing;
            titleEdit.onkeypress = function(e) {
                if (go.Input.key(e).code == 13) { // Enter key
                    finishEditing(e);
                }
            }
            this.onclick = null;
            this.innerHTML = "";
            this.appendChild(titleEdit);
            titleEdit.focus();
            titleEdit.select();
        }
        infoPanelH2.onclick = editTitle;
        toolbarNewTerm.onclick = function(e) {
            go.Terminal.newTerminal();
            go.Terminal.Input.capture();
        };
        var closeCurrentTerm = function() {
            go.Terminal.closeTerminal(localStorage[prefix+'selectedTerminal']);
            go.Terminal.Input.capture();
        }
        toolbarClose.onclick = closeCurrentTerm;
        // TODO: Get showInfo() displaying the proper status of the activity monitor checkboxes
        var showInfo = function() {
            var term = localStorage[prefix+'selectedTerminal'],
                termObj = go.Terminal.terminals[term];
            u.getNode('#'+prefix+'term_time').innerHTML = termObj['created'].toLocaleString() + "<br />";
            u.getNode('#'+prefix+'rows').innerHTML = termObj['rows'] + "<br />";
            u.getNode('#'+prefix+'cols').innerHTML = termObj['columns'] + "<br />";
            go.Visual.togglePanel('#'+prefix+'panel_info');
        }
        toolbarInfo.onclick = showInfo;
        toolbar.insertBefore(toolbarInfo, toolbarPrefs);
        toolbar.insertBefore(toolbarNewTerm, toolbarInfo);
        toolbar.insertBefore(toolbarClose, toolbarNewTerm);
        resetTermButton.innerHTML = "Rescue Terminal";
        resetTermButton.title = "Attempts to rescue a hung terminal by performing a terminal reset; the equivalent of executing the 'reset' command.";
        resetTermButton.onclick = function() {
            go.ws.send(JSON.stringify({'terminal:reset_terminal': localStorage[prefix+'selectedTerminal']}));
        }
        div.appendChild(resetTermButton);
        // Register our keyboard shortcuts
        // Ctrl-Alt-N to create a new terminal
        if (!go.prefs.embedded) {
            go.Input.registerShortcut('KEY_N', {'modifiers': {'ctrl': true, 'alt': true, 'meta': false, 'shift': false}, 'action': 'GateOne.Terminal.newTerminal()'});
            // Ctrl-Alt-W to close the current terminal
            go.Input.registerShortcut('KEY_W', {'modifiers': {'ctrl': true, 'alt': true, 'meta': false, 'shift': false}, 'action': 'GateOne.Terminal.closeTerminal(localStorage["'+prefix+'selectedTerminal"], false)'});
        }
        // TODO: Get rid of the disableTermTransitions preference.  It will be a workspaces thing in the future.
        // Disable terminal transitions if the user wants
        if (go.prefs.disableTermTransitions) {
            var newStyle = u.createElement('style', {'id': 'disable_term_transitions'});
            newStyle.innerHTML = go.prefs.goDiv + " .terminal {-webkit-transition: none; -moz-transition: none; -ms-transition: none; -o-transition: none; transition: none;}";
            go.node.appendChild(newStyle);
        }
        // Load the Web Worker
        if (!go.prefs.webWorker) {
            go.prefs.webWorker = go.prefs.url + 'terminal/static/webworkers/term_ww.js';
        }
        logDebug("Attempting to download our WebWorker...");
        go.ws.send(JSON.stringify({'terminal:get_webworker': null}));
        window.addEventListener('resize', go.Terminal.onResizeEvent, false);
        // Get shift-Insert working in a natural way (NOTE: Will only work when Gate One is the active element on the page)
        go.Input.registerShortcut('KEY_INSERT', {'modifiers': {'ctrl': false, 'alt': false, 'meta': false, 'shift': true}, 'action': go.Terminal.paste, 'preventDefault': false});
        // Register our actions
        go.Net.addAction('terminal:terminals', go.Terminal.reattachTerminalsAction);
        go.Net.addAction('terminal:termupdate', go.Terminal.updateTerminalAction);
        go.Net.addAction('terminal:set_title', go.Visual.setTitleAction);
        go.Net.addAction('terminal:term_ended', go.Terminal.closeTerminal);
        go.Net.addAction('terminal:term_exists', go.Terminal.reconnectTerminalAction);
        go.Net.addAction('terminal:term_moved', go.Terminal.moveTerminalAction);
        go.Net.addAction('terminal:set_mode', go.Terminal.setModeAction); // For things like application cursor keys
        go.Net.addAction('terminal:reset_terminal', go.Terminal.resetTerminalAction);
        go.Net.addAction('terminal:load_webworker', go.Terminal.loadWebWorkerAction);
        go.Net.addAction('terminal:bell', go.Terminal.bellAction);
        // This ensures that whatever effects are applied to a terminal when switching to it get applied when resized too:
        E.on("go:update_dimensions", switchTerm);
        E.on("go:save_prefs", function() {
            // In case the user changed the rows/cols or the font/size changed:
            setTimeout(function() { // Wrapped in a timeout since it takes a moment for everything to change in the browser
                go.Visual.updateDimensions();
                for (var termObj in GateOne.Terminal.terminals) {
                    if (termObj % 1 === 0) { // Actual terminal objects are integers
                        go.Terminal.sendDimensions(termObj);
                    }
                };
            }, 3000);
        });
        E.on("go:restore_defaults", function() {
            go.prefs['colors'] = "default";
            go.prefs['disableTermTransitions'] = false;
            go.prefs['scrollback'] = 500;
            go.prefs['rows'] = null;
            go.prefs['cols'] = null;
        });
        E.on("terminal:switch_terminal", go.Terminal.switchTerminalEvent);
        E.on("go:switch_workspace", go.Terminal.switchWorkspaceEvent);
        E.on("go:connection_error", go.Terminal.connectionError);
        E.on("go:grid_view:open", function() {
            go.Terminal.disableScrollback();
            u.hideElements(go.prefs.goDiv + ' .pastearea');
        });
        E.on("go:grid_view:close", function() {
            go.Terminal.enableScrollback();
            u.showElements(go.prefs.goDiv + ' .pastearea');
        });
        E.on("go:update_dimensions", go.Terminal.updateDimensions);
        E.on("go:timeout", go.Terminal.timeoutEvent);
        go.Terminal.loadTextColors();
        setTimeout(function() {
            go.Terminal.getOpenTerminals();
        }, 500);
    },
    __new__: function(settings) {
        /**:GateOne.Terminal.__new__(settings)

        Called when a user clicks on the Terminal Application in the New Workspace Workspace (or anything that happens to call __new__()).
        */
        var command = settings['command'];
        go.Terminal.newTerminal(); // Just create a new terminal in a new workspace for now.
        // TODO: Make this take settings like "command", rows/cols, and *where*.
    },
    onResizeEvent: function(e) {
        // Update the Terminal if it is resized
        if (go.Terminal.resizeEventTimer) {
            clearTimeout(go.Terminal.resizeEventTimer);
            go.Terminal.resizeEventTimer = null;
        }
        go.Terminal.resizeEventTimer = setTimeout(function() {
            // Wrapped in a timeout to de-bounce
            var term = localStorage[prefix+'selectedTerminal'],
                terminalObj = go.Terminal.terminals[term],
                termPre = terminalObj['node'],
                screenNode = terminalObj['screenNode'],
                emHeight = u.getEmDimensions(go.node).h;
            if (u.isVisible(termPre)) {
                go.Visual.updateDimensions();
                for (var termObj in GateOne.Terminal.terminals) {
                    if (termObj % 1 === 0) { // Actual terminal objects are integers
                        go.Terminal.sendDimensions(termObj);
                    }
                };
                setTimeout(function() {
                    var parentHeight = termPre.parentElement.clientHeight;
                    if (parentHeight) {
                        termPre.style.height = (parentHeight - go.Terminal.terminals[term]['heightAdjust']) + 'px';
                    } else {
                        termPre.style.height = "100%";
                    }
                }, 100);
            }
            // Adjust the view so the scrollback buffer stays hidden unless the user scrolls
            if (!go.prefs.embedded) {
                // In embedded mode this kind of adjustment can be unreliable
                v.applyTransform(termPre, ''); // Need to reset before we do calculations
                go.Terminal.resizeAdjustTimer = setTimeout(function() {
                    var distance = go.node.clientHeight - screenNode.offsetHeight;
                    distance -= (emHeight * go.prefs.rowAdjust); // Have to adjust for the extra row we add for the playback controls
                    if (go.Utils.isVisible(termPre)) {
                        var transform = "translateY(-" + distance + "px)";
                        v.applyTransform(termPre, transform); // Move it to the top so the scrollback isn't visible unless you actually scroll
                    }
                }, 1000);
            }
            if (go.prefs.rows) { // If someone explicitly set rows/cols, scale the term to fit the screen
                var nodeHeight = screenNode.getClientRects()[0].top;
                if (nodeHeight < go.node.clientHeight) { // Resize to fit
                    var scale = go.node.clientHeight / (go.node.clientHeight - nodeHeight),
                        transform = "scale(" + scale + ", " + scale + ")";
                    v.applyTransform(termPre, transform);
                }
            }
            u.scrollToBottom(termPre);
        }, 750);
    },
    timeoutEvent: function() {
        /**:GateOne.Terminal.timeoutEvent()

        Attached to the 'go:timeout' event; closes all open terminals when the user's session has timed out.
        */
        var terms = u.toArray(u.getNodes(go.prefs.goDiv + ' .terminal'));
        terms.forEach(function(termObj) {
            // Passing 'true' here to keep the stuff in localStorage for this term.
            go.Terminal.closeTerminal(termObj.id.split('term')[1], true);
        });
    },
    connectionError: function() {
        /**:GateOne.Terminal.connectionError()

        This function gets attached to the "go:connection_error" event; closes all open terminals.
        */
        var terms = u.toArray(u.getNodes(go.prefs.goDiv + ' .terminal'));
        terms.forEach(function(termObj) {
            // Passing 'true' here to keep the stuff in localStorage for this term.
            go.Terminal.closeTerminal(termObj.id.split('term')[1], true);
        });
    },
    getOpenTerminals: function() {
        /**:GateOne.Terminal.getOpenTerminals()

        Requests a list of open terminals on the server via the 'terminal:get_terminals' WebSocket action.  The server will respond with a 'terminal:terminals' WebSocket action message which calls :js:meth:`GateOne.Terminal.reattachTerminalsAction`.
        */
        go.ws.send(JSON.stringify({'terminal:get_terminals': null}));
    },
    sendString: function(chars, /*opt*/term) {
        /**:GateOne.Terminal.sendString(chars[, term])

        Like sendChars() but for programmatic use.  *chars* will be sent to *term* on the server.

        If *term* is not given the currently-selected terminal will be used.
        */
        var u = go.Utils,
            term = term || localStorage[go.prefs.prefix+'selectedTerminal'],
            message = {'chars': chars, 'term': term};
        go.ws.send(JSON.stringify({'terminal:write_chars': message}));
    },
    killTerminal: function(term) {
        /**:GateOne.Terminal.killTerminal(term)

        Tells the server got close the given *term*.
        */
        go.ws.send(JSON.stringify({'terminal:kill_terminal': term}));
    },
    refresh: function(term) {
        /**:GateOne.Terminal.refresh(term)

        Tells the Gate One server to send a screen refresh (using the diff method).

        .. note:: This function is only here for debugging purposes.  Under normal circumstances difference-based screen refreshes are initiated at the server.
        */
        go.ws.send(JSON.stringify({'terminal:refresh': term}));
    },
    fullRefresh: function(term) {
        /**:GateOne.Terminal.fullRefresh(term)

        Tells the Gate One server to send a full screen refresh to the client for the given *term*.
        */
        go.ws.send(JSON.stringify({'terminal:full_refresh': term}));
    },
    loadTextColors: function(colors) {
        /**:GateOne.Terminal.loadTextColors(colors)

        Tells the server to perform a sync of the given *colors* (terminal text colors) with the client.  If *colors* is not given, will load the colors set in `GateOne.prefs.colors`.
        */
        var container = go.prefs.goDiv.split('#')[1];
        if (!colors) {
            colors = go.prefs.colors;
        }
        go.ws.send(JSON.stringify({'terminal:get_colors': {'go_url': go.prefs.url, 'container': container, 'prefix': go.prefs.prefix, 'colors': colors}}));
    },
    // TODO: Get this *actually* centering the terminal info
    displayTermInfo: function(term) {
        /**:GateOne.Terminal.displayTermInfo(term)

        Displays the given term's information as a psuedo tooltip that eventually fades away.
        */
        var termObj = u.getNode('#'+prefix+'term' + term);
        if (!termObj) {
            return;
        }
        var displayText = termObj.id.split('term')[1] + ": " + go.Terminal.terminals[term]['title'],
            termInfoDiv = u.createElement('div', {'id': 'terminfo'}),
            marginFix = Math.round(go.Terminal.terminals[term]['title'].length/2),
            infoContainer = u.createElement('div', {'id': 'infocontainer', 'style': {'margin-right': '-' + marginFix + 'em'}});
        termInfoDiv.innerHTML = displayText;
        if (u.getNode('#'+prefix+'infocontainer')) { u.removeElement('#'+prefix+'infocontainer') }
        infoContainer.appendChild(termInfoDiv);
        go.node.appendChild(infoContainer);
        if (v.infoTimer) {
            clearTimeout(v.infoTimer);
            v.infoTimer = null;
        }
        v.infoTimer = setTimeout(function() {
            v.applyStyle(infoContainer, {'opacity': 0});
            setTimeout(function() {
                u.removeElement(infoContainer);
            }, 1000);
        }, 1000);
    },
    sendDimensions: function(term, /*opt*/ctrl_l) {
        /**:GateOne.Terminal.sendDimensions(term[, ctrl_l])

        Sends the current terminal's dimensions to the server.
        */
        logDebug('sendDimensions(' + term + ', ' + ctrl_l + ')');
        if (!term) {
            var term = localStorage[GateOne.prefs.prefix+'selectedTerminal'];
        }
        if (typeof(ctrl_l) == 'undefined') {
            ctrl_l = true;
        }
        var rowAdjust = go.prefs.rowAdjust + go.Terminal.rowAdjust, // Always 1 since getRowsAndColumns uses Math.ceil (don't want anything to get cut off)
            colAdjust = go.prefs.colAdjust + go.Terminal.colAdjust, // Always 3 for the scrollbar + toolbar
            emDimensions = u.getEmDimensions(go.prefs.goDiv),
            dimensions = u.getRowsAndColumns(go.prefs.goDiv),
            prefs = {
                'term': term,
                'rows': Math.ceil(dimensions.rows - rowAdjust),
                'cols': Math.ceil(dimensions.cols - colAdjust),
                'em_dimensions': emDimensions
            }
        if (!emDimensions || !dimensions) {
            return; // Nothing to do
        }
        if (go.prefs.showToolbar || go.prefs.showTitle) {
            prefs['cols'] = prefs['cols'] - 4; // If there's no toolbar and no title there's no reason to have empty space on the right.
        }
        // Apply user-defined rows and cols (if set)
        if (go.prefs.cols) { prefs.cols = go.prefs.cols };
        if (go.prefs.rows) { prefs.rows = go.prefs.rows };
        // Execute any sendDimensionsCallbacks
        E.trigger("terminal:send_dimensions", term);
        // sendDimensionsCallbacks is DEPRECATED.  Use GateOne.Events.on("send_dimensions", yourFunc) instead
        if (GateOne.Net.sendDimensionsCallbacks.length) {
            go.Logging.deprecated("sendDimensionsCallbacks", "Use GateOne.Events.on('terminal:send_dimensions', func) instead.");
            for (var i=0; i<GateOne.Net.sendDimensionsCallbacks.length; i++) {
                GateOne.Net.sendDimensionsCallbacks[i](term);
            }
        }
        // Tell the server the new dimensions
        go.ws.send(JSON.stringify({'terminal:resize': prefs}));
    },
    setTitleAction: function(titleObj) {
        /**:GateOne.Terminal.setTitleAction(titleObj)

        Sets the title of *titleObj['term']* to *titleObj['title']*.
        */
        var term = titleObj['term'],
            title = titleObj['title'],
            sideinfo = u.getNode('#'+prefix+'sideinfo'),
            termTitle = u.getNode('#'+prefix+'termtitle'),
            toolbar = u.getNode('#'+prefix+'toolbar'),
            termNode = u.getNode('#'+prefix+'term' + term),
            goDiv = u.getNode(go.prefs.goDiv),
            heightDiff = goDiv.clientHeight - toolbar.clientHeight,
            scrollbarAdjust = (go.Terminal.scrollbarWidth || 15); // Fallback to 15px if this hasn't been set yet (a common width)
        logDebug("Setting term " + term + " to title: " + title);
        go.Terminal.terminals[term]['X11Title'] = title;
        go.Terminal.terminals[term]['title'] = title;
        sideinfo.innerHTML = term + ": " + title;
        sideinfo.style.right = scrollbarAdjust + 'px';
        // Also update the info panel
        termTitle.innerHTML = term+': '+title;
        // Now scale sideinfo so that it looks as nice as possible without overlapping the icons
        go.Visual.applyTransform(sideinfo, "rotate(90deg)"); // Have to reset it first
        if (sideinfo.clientWidth > heightDiff) { // We have overlap
            var scaleDown = heightDiff / (sideinfo.clientWidth + 10); // +10 to give us some space between
            scrollbarAdjust = Math.ceil(scrollbarAdjust * (1-scaleDown));
            go.Visual.applyTransform(sideinfo, "rotate(90deg) scale(" + scaleDown + ")" + "translateY(" + scrollbarAdjust + "px)");
        }
        E.trigger('terminal:set_title_action', term, title);
    },
    paste: function(e) {
        /**:GateOne.Terminal.paste(e)

        This gets attached to Shift-Insert (KEY_INSERT) as a shortcut in order to support pasting.
        */
        logDebug('paste()');
        var tempPaste = u.createElement('textarea', {'class': 'temppaste', 'style': {'position': 'fixed', 'top': '-100000px', 'left': '-100000px', 'opacity': 0}});
        go.Terminal.Input.handlingPaste = true;
        tempPaste.oninput = function(e) {
            var pasted = tempPaste.value,
                lines = pasted.split('\n');
            if (lines.length > 1) {
                // If we're pasting stuff with newlines we should strip trailing whitespace so the lines show up correctly.  In all but a few cases this is what the user expects.
                for (var i=0; i < lines.length; i++) {
                    lines[i] = lines[i].replace(/\s*$/g, ""); // Remove trailing whitespace
                }
                pasted = lines.join('\n');
            }
            go.Terminal.sendString(pasted);
            tempPaste.value = "";
            u.removeElement(tempPaste); // Don't need this anymore
            setTimeout(function() {
                go.Terminal.Input.handlingPaste = false;
                go.Terminal.Input.capture();
            }, 250);
        }
        go.node.appendChild(tempPaste);
        tempPaste.focus();
    },
    writeScrollback: function(term, scrollback) {
        /**:GateOne.Terminal.writeScrollback(term, scrollback)

        Writes the given *scrollback* buffer for the given *term* to localStorage.
        */
        try { // Save the scrollback buffer in localStorage for retrieval if the user reloads
            localStorage.setItem(GateOne.prefs.prefix+"scrollback" + term, scrollback.join('\n'));
        } catch (e) {
            logError(e);
        }
        return null;
    },
    applyScreen: function(screen, term) {
        /**:GateOne.Terminal.applyScreen(screen, term)

        Uses *screen* (array of HTML-formatted lines) to update *term*
        If *term* isn't given, will use localStorage[prefix+selectedTerminal]

        .. note::  Lines in *screen* that are empty strings or null will be ignored (so it is safe to pass a full array with only a single updated line).
        */
        var u = GateOne.Utils,
            prefix = GateOne.prefs.prefix,
            existingPre = go.Terminal.terminals[term]['node'],
            existingScreen = go.Terminal.terminals[term]['screenNode'];
        if (!term) {
            term = localStorage[prefix+'selectedTerminal'];
        }
        for (var i=0; i < screen.length; i++) {
            if (screen[i].length) {
                // TODO: Get this using pre-cached line nodes
                if (go.Terminal.terminals[term]['screen'][i] != screen[i]) {
                    var existingLine = existingScreen.querySelector(GateOne.prefs.goDiv + ' .' + prefix + 'line_' + i);
                    if (existingLine) {
                        existingLine.innerHTML = screen[i] + '\n';
                    } else { // Size of the terminal increased
                        var classes = 'termline ' + prefix + 'line_' + i,
                            lineSpan = u.createElement('span', {'class': classes});
                        lineSpan.innerHTML = screen[i] + '\n';
                        existingScreen.appendChild(lineSpan);
                    }
                    // Update the existing screen array in-place to cut down on GC
                    go.Terminal.terminals[term]['screen'][i] = screen[i];
                }
            }
        }
    },
    alignTerminal: function(term) {
        /**:GateOne.Terminal.alignTerminal(term)

        Uses a CSS3 transform to move the terminal <pre> element upwards just a bit so that the scrollback buffer isn't visislbe unless you actually scroll.  This improves the terminal's overall appearance considerably because the bottoms of characters in the scollback buffer tend to look like graphical glitches.
        */
        var termPre = go.Terminal.terminals[term]['node'],
            screenSpan = go.Terminal.terminals[term]['screenNode'];
        if (go.prefs.rows) { // If someone explicitly set rows/cols, scale the term to fit the screen
            var nodeHeight = screenSpan.getClientRects()[0].top;
            if (nodeHeight < go.node.clientHeight) { // Resize to fit
                var scale = go.node.clientHeight / (go.node.clientHeight - nodeHeight),
                    transform = "scale(" + scale + ", " + scale + ")";
                v.applyTransform(termPre, transform);
            }
        } else {
            if (!go.prefs.embedded) {
                // In embedded mode this kind of adjustment can be unreliable
                v.applyTransform(termPre, ''); // Need to reset before we do the calculation
                go.Terminal.terminals[term]['heightAdjust'] = 0; // Have to set this as a default value for new terminals
                // Feel free to attach something like this to the "term_updated" event if you want.
                if (u.isVisible(termPre)) {
                    // The timeout is here to ensure everything has settled down (completed animations and whatnot) before we do the distance calculation.
                    go.Terminal.disableScrollback(term); // The calculation won't work if the scrollback buffer is visible
                    setTimeout(function() {
                        var distance = go.node.clientHeight - termPre.offsetHeight,
                            transform = "translateY(-" + distance + "px)";
                        v.applyTransform(termPre, transform); // Move it to the top so the scrollback isn't visible unless you actually scroll
                        go.Terminal.enableScrollback(term); // Turn it back on
                    }, 10);
                }
            }
        }
    },
    termUpdateFromWorker: function(e) {
        /**:GateOne.Terminal.termUpdateFromWorker(e)

        This function gets assigned to the :js:meth:`termUpdatesWorker.onmessage` event; Whenever the WebWorker completes processing of the incoming screen it posts the result to this function.  It takes care of updating the terminal on the page, storing the scrollback buffer, and finally triggers the "terminal:term_updated" event.
        */
        var data = e.data,
            term = data.term,
            screen = data.screen,
            scrollback = data.scrollback,
            backspace = data.backspace,
            screen_html = "",
            consoleLog = data.log, // Only used when debugging
            screenUpdate = false,
            termTitle = "Gate One", // Will be replaced down below
            goDiv = go.node,
            termContainer = go.Terminal.terminals[term]['terminal'],
            existingPre = null,
            existingScreen = null;
        if (!go.Terminal.terminals[term]) {
            return; // Nothing to do
        }
        existingPre = go.Terminal.terminals[term]['node'];
        existingScreen = go.Terminal.terminals[term]['screenNode']
        if (term && go.Terminal.terminals[term]) {
            termTitle = go.Terminal.terminals[term]['title'];
        } else {
            // Terminal was likely just closed.
            return;
        };
        if (backspace.length) {
            go.Terminal.Input.automaticBackspace = false; // Tells us to hold off on attempting to detect backspace for a while
            setTimeout(function() {
                // Don't bother checking for incorrect backspace again for at least 10 seconds
                go.Terminal.Input.automaticBackspace = true;
            }, 10000);
            // Use whatever was detected
            if (backspace.charCodeAt(0) == 8) {
                v.displayMessage("Backspace difference detected; switching to ^?");
                go.Net.sendString(String.fromCharCode(8)); // Send the intended backspace
                u.getNode('#'+prefix+'backspace_h').checked = true;
            } else {
                v.displayMessage("Backspace difference detected; switching to ^H");
                go.Net.sendString(String.fromCharCode(127)); // Send the intended backspace
                u.getNode('#'+prefix+'backspace_q').checked = true;
            }
            go.Terminal.terminals[term]['backspace'] = backspace;
        }
        if (screen) {
            try {
                if (existingScreen && go.Terminal.terminals[term]['screen'].length != screen.length) {
                    // Resized
                    var prevLength = go.Terminal.terminals[term]['screen'].length;
                    go.Terminal.terminals[term]['screen'].length = screen.length; // Resize the array to match
                    if (prevLength < screen.length) {
                        // Grow to fit
                        for (var i=0; i < screen.length; i++) {
                            var classes = 'termline ' + prefix + 'line_' + i,
                                existingLine = existingPre.querySelector(GateOne.prefs.goDiv + ' .' + prefix + 'line_' + i),
                                lineSpan = u.createElement('span', {'class': classes});
                            if (!existingLine) {
                                lineSpan.innerHTML = screen[i] + '\n';
                                existingScreen.appendChild(lineSpan);
                                // Update the existing screen array in-place to cut down on GC
                                go.Terminal.terminals[term]['screen'][i] = screen[i];
                            }
                        }
                    } else {
                        // Shrink to fit
                        for (var i=0; i < prevLength; i++) {
                            var classes = 'termline ' + prefix + 'line_' + i,
                                existingLine = existingPre.querySelector(GateOne.prefs.goDiv + ' .' + prefix + 'line_' + i);
                            if (existingLine) {
                                if (i >= screen.length) {
                                   u.removeElement(existingLine);
                                }
                            }
                        }
                    }
                    u.scrollToBottom(existingPre);
                }
                if (existingScreen) { // Update the terminal display
                    // Get the current scrollbar position so we can make a determination as to whether or not we should scroll to the bottom.
                    var scroll = false;
                    if ((existingPre.scrollHeight - existingPre.scrollTop) == existingPre.clientHeight) {
                        scroll = true;
                    }
                    go.Terminal.applyScreen(screen, term);
                    // NOTE: Why would we need to scroll to the bottom if it is *already* scrolled to the bottom?  Because, when the entire screen is updated and there's really long lines or images it can result in the page being scrolled up a bit.  If the screen was scrolled all the way to the bottom before we applied an update we know that we should scroll to the bottom again.
                    if (scroll) {
                        setTimeout(function() {
                            // It can take a second for the browser to draw everything so we wait just a moment before scrolling
                            u.scrollToBottom(existingPre);
                        }, 100);
                    }
                } else { // Create the elements necessary to display the screen
                    var screenSpan = u.createElement('span', {'id': 'term'+term+'screen', 'class': 'screen'});
                    for (var i=0; i < screen.length; i++) {
                        var classes = 'termline ' + prefix + 'line_' + i,
                            lineSpan = u.createElement('span', {'class': classes});
                        lineSpan.innerHTML = screen[i] + '\n';
                        screenSpan.appendChild(lineSpan);
                        // Update the existing screen array in-place to cut down on GC
                        go.Terminal.terminals[term]['screen'][i] = screen[i];
                    }
                    go.Terminal.terminals[term]['screenNode'] = screenSpan;
                    if (existingPre) {
                        existingPre.appendChild(screenSpan);
                        u.scrollToBottom(existingPre);
                    } else {
                        var termPre = u.createElement('pre', {'id': 'term'+term+'_pre'});
                        termPre.appendChild(screenSpan);
                        termContainer.appendChild(termPre);
                        u.scrollToBottom(termPre);
                        termPre.oncopy = function(e) {
                            // Convert to plaintext before copying
                            // NOTE: This doesn't work in Firefox.  In fact, in Firefox it makes it impossible to copy anything!
                            if (navigator.userAgent.indexOf('Firefox') != -1) {
                                return true; // Firefox doesn't appear to copy formatting anyway so right now this isn't necessary
                            }
                            var text = u.rtrim(u.getSelText()),
                                selection = window.getSelection(),
                                tempTextArea = u.createElement('textarea', {'style': {'left': '-999999px', 'top': '-999999px'}});
                            tempTextArea.value = text;
                            document.body.appendChild(tempTextArea);
                            tempTextArea.select();
                            setTimeout(function() {
                                // Get rid of it once the copy operation is complete
                                u.removeElement(tempTextArea);
                                go.Terminal.Input.capture(); // Re-focus on the terminal and start accepting keyboard input again
                            }, 100);
                            return true;
                        }
                        go.Terminal.terminals[term]['node'] = termPre; // For faster access
                    }
                }
                screenUpdate = true;
                go.Terminal.terminals[term]['scrollbackVisible'] = false;
                // This is a convenience for plugin authors:  Execute any incoming <script> tags automatically
                var scriptElements = go.Terminal.terminals[term]['node'].querySelectorAll('script');
                if (scriptElements.length) {
                    u.toArray(scriptElements).forEach(function(tag) {
                        eval(tag.innerHTML);
                    });
                }
                // Adjust the toolbar so it isn't too close or too far from the scrollbar
                setTimeout(function() {
                    // This is wrapped in a long timeout to allow the browser to finish drawing everything (especially the scroll bars)
                    if (!GateOne.Terminal.scrollbarWidth) { // Only need to do this once
                        var pre = (existingPre || termPre); // Whatever was used in the code above
                        GateOne.Terminal.scrollbarWidth = pre.offsetWidth - pre.clientWidth;
                        if (GateOne.prefs.showToolbar) {
                            // Normalize the toolbar's position
                            var toolbar = u.getNode('#'+prefix+'toolbar');
                            toolbar.style.right = (GateOne.Terminal.scrollbarWidth + 3) + 'px'; // +3 to put some space between the scrollbar and the toolbar
                        }
                        if (GateOne.prefs.showTitle) {
                            // Normalize the side title as well
                            var sideInfo = u.getNode('#'+prefix+'sideinfo');
                            sideInfo.style.right = GateOne.Terminal.scrollbarWidth + 'px'; // The title on the side doesn't need the extra 3px ("right top" rotation)
                            // Explanation: The height of the font box on the sideinfo div extends higher than the text which is why we don't need an extra 5px spacing.
                            // Take a rectangular piece of paper and write some words across it in "landscape mode" so that the text covers the full width of the page.  Next rotate it 90deg clockwise along the "right top" axis (hold the "right top" with your thumb while rotating).  Voila!  Lots of space on the right.  No need to pad it.
                        }
                    }
                }, 5000);
            } catch (e) { // Likely the terminal just closed
                logDebug('Caught exception in termUpdateFromWorker: ' + e);
                u.noop(); // Just ignore it.
            }
        }
        if (scrollback.length && go.Terminal.terminals[term]['scrollback'].toString() != scrollback.toString()) {
            var reScrollback = u.partial(GateOne.Terminal.enableScrollback, term),
                writeScrollback = u.partial(GateOne.Terminal.writeScrollback, term, scrollback);
            go.Terminal.terminals[term]['scrollback'] = scrollback;
            // We wrap the logic that stores the scrollback buffer in a timer so we're not writing to localStorage (aka "to disk") every nth of a second for fast screen refreshes (e.g. fast typers).  Writing to localStorage is a blocking operation so this could speed things up considerable for larger terminal sizes.
            clearTimeout(go.Terminal.terminals[term]['scrollbackWriteTimer']);
            go.Terminal.terminals[term]['scrollbackWriteTimer'] = null;
            // This will save the scrollback buffer after 3.5 seconds of terminal inactivity (idle)
            go.Terminal.terminals[term]['scrollbackWriteTimer'] = setTimeout(writeScrollback, 3500);
            // This updates the scrollback buffer in the DOM
            clearTimeout(go.Terminal.terminals[term]['scrollbackTimer']);
            // This timeout re-adds the scrollback buffer after .5 seconds.  If we don't do this it can slow down the responsiveness quite a bit
            go.Terminal.terminals[term]['scrollbackTimer'] = setTimeout(reScrollback, 500); // Just enough to de-bounce (to keep things smooth)
        }
        if (consoleLog) {
            // This is only used when debugging the Web Worker
            try {
                logInfo(consoleLog);
            } finally {
                consoleLog = null;
            }
        }
        if (screenUpdate) {
            // Take care of the activity/inactivity notifications
            if (go.Terminal.terminals[term]['inactivityTimer']) {
                clearTimeout(go.Terminal.terminals[term]['inactivityTimer']);
                var inactivity = u.partial(GateOne.Terminal.notifyInactivity, term + ': ' + termTitle);
                try {
                    go.Terminal.terminals[term]['inactivityTimer'] = setTimeout(inactivity, go.Terminal.terminals[term]['inactivityTimeout']);
                } finally {
                    inactivity = null;
                }
            }
            if (go.Terminal.terminals[term]['activityNotify']) {
                if (!go.Terminal.terminals[term]['lastNotifyTime']) {
                    // Setup a minimum delay between activity notifications so we're not spamming the user
                    go.Terminal.terminals[term]['lastNotifyTime'] = new Date();
                    GateOne.Terminal.notifyActivity(term + ': ' + termTitle);
                } else {
                    var then = new Date(go.Terminal.terminals[term]['lastNotifyTime']),
                        now = new Date();
                    try {
                        then.setSeconds(then.getSeconds() + 5); // 5 seconds between notifications
                        if (now > then) {
                            go.Terminal.terminals[term]['lastNotifyTime'] = new Date(); // Reset
                            GateOne.Terminal.notifyActivity(term + ': ' + termTitle);
                        }
                    } finally {
                        then = null;
                        now = null;
                    }
                }
            }
            // Excute any registered callbacks
            GateOne.Events.trigger("terminal:term_updated", term);
            if (GateOne.Terminal.updateTermCallbacks.length) {
                GateOne.Logging.deprecated("updateTermCallbacks", "Use GateOne.Events.on('terminal:term_updated', func) instead.");
                for (var i=0; i<GateOne.Terminal.updateTermCallbacks.length; i++) {
                    GateOne.Terminal.updateTermCallbacks[i](term);
                }
            }
        }
    },
    loadWebWorkerAction: function(source) {
        // Loads our Web Worker given it's *source* (which is sent to us over the WebSocket which is a clever workaround to the origin limitations of Web Workers =).
        var u = go.Utils,
            t = go.Terminal,
            prefix = go.prefs.prefix,
            blob = null;
        try {
            blob = u.createBlob(source, 'application/javascript');
        } catch (e) {
            // No blob
            ;;
        }
        // Obtain a blob URL reference to our worker 'file'.
        if (blob && urlObj.createObjectURL) {
            try {
                var blobURL = urlObj.createObjectURL(blob);
                t.termUpdatesWorker = new Worker(blobURL);
            } catch (e) {
                // Some browsers (IE 10) don't allow you to load Web Workers via Blobs  For these we need to load the old fashioned way.
                // NOTE:  This means that if you're embedding Gate One you MUST have it listening on the same port as the web page embedding it.  Web Workers have the odd security restriction of being required to load via the same origin *type* (aka port) which is just plain wacky.
                t.termUpdatesWorker = new Worker(go.prefs.webWorker);
            }
        } else {
            // Fall back to the old way (try it anyway--won't work for most embedded situations)
            t.termUpdatesWorker = new Worker(go.prefs.webWorker);
            // Why bother with Blobs?  Because you can't load Web Workers from a different origin *type*.  What?!?
            // The origin type would be, say, HTTPS on port 443.  So if I wanted to load a Web Worker from such a page where the Worker's URL is from an HTTPS server on port 10443 it would throw errors.  Even if it is from the same domain.  The same holds true for loading a Worker from an HTTP URL.  What's odd is that you can load a Worker from HTTPS on a completely *different* domain as long as it's the same origin *type*!  Who comes up with this stuff?!?
            // So by loading the Web Worker code via the WebSocket we can get around all that nonsense since WebSockets can be anywhere and on any port without silly restrictions.
            // In other words, the old way should still work as long as Gate One is listening on the same protocol (HTTPS) and port (443) as the app that's embedding it.
        }
        t.termUpdatesWorker.onmessage = t.termUpdateFromWorker;
    },
    updateTerminalAction: function(termUpdateObj) {
        // Takes the updated screen information from *termUpdateObj* and posts it to the term_ww.js Web Worker to be processed.
        // The Web Worker is important because it allows offloading of CPU-intensive tasks like linkification and text transforms so they don't block screen updates
        var t = go.Terminal,
            term = termUpdateObj['term'],
            ratelimiter = termUpdateObj['ratelimiter'],
            scrollback = go.Terminal.terminals[term]['scrollback'],
            textTransforms = go.Terminal.textTransforms,
            checkBackspace = null,
            message = null;
//         logDebug('GateOne.Utils.updateTerminalAction() termUpdateObj: ' + u.items(termUpdateObj));
        logDebug("screen length: " + termUpdateObj['screen'].length);
        if (ratelimiter) {
            v.displayMessage("WARNING: The rate limiter was engaged on terminal " + term + ".  Output will be severely slowed until you press a key (e.g. Ctrl-C).");
        }
        if (go.Terminal.Input.sentBackspace) {
            checkBackspace = go.Terminal.terminals[term]['backspace'];
            go.Terminal.Input.sentBackspace = false; // Prevent a potential race condition
        }
        if (!scrollback) {
            // Terminal was just closed, ignore
            return;
        }
        // Remove all DOM nodes from the terminalObj since they can't be passed to a Web Worker
        if (termUpdateObj['screen']) {
            message = {
                'cmds': ['processScreen'],
                'scrollback': scrollback,
                'termUpdateObj': termUpdateObj,
                'prefs': go.prefs,
                'textTransforms': textTransforms,
                'checkBackspace': checkBackspace
            };
            // Offload processing of the incoming screen to the Web Worker
            t.termUpdatesWorker.postMessage(message);
        }
    },
    notifyInactivity: function(term) {
        // Notifies the user of inactivity in *term*
        var message = "Inactivity in terminal " + term;
        v.playBell();
        v.displayMessage(message);
    },
    notifyActivity: function(term) {
        // Notifies the user of activity in *term*
        var message = "Activity in terminal " + term;
        v.playBell();
        v.displayMessage(message);
    },
    newTerminal: function(/*Opt:*/term, /*Opt:*/settings, /*Opt*/where) {
        /**:GateOne.Terminal.newTerminal([term[, settings[, where]]])

        Adds a new terminal to the grid and starts updates with the server.

        If *term* is provided, the created terminal will use that number.

        If *settings* (associative array) are provided the given parameters will be applied to the created terminal's parameters in GateOne.Terminal.terminals[term] as well as sent as part of the 'terminal:new_terminal' WebSocket action.  This mechanism can be used to spawn terminals using different 'commands' that have been configured on the server.  For example::

            > // Creates a new terminal that spawns whatever command is set as 'login' in Gate One's settings:
            > GateOne.Terminal.newTerminal(null, {'command': 'login'});

        If *where* is provided, the new terminal element will be appended like so:  where.appendChild(<new terminal element>);  Otherwise the terminal will be added to the grid.

        Terminal types are sent from the server via the 'terminal_types' action which sets up GateOne.terminalTypes.  This variable is an associative array in the form of:  {'term type': {'description': 'Description of terminal type', 'default': true/false, <other, yet-to-be-determined metadata>}}.
        */
        // TODO: Finish supporting terminal types.
        logDebug("newTerminal(" + term + ")");
        var t = go.Terminal,
            currentTerm = null,
            terminal = null,
            termUndefined = false,
            gridwrapper = u.getNode('#'+prefix+'gridwrapper'),
            rowAdjust = go.prefs.rowAdjust + go.Terminal.rowAdjust,
            colAdjust = go.prefs.colAdjust + go.Terminal.colAdjust,
            emDimensions = u.getEmDimensions(go.prefs.goDiv),
            dimensions = u.getRowsAndColumns(go.prefs.goDiv),
            rows = Math.ceil(dimensions.rows - rowAdjust),
            cols = Math.ceil(dimensions.cols - colAdjust),
            workspaceNum, // Set below (if any)
            // Firefox doesn't support 'mousewheel'
            mousewheelevt = (/Firefox/i.test(navigator.userAgent))? "DOMMouseScroll" : "mousewheel",
            prevScrollback = localStorage.getItem(prefix + "scrollback" + term);
        if (go.prefs.showToolbar || go.prefs.showTitle) {
            cols = cols - 4; // Leave some empty space on the right if the toolbar or title are present
        }
        if (term) {
            currentTerm = 'term' + term;
            t.lastTermNumber = term;
        } else {
            termUndefined = true;
            if (!t.lastTermNumber) {
                t.lastTermNumber = 0; // Start at 0 so the first increment will be 1
            }
            t.lastTermNumber = t.lastTermNumber + 1;
            term = t.lastTermNumber;
            currentTerm = 'term' + t.lastTermNumber;
        }
        if (!where) {
            if (gridwrapper) {
                where = v.newWorkspace(); // Use the gridwrapper (grid) by default
                where.innerHTML = ""; // Empty it out before we use it
                workspaceNum = parseInt(where.id.split(prefix+'workspace')[1]);
            } else {
                where = go.prefs.goDiv;
            }
        }
        // Create the terminal record scaffold
        go.Terminal.terminals[term] = {
            created: new Date(), // So we can keep track of how long it has been open
            rows: rows,
            columns: cols,
            mode: 'default', // e.g. 'appmode', 'xterm', etc
            backspace: String.fromCharCode(127), // ^?
            encoding: 'utf-8',
            screen: [],
            prevScreen: [],
            title: 'Gate One',
            scrollback: [],
            scrollbackTimer: null, // Controls re-adding scrollback buffer
            where: where,
            workspace: workspaceNum // NOTE: This will be (likely) be null when embedding
        };
        for (var pref in settings) {
            go.Terminal.terminals[term][pref] = settings[pref];
        }
        for (var i=0; i<dimensions.rows; i++) {
            // Fill out prevScreen with spaces
            go.Terminal.terminals[term]['prevScreen'].push(' ');
        }
        if (prevScrollback) {
            go.Terminal.terminals[term]['scrollback'] = prevScrollback.split('\n');
        } else { // No previous scrollback buffer
            // Fill it with empty strings so that the current line stays at the bottom of the screen when scrollback is re-enabled after screen updates.
            var blankLines = [];
            for (var i=0; i<go.prefs.scrollback; i++) {
                blankLines.push("");
            }
            go.Terminal.terminals[term]['scrollback'] = blankLines;
        }
        if (!go.prefs.embedded) {
            // Prepare the terminal div for the grid
            terminal = u.createElement('div', {'id': currentTerm, 'class': 'terminal', 'style': {'width': v.goDimensions.w + 'px', 'height': v.goDimensions.h + 'px'}});
            // Switch to the newly created workspace (if warranted)
            if (workspaceNum) {
                v.switchWorkspace(workspaceNum);
            }
        } else {
            terminal = u.createElement('div', {'id': currentTerm, 'class': 'terminal'});
        }
        go.Terminal.terminals[term]['terminal'] = terminal; // Cache it for quicker access later
        // This ensures that we re-enable input if the user clicked somewhere else on the page then clicked back on the terminal:
//         terminal.addEventListener('click', go.Terminal.Input.capture, false);
        // Get any previous term's dimensions so we can use them for the new terminal
        var termSettings = {
                'term': term,
                'rows': rows,
                'cols': cols,
                'em_dimensions': emDimensions
            },
            mousewheelevt = (/Firefox/i.test(navigator.userAgent))? "DOMMouseScroll" : "mousewheel",
            slide = u.partial(go.Terminal.switchTerminal, term),
            pastearea = u.createElement('textarea', {'id': 'pastearea'+term, 'class': 'pastearea'}),
        // The following functions control the copy & paste capability
            pasteareaOnInput = function(e) {
                var go = GateOne,
                    pasted = pastearea.value,
                    lines = pasted.split('\n');
                if (go.Terminal.Input.handlingPaste) {
                    return;
                }
                if (lines.length > 1) {
                    // If we're pasting stuff with newlines we should strip trailing whitespace so the lines show up correctly.  In all but a few cases this is what the user expects.
                    for (var i=0; i < lines.length; i++) {
                        lines[i] = lines[i].replace(/\s*$/g, ""); // Remove trailing whitespace
                    }
                    pasted = lines.join('\n');
                }
                go.Terminal.sendString(pasted);
                pastearea.value = "";
                go.Terminal.Input.capture();
            },
            pasteareaScroll = function(e) {
                // We have to hide the pastearea so we can scroll the terminal underneath
                e.preventDefault();
                var go = GateOne,
                    pasteArea = u.getNode('#'+prefix+'pastearea');
                u.hideElement(pastearea);
                if (go.scrollTimeout) {
                    clearTimeout(go.scrollTimeout);
                    go.scrollTimeout = null;
                }
                go.scrollTimeout = setTimeout(function() {
                    u.showElement(pastearea);
                }, 1000);
            };
        // Update termSettings with *settings* (overriding with anything that was given)
        for (var pref in settings) {
            termSettings[pref] = settings[pref];
        }
        // Use the default command if set
        if (go.Terminal.defaultCommand) {
            if (!termSettings['command']) {
                termSettings['command'] = go.Terminal.defaultCommand;
            }
        }
        pastearea.oninput = pasteareaOnInput;
        pastearea.addEventListener(mousewheelevt, pasteareaScroll, true);
        pastearea.onpaste = function(e) {
            go.Terminal.Input.onPaste(e);
            // Start capturing input again
            setTimeout(function() {
                // For some reason when you paste the onmouseup event doesn't fire on goDiv; goFigure
                go.Terminal.Input.mouseDown = false;
                go.Terminal.Input.capture();
                pastearea.value = ''; // Empty it out to ensure there's no leftovers in subsequent pastes
            }, 1);
        }
        pastearea.oncontextmenu = function(e) {
            pastearea.focus();
        }
        pastearea.onmousemove = function(e) {
            var go = GateOne,
                u = go.Utils,
                prefix = go.prefs.prefix,
                termline = null,
                elem = null,
                maxRecursion = 10,
                count = 0,
                X = e.clientX,
                Y = e.clientY,
                timeout = 200;
            if (pastearea.style.display != 'none') {
                u.hideElement(pastearea);
                go.Terminal.Input.pasteareaTemp = pastearea.onmousemove;
                pastearea.onmouseover = null;
            }
            var elementUnder = document.elementFromPoint(X, Y);
            while (!termline) {
                // Look for special things under the mouse until we've reached the parent container of the line
                count += 1;
                if (count > maxRecursion) {
                    break;
                }
                if (!elem) {
                    elem = elementUnder;
                }
                if (typeof(elem.className) == "undefined") {
                    break;
                }
                if (elem.className.indexOf && elem.className.indexOf('termline') != -1) {
                    termline = elem; // End it
                } else if (elem.tagName.toLowerCase && elem.tagName.toLowerCase() == 'a') {
                    // Anchor elements mean we shouldn't make the pastearea reappear so the user can click on them
                    if (go.Terminal.pasteAreaTimer) {
                        clearTimeout(go.Terminal.pasteAreaTimer);
                        go.Terminal.pasteAreaTimer = null;
                    }
                    return;
                } else if (elem.className.indexOf && elem.className.indexOf('clickable') != -1) {
                    // Clickable elements mean we shouldn't make the pastearea reappear
                    if (go.Terminal.pasteAreaTimer) {
                        clearTimeout(go.Terminal.pasteAreaTimer);
                        go.Terminal.pasteAreaTimer = null;
                    }
                    return;
                } else {
                    elem = elem.parentNode;
                }
            }
            if (go.Terminal.pasteAreaTimer) {
                return; // Let it return to visibility on its own
            }
            go.Terminal.pasteAreaTimer = setTimeout(function() {
                pastearea.onmousemove = go.Terminal.Input.pasteareaTemp;
                go.Terminal.pasteAreaTimer = null;
                if (!u.getSelText()) {
                    u.showElement(pastearea);
                }
            }, timeout);
        }
        pastearea.addEventListener('mousedown', function(e) {
            // When the user left-clicks assume they're trying to highlight text
            // so bring the terminal to the front and try to emulate normal
            // cursor-text action as much as possible.
            // NOTE: There's one caveat with this method:  If text is highlighted
            //       right-click to paste won't work.  So the user has to just click
            //       somewhere (to deselect the text) before they can use the Paste
            //       context menu.  As a convenient shortcut/workaround, the user
            //       can middle-click to paste the current selection.
            logDebug('pastearea.onmousedown button: ' + e.button + ', which: ' + e.which);
            var go = GateOne,
                u = go.Utils,
                prefix = go.prefs.prefix,
                m = go.Input.mouse(e), // Get the properties of the mouse event
                X = e.clientX,
                Y = e.clientY,
                selectedTerm = localStorage[prefix+'selectedTerminal'];
            if (m.button.left) { // Left button depressed
                u.hideElement(pastearea);
                if (go.Terminal.pasteAreaTimer) {
                    clearTimeout(go.Terminal.pasteAreaTimer);
                }
                var elementUnder = document.elementFromPoint(X, Y);
                if (typeof(elementUnder.onclick) == "function") {
                    // Fire the onclick event
                    elementUnder.onclick(e); // Pass through the event
                }
                // This lets users click on links underneath the pastearea
                if (elementUnder.tagName == "A") {
                    window.open(document.elementFromPoint(X, Y).href);
                }
                // Don't add the scrollback if the user is highlighting text--it will mess it up
                if (go.Terminal.terminals[selectedTerm]) {
                    if (go.Terminal.terminals[selectedTerm]['scrollbackTimer']) {
                        clearTimeout(go.Terminal.terminals[selectedTerm]['scrollbackTimer']);
                    }
                }
                go.Terminal.Input.capture();
            } else if (m.button.middle) {
                // This is here to enable middle-click-to-paste in Windows but it only works if the user has launched Gate One in "application mode".
                // Gate One can be launched in "application mode" if the user selects the "create application shortcut..." option from the tools menu.
                try {
                    document.execCommand('paste');
                } catch (e) {
                    // Browser won't let us execute a paste event...  Hope for the best with the pastearea!
                    ;; // Ignore
                }
            } else if (m.button.right) {
                if (u.getSelText()) {
                    u.hideElement(pastearea);
                }
            }
        }, true);
        terminal.appendChild(pastearea);
        go.Terminal.terminals[term]['pasteNode'] = pastearea;
        u.getNode(where).appendChild(terminal);
        // Apply user-defined rows and cols (if set)
        if (go.prefs.cols) { termSettings.cols = go.prefs.cols };
        if (go.prefs.rows) { termSettings.rows = go.prefs.rows };
        // Tell the server to create a new terminal process
        go.ws.send(JSON.stringify({'terminal:new_terminal': termSettings}));
        // This re-enables the scrollback buffer immediately if the user starts scrolling (even if the timeout hasn't expired yet)
        var wheelFunc = function(e) {
            var m = go.Input.mouse(e),
                modifiers = go.Input.modifiers(e);
            if (!modifiers.shift && !modifiers.ctrl && !modifiers.alt) { // Only for basic scrolling
                if (go.Terminal.terminals[term]) {
                    var term = localStorage[prefix+'selectedTerminal'],
                        terminalObj = go.Terminal.terminals[term],
                        screen = terminalObj['screen'],
                        scrollback = terminalObj['scrollback'],
                        sbT = terminalObj['scrollbackTimer'];
                    if (sbT) {
                        clearTimeout(sbT);
                        sbT = null;
                    }
                    if (!terminalObj['scrollbackVisible']) {
                        // Immediately re-enable the scrollback buffer
                        go.Terminal.enableScrollback(term);
                    }
                }
            } else {
                e.preventDefault();
            }
        };
        terminal.addEventListener(mousewheelevt, wheelFunc, true);
        // Switch to our new terminal if *term* is set (no matter where it is)
        if (termUndefined) {
            // Only slide for terminals that are actually *new* (as opposed to ones that we're re-attaching to)
            setTimeout(slide, 100);
        }
        // Excute any registered callbacks (DEPRECATED: Use GateOne.Events.on("new_terminal", <callback>) instead)
        if (go.Terminal.newTermCallbacks.length) {
            go.Logging.deprecated("newTermCallbacks", "Use GateOne.Events.on('terminal:new_terminal', func) instead.");
            go.Terminal.newTermCallbacks.forEach(function(callback) {
                callback(term);
            });
        }
        // Fire our new_terminal event if everything was successful
        if (go.Terminal.terminals[term]) {
            E.trigger("terminal:new_terminal", term);
        }
        return term; // So you can call it from your own code and know what terminal number you wound up with
    },
    closeTerminal: function(term, /*opt*/noCleanup, /*opt*/message) {
        /**:GateOne.Terminal.closeTerminal(term[, noCleanup[, message]])

        Closes the given terminal (*term*) and tells the server to end its running process.

        If *noCleanup* resolves to true, stored data will be left hanging around for this terminal (e.g. the scrollback buffer in localStorage).  Otherwise it will be deleted.

        If a *message* is given it will be displayed to the user instead of the default "Closed term..." message.
        */
        var lastTerm = null;
        if (!message) {
            message = "Closed term " + term + ": " + go.Terminal.terminals[term]['title'];
        }
        // Tell the server to kill the terminal
        go.Terminal.killTerminal(term);
        if (!noCleanup) {
            // Delete the associated scrollback buffer (save the world from localStorage pollution)
            delete localStorage[prefix+'scrollback'+term];
        }
        // Remove the terminal from the page
        u.removeElement('#'+prefix+'term' + term);
        // Also remove it from working memory
        delete go.Terminal.terminals[term];
        // Now find out what the previous terminal was and move to it
        var terms = u.toArray(u.getNodes(go.prefs.goDiv + ' .terminal'));
        go.Visual.displayMessage(message);
        terms.forEach(function(termObj) {
            lastTerm = termObj;
        });
        // Excute any registered callbacks
        E.trigger("terminal:term_closed", term);
        // Make sure empty workspaces get cleaned up
        E.trigger('go:cleanup_workspaces');
        if (go.Terminal.closeTermCallbacks.length) {
            go.Terminal.closeTermCallbacks.forEach(function(callback) {
                go.Logging.deprecated("closeTermCallbacks", "Use GateOne.Events.on('terminal:term_closed', func) instead.");
                callback(term);
            });
        }
        if (lastTerm) {
            var termNum = lastTerm.id.split('term')[1];
            go.Terminal.switchTerminal(termNum);
        } else {
            // Only open a new terminal if we're not in embedded mode.  When you embed you have more explicit control but that also means taking care of stuff like this on your own.
            if (!go.prefs.embedded) {
                if (go.ws.readyState == 1) {
                    // There are no other terminals and we're still connected.  Open a new one...
                    go.Terminal.newTerminal();
                }
            }
        }
    },
    setTerminal: function(term) {
        /**:GateOne.Terminal.setTerminal(term)

        Sets the 'selectedTerminal' value in `localStorage` and sends the 'terminal:set_terminal' WebSocket action to the server to let it know which terminal is currently active.

        This function triggers the 'terminal:set_terminal' event passing the terminal number as the only argument.
        */
        var term = parseInt(term); // Sometimes it will be a string
        localStorage[prefix+'selectedTerminal'] = term;
        go.ws.send(JSON.stringify({'terminal:set_terminal': term}));
        E.trigger('terminal:set_terminal', term);
    },
    switchTerminal: function(term) {
        /**:GateOne.Terminal.switchTerminal(term)

        Calls `GateOne.Terminal.setTerminal(*term*)` then triggers the 'terminal:switch_terminal' event passing *term* as the only argument.
        */
        logDebug('switchTerminal('+term+')');
        go.Terminal.setTerminal(term);
        E.trigger('terminal:switch_terminal', term);
    },
    switchTerminalEvent: function(term) {
        /**:GateOne.Terminal.switchTerminalEvent(term)

        This gets attached to the 'terminal:switch_terminal' event in :js:meth:`GateOne.Terminal.init`; performs a number of actions whenever the user changes the current terminal.
        */
        logDebug('switchTerminalEvent('+term+')');
        var termNode = null,
            termTitleH2 = u.getNode('#'+prefix+'termtitle'),
            displayText = "Gate One",
            sideinfo = u.getNode('#'+prefix+'sideinfo'),
            setActivityCheckboxes = function(term) {
                var monitorInactivity = u.getNode('#'+prefix+'monitor_inactivity'),
                    monitorActivity = u.getNode('#'+prefix+'monitor_activity');
                monitorInactivity.checked = go.Terminal.terminals[term]['inactivityTimer']
                monitorActivity.checked = go.Terminal.terminals[term]['activityNotify'];
            };
        if (!go.Terminal.terminals[term]) {
            return;
        }
        termNode = go.Terminal.terminals[term]['terminal'];
        if (termNode) {
            displayText = term + ": " + go.Terminal.terminals[term]['title'];
            termTitleH2.innerHTML = displayText;
            setActivityCheckboxes(term);
        } else {
            return; // This can happen if the terminal closed before a timeout completed.  Not a big deal, ignore
        }
        sideinfo.innerHTML = displayText;
        go.Terminal.displayTermInfo(term);
        if (go.Terminal.alignTimer) {
            clearTimeout(go.Terminal.alignTimer);
            go.Terminal.alignTimer = null;
        }
        go.Terminal.alignTimer = setTimeout(function() {
            go.Terminal.alignTerminal(term);
        }, 1100);
        go.Terminal.Input.capture();
    },
    switchWorkspaceEvent: function(workspace) {
        /**:GateOne.Terminal.switchWorkspaceEvent(workspace)

        Called whenever Gate One switches to a new workspace; checks whether or not this workspace is home to a terminal and calls switchTerminalEvent() on said terminal (to make sure input is enabled and it is scrolled to the bottom).
        */
        logDebug('switchWorkspaceEvent('+workspace+')');
        var termFound = false;
        // TODO: Make this switch to the appropriate terminal when multiple terminals share the same workspace (FUTURE)
        for (var term in go.Terminal.terminals) {
            // Only want terminals which are integers; not the 'count()' function
            if (term % 1 === 0) {
                if (go.Terminal.terminals[term]['workspace'] == workspace) {
                    // At least one terminal is on this workspace
                    go.Terminal.switchTerminal(term);
                    termFound = true;
                }
            }
        };
        if (!termFound) {
            go.Terminal.Input.disableCapture();
            go.Terminal.hideIcons();
        } else {
            go.Terminal.showIcons();
        }
    },
    hideIcons: function() {
        /**:GateOne.Terminal.hideIcons()

        Hides the Terminal's toolbar icons (i.e. when another application is running).
        */
        u.hideElement('#'+prefix+'icon_closeterm');
        u.hideElement('#'+prefix+'icon_info');
        u.hideElement('#'+prefix+'icon_newterm');
    },
    showIcons: function() {
        /**:GateOne.Terminal.showIcons()

        Shows (unhides) the Terminal's toolbar icons (i.e. when another application is running).
        */
        u.showElement('#'+prefix+'icon_closepanel');
        u.showElement('#'+prefix+'icon_closeterm');
        u.showElement('#'+prefix+'icon_info');
        u.showElement('#'+prefix+'icon_newterm');
    },
    bellAction: function(bellObj) {
        /**:GateOne.Terminal.bellAction(bellObj)

        Attached to the 'terminal:bell' WebSocket action; plays a bell sound and pops up a message indiciating which terminal issued a bell.
        */
        var term = bellObj['term'];
        go.Visual.playBell();
        go.Visual.displayMessage("Bell in " + term + ": " + go.Terminal.terminals[term]['title']);
    },
    updateDimensions: function() {
        /**:GateOne.Terminal.updateDimensions()

        This gets attached to the "go:update_dimensions" event which gets called whenever the window is resized.  It makes sure that all the terminal containers are of the correct dimensions.
        */
        var terms = u.toArray(u.getNodes(go.prefs.goDiv + ' .terminal')),
            wrapperDiv = u.getNode('#'+prefix+'gridwrapper');
        if (wrapperDiv) {
            if (terms.length) {
                terms.forEach(function(termObj) {
                    termObj.style.height = go.Visual.goDimensions.h + 'px';
                    termObj.style.width = go.Visual.goDimensions.w + 'px';
                });
            }
        }
    },
    enableScrollback: function(/*Optional*/term) {
        /**:GateOne.Terminal.enableScrollback([term])

        Replaces the contents of the selected/active terminal with the complete screen + scrollback buffer.

        If *term* is given, only disable scrollback for that terminal.
        */
        logDebug('enableScrollback(' + term + ')');
        var u = go.Utils,
            prefix = go.prefs.prefix,
            enableSB = function(termNum) {
                var termPreNode = go.Terminal.terminals[termNum]['node'],
                    termScreen = go.Terminal.terminals[termNum]['screenNode'],
                    termScrollback = go.Terminal.terminals[termNum]['scrollbackNode'],
                    heightAdjust = go.Terminal.terminals[termNum]['heightAdjust'] || 0,
                    parentHeight = termPreNode.parentElement.clientHeight;
                if (!go.Terminal.terminals[termNum]) { // The terminal was just closed
                    return; // We're done here
                }
                if (u.getSelText()) {
                    // Don't re-enable the scrollback buffer if the user is selecting text (so we don't clobber their highlight)
                    // Retry again in 3.5 seconds
                    clearTimeout(go.Terminal.terminals[termNum]['scrollbackTimer']);
                    go.Terminal.terminals[termNum]['scrollbackTimer'] = setTimeout(function() {
                        go.Terminal.enableScrollback(termNum);
                    }, 500);
                    return;
                }
                // Only set the height of the terminal if we could measure it (depending on the CSS the parent element might have a height of 0)
                if (parentHeight) {
                    termPreNode.style.height = (parentHeight - heightAdjust) + 'px';
                } else {
                    termPreNode.style.height = "100%"; // This ensures there's a scrollbar
                }
                if (termScrollback) {
                    var scrollbackHTML = go.Terminal.terminals[termNum]['scrollback'].join('\n') + '\n';
                    if (termScrollback.innerHTML != scrollbackHTML) {
                        termScrollback.innerHTML = scrollbackHTML;
                    }
                    termScrollback.style.display = ''; // Reset
                    u.scrollToBottom(termPreNode);
                } else {
                    // Create the span that holds the scrollback buffer
                    termScrollback = u.createElement('span', {'id': 'term'+termNum+'scrollback', 'class': 'scrollback'});
                    termScrollback.innerHTML = go.Terminal.terminals[termNum]['scrollback'].join('\n') + '\n';
                    termPreNode.insertBefore(termScrollback, termScreen);
                    go.Terminal.terminals[termNum]['scrollbackNode'] = termScrollback;
                    u.scrollToBottom(termPreNode); // Since we just created it for the first time we have to get to the bottom of things, so to speak =)
                }
                if (go.Terminal.terminals[termNum]['scrollbackTimer']) {
                    clearTimeout(go.Terminal.terminals[termNum]['scrollbackTimer']);
                }
                go.Terminal.terminals[termNum]['scrollbackVisible'] = true;
            };
        if (term && term in GateOne.Terminal.terminals) {
            // If there's already an existing scrollback buffer...
                enableSB(term); // Have it create/add the scrollback buffer
        } else {
            var terms = u.toArray(u.getNodes(go.prefs.goDiv + ' .terminal'));
            terms.forEach(function(termObj) {
                var termNum = termObj.id.split(prefix+'term')[1];
                if (termNum in GateOne.Terminal.terminals) {
                    enableSB(termNum);
                }
            });
        }
        go.Terminal.scrollbackToggle = true;
        E.trigger("terminal:scrollback:enabled", term);
    },
    disableScrollback: function(/*Optional*/term) {
        logDebug("disableScrollback()");
        // Replaces the contents of the selected terminal with just the screen (i.e. no scrollback)
        // If *term* is given, only disable scrollback for that terminal
        var u = go.Utils,
            prefix = go.prefs.prefix;
        if (term) {
            var termPreNode = GateOne.Terminal.terminals[term]['node'],
                termScrollback = go.Terminal.terminals[term]['scrollbackNode'];
                if (termScrollback) {
                    termScrollback.style.display = "none";
                }
            go.Terminal.terminals[term]['scrollbackVisible'] = false;
        } else {
            var terms = u.toArray(u.getNodes(go.prefs.goDiv + ' .terminal'));
            terms.forEach(function(termObj) {
                var termID = termObj.id.split(prefix+'term')[1],
                    termScrollback = go.Terminal.terminals[termID]['scrollbackNode'];
                if (termScrollback) {
                    termScrollback.style.display = "none";
                }
                go.Terminal.terminals[termID]['scrollbackVisible'] = false;
            });
        }
        go.Terminal.scrollbackToggle = false;
        E.trigger("terminal:scrollback:disabled", term);
    },
    toggleScrollback: function() {
        /**:GateOne.Terminal.toggleScrollback()

        Enables or disables the scrollback buffer (to hide or show the scrollbars).
        */
        logDebug("toggleScrollback()");
        // Why bother?  The translate() effect is a _lot_ smoother without scrollbars.  Also, full-screen applications that regularly update the screen can really slow down if the entirety of the scrollback buffer must be updated along with the current view.
        var t = GateOne.Terminal;
        if (t.scrollbackToggle) {
            t.enableScrollback();
            t.scrollbackToggle = false;
        } else {
            t.disableScrollback();
            t.scrollbackToggle = true;
        }
    },
    moveTerminalLocation: function(term, location) {
        /**:GateOne.Terminal.moveTerminalLocation(term, location)

        Moves the given *term* to the given *location* (aka window) by sending
        the appropriate message to the Gate One server.
        */
        var settings = {
            'term': term,
            'location': location
        }
        go.ws.send(JSON.stringify({'terminal:move_terminal': settings}));
    },
    reconnectTerminalAction: function(term) {
        /**:GateOne.Terminal.reconnectTerminalAction(term)

        Called when the server reports that the terminal number supplied via 'new_terminal' already exists.
        */
        // NOTE: Might be useful to override if you're embedding Gate One into something else
        logDebug('reconnectTerminalAction(' + term + ')');
        // This gets called when a terminal is moved from one 'location' to another.  When that happens we need to open it up like it's new...
        if (!go.Terminal.terminals[term]) {
            go.Terminal.newTerminal(term);
            go.Terminal.lastTermNumber = term;
            // Assume the user wants to switch to this terminal immediately
            go.Terminal.switchTerminal(term);
        }
    },
    moveTerminalAction: function(obj) {
        /**:GateOne.Terminal.moveTerminalAction(obj)

        Attached to the 'term_moved' WebSocket Action, closes the given *term* with a slightly different message than closeTerminal().
        */
        var term = obj['term'],
            location = obj['location'],
            message = "Terminal " + term + " has been relocated to location, '" + location + "'";
        GateOne.Terminal.closeTerminal(term, null, message);
    },
    reattachTerminalsAction: function(terminals) {
        /**:GateOne.Terminal.reattachTerminalsAction(terminals)

        Called after we authenticate to the server, this function is attached to the 'terminal:terminals' WebSocket action which is the server's way of notifying the client that there are existing terminals.

        If we're reconnecting to an existing session, running terminals will be recreated/reattached.

        If this is a new session (and we're not in embedded mode), a new terminal will be created.
        */
        var newTermSettings,
            cmdQueryString = u.getQueryVariable('terminal_cmd'),
            reattachCallbacks = false;
        logDebug("reattachTerminalsAction() terminals: " + terminals);
        // Clean up localStorage
        for (var key in localStorage) {
            // Clean up old scrollback buffers that aren't attached to terminals anymore:
            if (key.indexOf(prefix+'scrollback') == 0) { // This is a scrollback buffer
                var termNum = parseInt(key.split(prefix+'scrollback')[1]);
                if (terminals.indexOf(termNum) == -1) { // Terminal for this buffer no longer exists
                    logDebug("Deleting scollback buffer for non-existent terminal " + key);
                    delete localStorage[key];
                }
            }
        }
        if (go.Terminal.reattachTerminalsCallbacks.length || "term_reattach" in E.callbacks) {
            reattachCallbacks = true;
        }
        if (!go.prefs.embedded && !reattachCallbacks) { // Only perform the default action if not in embedded mode and there are no registered reattach callbacks.
            if (terminals.length) {
                // Reattach the running terminals
                var selectedMatch = false;
                terminals.forEach(function(termNum) {
                    if (termNum == localStorage[prefix+'selectedTerminal']) {
                        selectedMatch = true;
                        setTimeout(function() {
                            v.switchWorkspace(go.Terminal.terminals[termNum]['workspace']);
                            go.Terminal.switchTerminal(termNum);
                        }, 100); // Without this timeout the code that performs a translateY() to move the scrollback buffer out of view won't work properly
                    }
                    go.Terminal.newTerminal(termNum);
                    go.Terminal.lastTermNumber = termNum;
                });
                if (!selectedMatch) {
                    go.Terminal.switchTerminal(go.Terminal.lastTermNumber);
                }
            } else {
                // Create a new terminal
                go.Terminal.lastTermNumber = 0; // Reset to 0
                setTimeout(function() {
                    go.Terminal.newTerminal();
                }, 1000); // Give everything a moment to settle so the dimensions are set properly
            }
        }
        E.trigger("terminal:term_reattach", terminals);
        if (go.Terminal.reattachTerminalsCallbacks.length) {
            go.Logging.deprecated("reattachTerminalsCallbacks", "Use GateOne.Events.on('terminal:term_reattach', func) instead.");
            // Call any registered callbacks
            go.Terminal.reattachTerminalsCallbacks.forEach(function(callback) {
                callback(terminals);
            });
        }
    },
    modes: {
        // Various functions that will be called when a matching mode is set.
        // NOTE: Most mode settings only apply on the server side of things (which is why this is so short).
        '1': function(term, bool) {
            // Application Cursor Mode
            logDebug("Setting Application Cursor Mode to: " + bool + " on term: " + term);
            if (bool) {
                // Turn on Application Cursor Keys mode
                go.Terminal.terminals[term]['mode'] = 'appmode';
            } else {
                // Turn off Application Cursor Keys mode
                go.Terminal.terminals[term]['mode'] = 'default';
            }
        },
        '1000': function(term, bool) {
            // Use Button Event Mouse Tracking (aka SET_VT200_MOUSE)
            logDebug("Setting Button Motion Event Mouse Tracking Mode to: " + bool + " on term: " + term);
            if (bool) {
                // Turn on Button Event Mouse Tracking
                go.Terminal.terminals[term]['mouse'] = 'mouse_button';
            } else {
                // Turn off Button Event Mouse Tracking
                go.Terminal.terminals[term]['mouse'] = false;
            }
        },
        '1002': function(term, bool) {
            // Use Button Motion Event Mouse Tracking (aka SET_BTN_EVENT_MOUSE)
            logDebug("Setting Button Motion Event Mouse Tracking Mode to: " + bool + " on term: " + term);
            if (bool) {
                // Turn on Button Motion Event Mouse Tracking
                go.Terminal.terminals[term]['mouse'] = 'mouse_button_motion';
            } else {
                // Turn off Button Motion Event Mouse Tracking
                go.Terminal.terminals[term]['mouse'] = false;
            }
        }
    },
    setModeAction: function(modeObj) {
        /**:GateOne.Terminal.setModeAction(modeObj)

        Set the given terminal mode (e.g. application cursor mode aka appmode).  *modeObj* is expected to be something like this::

            {'mode': '1', 'term': '1', 'bool': true}
        */
        logDebug("setModeAction modeObj: " + GateOne.Utils.items(modeObj));
        if (go.Terminal.modes[modeObj.mode]) {
            go.Terminal.modes[modeObj.mode](modeObj.term, modeObj.bool);
        }
    },
    registerTextTransform: function(name, pattern, newString) {
        /**:GateOne.Terminal.registerTextTransform(name, pattern, newString)

        Adds a new or replaces an existing text transformation to GateOne.Terminal.textTransforms using *pattern* and *newString* with the given *name*.  Example::

             var pattern = /(\bIM\d{9,10}\b)/g,
                 newString = "<a href='https://support.company.com/tracker?ticket=$1' target='new'>$1</a>";
             GateOne.Terminal.registerTextTransform("ticketIDs", pattern, newString);

        Would linkify text matching that pattern in the terminal.

        For example, if you typed "Ticket number: IM123456789" into a terminal it would be transformed thusly::

             "Ticket number: <a href='https://support.company.com/tracker?ticket=IM123456789' target='new'>IM123456789</a>"

        Alternatively, a function may be provided instead of *pattern*.  In this case, each line will be transformed like so::

             line = pattern(line);

        .. note: *name* is only used for reference purposes in the textTransforms object.
        */
        var go = GateOne,
            t = go.Terminal;
        if (typeof(pattern) == "object" || typeof(pattern) == "function") {
            pattern = pattern.toString(); // Have to convert it to a string so we can pass it to the Web Worker so Firefox won't freak out
        }
        t.textTransforms[name] = {};
        t.textTransforms[name]['name'] = name;
        t.textTransforms[name]['pattern'] = pattern;
        t.textTransforms[name]['newString'] = newString;
    },
    unregisterTextTransform: function(name) {
        /**:GateOne.Terminal.unregisterTextTransform(name)

            Removes the given text transform from `GateOne.Terminal.textTransforms`.
        */
        delete GateOne.Terminal.textTransforms[name];
    },
    resetTerminalAction: function(term) {
        /**:GateOne.Terminal.resetTerminalAction(term)

        Clears the screen and the scrollback buffer of the given *term* (in memory and in localStorage).
        */
        var prefix = go.prefs.prefix;
        logDebug("resetTerminalAction term: " + term);
        go.Terminal.terminals[term]['scrollback'] = [];
        go.Terminal.terminals[term]['screen'] = [];
        localStorage[prefix+"scrollback" + term] = '';
    },
    termEncodingAction: function(message) {
        /**:GateOne.Terminal.termEncodingAction(message)

        Handles the 'terminal:encoding' WebSocket action that tells us the encoding that is set for a given terminal.  The expected message format:

        :param string message['term']: The terminal in question.
        :param string message['encoding']: The encoding to set on the given terminal.

        .. note:: The encoding value here is only used for informational purposes.  No encoding/decoding happens at the client.
        */
        var term = message['term'],
            encoding = message['encoding'];
        go.Terminal.terminals[term]['encoding'] = encoding;
    },
    xtermEncode: function(number) {
        /**:GateOne.Terminal.xtermEncode(number)

        Encodes the given *number* into a single character using xterm's encoding scheme.  e.g. to convert mouse coordinates for use in an escape sequence.

        The xterm encoding scheme takes the ASCII value of (*number* + 32).  So the number one would be ! (exclamation point), the number two would be " (double-quote), the number three would be # (hash), and so on.

        .. note:: This encoding mechansim has the unfortunate limitation of only being able to encode up to the number 233.
        */
        return String.fromCharCode(number+32);
    }
});

})(window);
