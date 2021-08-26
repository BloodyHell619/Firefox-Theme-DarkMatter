// ==UserScript==
// @name           Vertical Tabs Pane
// @version        1.3.7
// @author         aminomancer
// @homepage       https://github.com/aminomancer/uc.css.js
// @description    Create a vertical pane across from the sidebar that functions like the vertical tab pane in Microsoft Edge. It doesn't hide the tab bar since people have different preferences on how to do that, but it sets an attribute on the root element that you can use to hide the regular tab bar while the vertical pane is open, for example :root[vertical-tabs] #TabsToolbar... By default, the pane is resizable just like the sidebar is. And like the pane in Edge, you can press a button to collapse it, and it will hide the tab labels and become a thin strip that just shows the tabs' favicons. Hovering the collapsed pane will expand it without moving the browser content. As with the [vertical-tabs] attribute, this "unpinned" state is reflected on the root element, so you can select it like :root[vertical-tabs-unpinned]... Like the sidebar, the state of the pane is stored between windows and recorded in preferences. There's no need to edit these preferences directly. There are a few other preferences that can be edited in about:config, but they can all be changed on the fly by opening the context menu within the pane. The new tab button and the individual tabs all have their own context menus, but right-clicking anything else will open the pane's context menu, which has options for changing these preferences. "Move Pane to Right/Left" will change which side the pane (and by extension, the sidebar) is displayed on, relative to the browser content. Since the pane always mirrors the position of the sidebar, moving the pane to the right will move the sidebar to the left, and vice versa. "Reverse Tab Order" changes the direction of the pane so that newer tabs are displayed on top rather than on bottom. "Expand Pane on Hover/Focus" causes the pane to expand on hover when it's collapsed. When you collapse the pane with the unpin button, it collapses to a small width and then temporarily expands if you hover it, after a delay of 100ms. Then when your mouse leaves the pane, it collapses again, after a delay of 100ms. Both of these delays can be changed with the "Configure Hover Delay" and "Configure Hover Out Delay" options in the context menu, or in about:config. For languages other than English, the labels and tooltips can be modified directly in the l10n object below.
// ==/UserScript==

(function () {
    let config = {
        l10n: {
            "Button label": `Vertical Tabs`, // label and tooltip for the toolbar button
            "Button tooltip": `Toggle vertical tabs`,
            "Collapse button tooltip": `Collapse pane`,
            "Pin button tooltip": `Pin pane`,
            // labels for the context menu
            context: {
                "Move Pane to Right": "Move Pane to Right",
                "Move Pane to Left": "Move Pane to Left",
                "Expand Pane": "Expand Pane on Hover/Focus",
                "Reverse Tab Order": "Reverse Tab Order",
                "Configure Hover Delay": "Configure Hover Delay",
                "Configure Hover Out Delay": "Configure Hover Out Delay",
            },
            // strings for the hover delay config prompt
            prompt: {
                "Hover delay title": "Hover delay (in milliseconds)",
                "Hover delay description":
                    "How long should the collapsed pane wait before expanding?",
                "Hover out delay title": "Hover out delay (in milliseconds)",
                "Hover out delay description":
                    "How long should the expanded pane wait before collapsing?",
                "Invalid": "Invalid input!",
                "Invalid description": "This preference must be a positive integer.",
            },
        },
    };
    if (location.href !== "chrome://browser/content/browser.xhtml") return;
    let prefSvc = Services.prefs;
    let closedPref = "userChrome.tabs.verticalTabsPane.closed";
    let unpinnedPref = "userChrome.tabs.verticalTabsPane.unpinned";
    let noExpandPref = "userChrome.tabs.verticalTabsPane.no-expand-on-hover";
    let widthPref = "userChrome.tabs.verticalTabsPane.width";
    let reversePref = "userChrome.tabs.verticalTabsPane.reverse-order";
    let hoverDelayPref = "userChrome.tabs.verticalTabsPane.hover-delay";
    let hoverOutDelayPref = "userChrome.tabs.verticalTabsPane.hover-out-delay";
    /**
     * create a DOM node with given parameters
     * @param {object} aDoc (which document to create the element in)
     * @param {string} tag (an HTML tag name, like "button" or "p")
     * @param {object} props (an object containing attribute name/value pairs, e.g. class: ".bookmark-item")
     * @param {boolean} isHTML (if true, create an HTML element. if omitted or false, create a XUL element. generally avoid HTML when modding the UI, most UI elements are actually XUL elements.)
     * @returns the created DOM node
     */
    function create(aDoc, tag, props, isHTML = false) {
        let el = isHTML ? aDoc.createElement(tag) : aDoc.createXULElement(tag);
        for (let prop in props) {
            el.setAttribute(prop, props[prop]);
        }
        return el;
    }
    /**
     * set or remove multiple attributes for a given node
     * @param {object} el (a DOM node)
     * @param {object} attrs (an object of attribute name/value pairs)
     * @returns the DOM node
     */
    function setAttributes(el, attrs) {
        for (let [name, value] of Object.entries(attrs))
            if (value) el.setAttribute(name, value);
            else el.removeAttribute(name);
    }
    class VerticalTabsPaneBase {
        static preferences = [
            { name: closedPref, value: false },
            { name: unpinnedPref, value: false },
            { name: noExpandPref, value: false },
            { name: widthPref, value: 350 },
            { name: reversePref, value: false },
            { name: hoverDelayPref, value: 100 },
            { name: hoverOutDelayPref, value: 100 },
        ];
        constructor() {
            this.preferences = VerticalTabsPaneBase.preferences;
            this.registerSheet();
            // ensure E10SUtils are available. required for showing tab's process ID in its tooltip, if the pref for that is enabled.
            if (!window.E10SUtils)
                XPCOMUtils.defineLazyModuleGetters(this, {
                    E10SUtils: `resource://gre/modules/E10SUtils.jsm`,
                });
            else this.E10SUtils = window.E10SUtils;
            // build the DOM
            this.pane = document.getElementById("vertical-tabs-pane");
            this.splitter = document.getElementById("vertical-tabs-splitter");
            this.contextMenu = document.getElementById("mainPopupSet").appendChild(
                create(document, "menupopup", {
                    id: "vertical-tabs-context-menu",
                })
            );
            this.innerBox = this.pane.appendChild(
                create(document, "vbox", {
                    id: "vertical-tabs-inner-box",
                    context: "vertical-tabs-context-menu",
                })
            );
            this.buttonsRow = this.innerBox.appendChild(
                create(document, "hbox", {
                    id: "vertical-tabs-buttons-row",
                })
            );
            this.contextMenu._menuitemPosition = this.contextMenu.appendChild(
                create(document, "menuitem", {
                    id: "vertical-tabs-context-position",
                    label: config.l10n.context["Move Pane to Right"],
                    oncommand: `Services.prefs.setBoolPref(SidebarUI.POSITION_START_PREF, true);`,
                })
            );
            this.contextMenu._menuitemExpand = this.contextMenu.appendChild(
                create(document, "menuitem", {
                    id: "vertical-tabs-context-expand",
                    label: config.l10n.context["Expand Pane"],
                    type: "checkbox",
                    oncommand: `Services.prefs.setBoolPref("userChrome.tabs.verticalTabsPane.no-expand-on-hover", !this.getAttribute("checked"));`,
                })
            );
            this.contextMenu._menuitemReverse = this.contextMenu.appendChild(
                create(document, "menuitem", {
                    id: "vertical-tabs-context-reverse",
                    label: config.l10n.context["Reverse Tab Order"],
                    type: "checkbox",
                    oncommand: `Services.prefs.setBoolPref("userChrome.tabs.verticalTabsPane.reverse-order", this.getAttribute("checked"));`,
                })
            );
            this.contextMenu._menuitemHoverDelay = this.contextMenu.appendChild(
                create(document, "menuitem", {
                    id: "vertical-tabs-context-hover-delay",
                    label: config.l10n.context["Configure Hover Delay"],
                    oncommand: `verticalTabsPane.promptForIntPref("userChrome.tabs.verticalTabsPane.hover-delay")`,
                })
            );
            this.contextMenu._menuitemHoverOutDelay = this.contextMenu.appendChild(
                create(document, "menuitem", {
                    id: "vertical-tabs-context-hover-out-delay",
                    label: config.l10n.context["Configure Hover Out Delay"],
                    oncommand: `verticalTabsPane.promptForIntPref("userChrome.tabs.verticalTabsPane.hover-out-delay")`,
                })
            );
            // tab stops let us focus elements in the tabs pane by hitting tab to cycle through toolbars, just as in vanilla firefox.
            this.buttonsTabStop = this.buttonsRow.appendChild(
                create(document, "toolbartabstop", { "aria-hidden": true })
            );
            this.newTabButton = this.buttonsRow.appendChild(
                document.getElementById("new-tab-button").cloneNode(true)
            );
            this.newTabButton.id = "vertical-tabs-new-tab-button";
            this.newTabButton.setAttribute("flex", "1");
            this.newTabButton.setAttribute("class", "subviewbutton subviewbutton-iconic");
            this.newTabButton.tooltipText = GetDynamicShortcutTooltipText("new-tab-button");
            this.pinPaneButton = this.buttonsRow.appendChild(
                create(document, "toolbarbutton", {
                    id: "vertical-tabs-pin-button",
                    class: "subviewbutton subviewbutton-iconic no-label",
                    tooltiptext: config.l10n["Collapse button tooltip"],
                })
            );
            this.pinPaneButton.addEventListener("command", (e) => {
                this.pane.getAttribute("unpinned")
                    ? this.pane.removeAttribute("unpinned")
                    : this.unpin();
                this.resetPinnedTooltip();
            });
            this.closePaneButton = this.buttonsRow.appendChild(
                create(document, "toolbarbutton", {
                    id: "vertical-tabs-close-button",
                    class: "subviewbutton subviewbutton-iconic no-label",
                    tooltiptext: config.l10n["Button tooltip"],
                })
            );
            this.closePaneButton.addEventListener("command", (e) => this.toggle());
            this.innerBox.appendChild(create(document, "toolbarseparator"));
            this.containerNode = this.innerBox.appendChild(
                create(document, "arrowscrollbox", {
                    id: "vertical-tabs-list",
                    tooltip: "vertical-tabs-tooltip",
                    context: "tabContextMenu",
                    orient: "vertical",
                    flex: "1",
                })
            );
            // build a modified clone of the built-in tabs tooltip for use in the pane.
            let vanillaTooltip = document.getElementById("tabbrowser-tab-tooltip");
            this.tabTooltip = vanillaTooltip.cloneNode(true);
            vanillaTooltip.after(this.tabTooltip);
            this.tabTooltip.id = "vertical-tabs-tooltip";
            this.tabTooltip.setAttribute(
                "onpopupshowing",
                `verticalTabsPane.createTabTooltip(event)`
            );
            this.scrollboxTabStop = this.containerNode.appendChild(
                create(document, "toolbartabstop", { "aria-hidden": true })
            );
            // this is a map of all the rows, and you can get a specific row from it by passing a tab (like a real <tab> element from the built-in tab bar)
            this.tabToElement = new Map();
            this.listenersRegistered = false;
            // set up preferences if they don't already exist
            this.preferences.forEach((pref) => {
                if (!prefSvc.prefHasUserValue(pref.name))
                    prefSvc[`set${typeof pref.value === "number" ? "Int" : "Bool"}Pref`](
                        pref.name,
                        pref.value
                    );
            });
            prefSvc.addObserver("userChrome.tabs.verticalTabsPane", this);
            prefSvc.addObserver("privacy.userContext", this);
            prefSvc.addObserver(SidebarUI.POSITION_START_PREF, this);
            // re-initialize the sidebar's positionstart pref callback since we changed it earlier at the bottom to make it also move the vertical tabs pane.
            XPCOMUtils.defineLazyPreferenceGetter(
                SidebarUI,
                "_positionStart",
                SidebarUI.POSITION_START_PREF,
                true,
                SidebarUI.setPosition.bind(SidebarUI)
            );
            // destroy the scrollbuttons.
            ["#scrollbutton-up", "#scrollbutton-down"].forEach((id) =>
                this.containerNode.shadowRoot.querySelector(id).remove()
            );
            this.l10nIfNeeded();
            // the pref observer changes stuff in the script when the pref is changed.
            // but when the script initially starts, the prefs haven't been changed so that logic isn't immediately invoked.
            // we have to invoke it manually, as if the prefs had been changed.
            let readPref = (pref) => this.observe(prefSvc, null, pref);
            readPref(noExpandPref);
            readPref(hoverDelayPref);
            readPref(hoverOutDelayPref);
            if (!this.hoverDelay) this.hoverDelay = 100;
            if (!this.hoverOutDelay) this.hoverOutDelay = 100;
            // some of the stuff we don't want to do until the first tab has been loaded.
            gBrowser.tabContainer.addEventListener(
                "SSTabRestoring",
                (e) => {
                    readPref(reversePref);
                    readPref("privacy.userContext.enabled");
                    readPref(SidebarUI.POSITION_START_PREF);
                    // try to adopt from previous window, otherwise restore from prefs.
                    let sourceWindow = window.opener;
                    if (sourceWindow)
                        if (
                            !sourceWindow.closed &&
                            sourceWindow.location.protocol == "chrome:" &&
                            PrivateBrowsingUtils.isWindowPrivate(sourceWindow) ===
                                PrivateBrowsingUtils.isWindowPrivate(window)
                        )
                            if (this.adoptFromWindow(sourceWindow)) return;
                    readPref(widthPref);
                    readPref(unpinnedPref);
                    readPref(closedPref);
                },
                { once: true }
            );
        }
        // get the root element, e.g. what you'd select in CSS with :root
        get root() {
            return this._root || (this._root = document.documentElement);
        }
        // return all the DOM nodes for tab rows in the pane.
        get rows() {
            return this.tabToElement.values();
        }
        // return the row for the active/selected tab.
        get selectedRow() {
            return this.containerNode.querySelector(".all-tabs-item[selected]");
        }
        // all of these events will be listened for on the pane itself
        get paneEvents() {
            return this._paneEvents || (this._paneEvents = ["mouseenter", "mouseleave", "focus"]);
        }
        // these events target the containerNode — the arrowscrollbox
        get dragEvents() {
            return (
                this._dragEvents ||
                (this._dragEvents = ["dragstart", "dragleave", "dragover", "drop", "dragend"])
            );
        }
        // these events target the vanilla tab bar, gBrowser.tabContainer
        get tabEvents() {
            return (
                this._tabEvents ||
                (this._tabEvents = [
                    "TabAttrModified",
                    "TabClose",
                    "TabMove",
                    "TabPinned",
                    "TabUnpinned",
                    "TabSelect",
                    "TabBrowserDiscarded",
                ])
            );
        }
        // this creates (and caches) a tree walker. tree walkers are basically interfaces for finding nodes in order.
        // we get to specify which direction we're looking in, forward or backward, and we get to specify a filter function that rules out types of elements.
        // this one accepts tabstops, buttons, toolbarbuttons, and checkboxes, but rules out disabled or hidden nodes, and rules out everything else.
        // this is what tells us which element to focus when pressing the right/left arrow keys.
        get horizontalWalker() {
            if (this._horizontalWalker) return this._horizontalWalker;
            return (this._horizontalWalker = document.createTreeWalker(
                this.pane,
                NodeFilter.SHOW_ELEMENT,
                (node) => {
                    if (node.tagName == "toolbartabstop") return NodeFilter.FILTER_ACCEPT;
                    if (node.disabled || node.hidden) return NodeFilter.FILTER_REJECT;
                    if (
                        node.tagName == "button" ||
                        node.tagName == "toolbarbutton" ||
                        node.tagName == "checkbox"
                    ) {
                        if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_SKIP;
                }
            ));
        }
        // this one tells us which element to focus when pressing the up/down arrow keys.
        // it's just like the other but it skips secondary buttons. (mute and close buttons)
        // this way we can arrow up/down to navigate through tabs very quickly, and arrow left/right to focus the mute and close buttons.
        get verticalWalker() {
            if (this._verticalWalker) return this._verticalWalker;
            return (this._verticalWalker = document.createTreeWalker(
                this.pane,
                NodeFilter.SHOW_ELEMENT,
                (node) => {
                    if (node.tagName == "toolbartabstop") return NodeFilter.FILTER_ACCEPT;
                    if (node.disabled || node.hidden) return NodeFilter.FILTER_REJECT;
                    if (
                        node.tagName == "button" ||
                        node.tagName == "toolbarbutton" ||
                        node.tagName == "checkbox"
                    ) {
                        if (node.classList.contains("all-tabs-secondary-button"))
                            return NodeFilter.FILTER_SKIP;
                        if (!node.hasAttribute("tabindex")) node.setAttribute("tabindex", "-1");
                        return NodeFilter.FILTER_ACCEPT;
                    }
                    return NodeFilter.FILTER_SKIP;
                }
            ));
        }
        /**
         * this tells us which tabs to not make rows for. in this case we only exclude hidden tabs.
         * tabs are normally only hidden by certain extensions, e.g. an addon that makes tab groups.
         * @param {object} tab (a <tab> element from the vanilla tab bar)
         * @returns {boolean} false if the tab should be excluded from the vertical tabs pane
         */
        filterFn(tab) {
            return !tab.hidden;
        }

        /**
         * get the initial state for the pane from a previous window. this is what happens when you open a new window (not the first window of a session)
         * @param {object} sourceWindow (a window object, the window from which the new window was opened)
         * @returns {boolean} true if state was successfully restored from source window, false if state must be restored from preferences.
         */
        adoptFromWindow(sourceWindow) {
            let sourceUI = sourceWindow.verticalTabsPane;
            if (!sourceUI || !sourceUI.pane) return false;
            this.pane.setAttribute(
                "width",
                sourceUI.pane.width || sourceUI.pane.getBoundingClientRect().width
            );
            let sourcePinned = !!sourceUI.pane.getAttribute("unpinned");
            sourcePinned ? this.unpin() : this.pane.removeAttribute("unpinned");
            sourcePinned
                ? this.root.setAttribute("vertical-tabs-unpinned", true)
                : this.root.removeAttribute("vertical-tabs-unpinned");
            this.resetPinnedTooltip();
            sourceUI.pane.hidden ? this.close() : this.open();
            return true;
        }
        /**
         * for a given descendant of a tab row, return the actual tab row element.
         * @param {object} el (a DOM node contained within a tab row)
         * @returns the ancestor tab row
         */
        findRow(el) {
            return el.classList.contains("all-tabs-item") ? el : el.closest(".all-tabs-item");
        }
        // change the pin/unpin button's tooltip so it reflects the current state.
        // if the pane is pinned, the button should say "Collapse pane" and if it's unpinned it should say "Pin pane"
        resetPinnedTooltip() {
            let newVal = this.pane.getAttribute("unpinned");
            this.pinPaneButton.tooltipText =
                config.l10n[newVal ? "Pin button tooltip" : "Collapse button tooltip"];
        }
        promptForIntPref(pref) {
            let val, title, text;
            switch (pref) {
                case hoverDelayPref:
                    val = this.hoverDelay ?? 100;
                    title = config.l10n.prompt["Hover delay title"];
                    text = config.l10n.prompt["Hover delay description"];
                    break;
                case hoverOutDelayPref:
                    val = this.hoverOutDelay ?? 100;
                    title = config.l10n.prompt["Hover out delay title"];
                    text = config.l10n.prompt["Hover out delay description"];
                    break;
            }
            let input = { value: val };
            let win = Services.wm.getMostRecentWindow(null);
            let ok = Services.prompt.prompt(win, title, text, input, null, { value: 0 });
            if (!ok) return;
            let int = parseInt(input.value, 10);
            let onFail = () => {
                Services.prompt.alert(
                    win,
                    config.l10n.prompt.Invalid,
                    config.l10n.prompt["Invalid description"]
                );
                this.promptForIntPref(pref);
            };
            if (!(int >= 0)) return onFail();
            else
                try {
                    prefSvc.setIntPref(pref, int);
                } catch (e) {
                    return onFail();
                }
        }
        /**
         * universal event handler — we generally pass the whole class to addEventListener and let this function decide which callback to invoke.
         * @param {object} e (an event object)
         */
        handleEvent(e) {
            let tab = e.target.tab;
            switch (e.type) {
                case "mousedown":
                    this._onMouseDown(e, tab);
                    break;
                case "mouseup":
                    this._onMouseUp(e, tab);
                    break;
                case "click":
                    this._onClick(e);
                    break;
                case "command":
                    this._onCommand(e, tab);
                    break;
                case "mouseover":
                    this._warmupRowTab(e, tab);
                    break;
                case "mouseenter":
                    this._onMouseEnter(e);
                    break;
                case "mouseleave":
                    this._onMouseLeave(e);
                    break;
                case "TabAttrModified":
                case "TabPinned":
                case "TabUnpinned":
                case "TabBrowserDiscarded":
                    this._tabAttrModified(e.target);
                    break;
                case "TabClose":
                    this._tabClose(e.target);
                    break;
                case "TabMove":
                    this._moveTab(e.target);
                    break;
                case "dragstart":
                    this._onDragStart(e, tab);
                    break;
                case "dragleave":
                    this._onDragLeave(e);
                    break;
                case "dragover":
                    this._onDragOver(e);
                    break;
                case "dragend":
                    this._onDragEnd(e);
                    break;
                case "drop":
                    this._onDrop(e);
                    break;
                case "keydown":
                    this._onKeyDown(e);
                    break;
                case "focus":
                    this._onFocus(e);
                    break;
                case "blur":
                    e.currentTarget === this.pane ? this._onPaneBlur(e) : this._onButtonBlur(e);
                    break;
                case "TabMultiSelect":
                    this._onTabMultiSelect();
                    break;
                case "TabSelect":
                    if (this.isOpen)
                        this.tabToElement.get(e.target).scrollIntoView({ block: "nearest" });
                    break;
            }
        }
        /**
         * universal preference observer. when a preference is changed, do something about it.
         * @param {object} sub (an object with nsIPrefBranch interface — reflects the preference branch we're watching, or just the root)
         * @param {string} _top (the topic "nsPref:changed" is always passed to our observer, but we don't use it)
         * @param {string} pref (the preference that changed)
         */
        observe(sub, _top, pref) {
            let value = this.getPref(sub, pref);
            switch (pref) {
                case widthPref:
                    if (value === null) value = 350;
                    this.pane.width = value;
                    break;
                case closedPref:
                    value ? this.close() : this.open();
                    break;
                case unpinnedPref:
                    value ? this.unpin() : this.pane.removeAttribute("unpinned");
                    value
                        ? this.root.setAttribute("vertical-tabs-unpinned", true)
                        : this.root.removeAttribute("vertical-tabs-unpinned");
                    this.resetPinnedTooltip();
                    break;
                case noExpandPref:
                    this.noExpand = value;
                    if (value) {
                        this.pane.setAttribute("no-expand", true);
                        this.pane.removeAttribute("expanded");
                        this.contextMenu._menuitemExpand.removeAttribute("checked");
                    } else {
                        this.pane.removeAttribute("no-expand");
                        this.contextMenu._menuitemExpand.setAttribute("checked", true);
                    }
                    break;
                case reversePref:
                    this.reversed = value;
                    if (this.isOpen) {
                        for (let item of this.rows) item.remove();
                        this.tabToElement = new Map();
                        this._populate();
                    }
                    if (value) this.contextMenu._menuitemReverse.setAttribute("checked", true);
                    else this.contextMenu._menuitemReverse.removeAttribute("checked");
                    break;
                case hoverDelayPref:
                    this.hoverDelay = value ?? 100;
                    break;
                case hoverOutDelayPref:
                    this.hoverOutDelay = value ?? 100;
                case "privacy.userContext.enabled":
                case "privacy.userContext.newTabContainerOnLeftClick.enabled":
                    this.handlePrivacyChange();
                    break;
                case SidebarUI.POSITION_START_PREF:
                    let menuitem = this.contextMenu._menuitemPosition;
                    if (value) {
                        menuitem.label = config.l10n.context["Move Pane to Left"];
                        menuitem.setAttribute(
                            "oncommand",
                            `Services.prefs.setBoolPref(SidebarUI.POSITION_START_PREF, false);`
                        );
                    } else {
                        menuitem.label = config.l10n.context["Move Pane to Right"];
                        menuitem.setAttribute(
                            "oncommand",
                            `Services.prefs.setBoolPref(SidebarUI.POSITION_START_PREF, true);`
                        );
                    }
                    break;
            }
        }
        /**
         * for a given preference, get its value, regardless of the preference type.
         * @param {object} root (an object with nsIPrefBranch interface — reflects the preference branch we're watching, or just the root)
         * @param {string} pref (a preference string)
         * @returns the preference's value
         */
        getPref(root, pref) {
            switch (root.getPrefType(pref)) {
                case root.PREF_BOOL:
                    return root.getBoolPref(pref);
                case root.PREF_INT:
                    return root.getIntPref(pref);
                case root.PREF_STRING:
                    return root.getStringPref(pref);
                default:
                    return null;
            }
        }
        toggle() {
            this.isOpen ? this.close() : this.open();
        }
        open() {
            this.pane.hidden = this.splitter.hidden = false;
            this.pane.setAttribute("checked", true);
            this.isOpen = true;
            this.root.setAttribute("vertical-tabs", true);
            if (!this.listenersRegistered) this._populate();
        }
        close() {
            if (this.pane.contains(document.activeElement)) document.activeElement.blur();
            this.pane.hidden = this.splitter.hidden = true;
            this.pane.removeAttribute("checked");
            this.isOpen = false;
            this.root.setAttribute("vertical-tabs", false);
            this._cleanup();
        }
        // set the active tab
        _selectTab(tab) {
            if (gBrowser.selectedTab != tab) gBrowser.selectedTab = tab;
            else gBrowser.tabContainer._handleTabSelect();
        }
        // fill the pane with tab rows
        _populate() {
            let fragment = document.createDocumentFragment();
            for (let tab of gBrowser.tabs)
                if (this.filterFn(tab))
                    fragment[this.reversed ? `prepend` : `appendChild`](this._createRow(tab));
            this._addElement(fragment);
            this._setupListeners();
            for (let row of this.rows) this._setImageAttributes(row, row.tab);
            this.selectedRow.scrollIntoView({ block: "nearest", behavior: "instant" });
        }
        /**
         * add an element to the tab container/arrowscrollbox
         * @param {object} elementOrFragment (a DOM element or document fragment to add to the container)
         */
        _addElement(elementOrFragment) {
            this.containerNode.insertBefore(elementOrFragment, this.insertBefore);
        }
        // invoked when closing the pane. set everything back to default.
        _cleanup() {
            for (let item of this.rows) item.remove();
            this.tabToElement = new Map();
            this._cleanupListeners();
            clearTimeout(this.hoverOutTimer);
            clearTimeout(this.hoverTimer);
            this.hoverOutQueued = false;
            this.hoverQueued = false;
            this.pane.removeAttribute("expanded");
        }
        // invoked when opening the pane. add all the event listeners.
        // this way the script is less wasteful when the pane is closed.
        _setupListeners() {
            this.listenersRegistered = true;
            this.tabEvents.forEach((ev) => gBrowser.tabContainer.addEventListener(ev, this));
            this.dragEvents.forEach((ev) => this.containerNode.addEventListener(ev, this));
            this.paneEvents.forEach((ev) => this.pane.addEventListener(ev, this));
            if (gToolbarKeyNavEnabled) this.pane.addEventListener("keydown", this);
            this.pane.addEventListener("blur", this, true);
            gBrowser.addEventListener("TabMultiSelect", this, false);
            for (let stop of this.pane.getElementsByTagName("toolbartabstop")) {
                stop.setAttribute("aria-hidden", "true");
                stop.addEventListener("focus", this);
            }
        }
        // invoked when closing the pane. clear all the aforementioned event listeners.
        _cleanupListeners() {
            this.tabEvents.forEach((ev) => gBrowser.tabContainer.removeEventListener(ev, this));
            this.dragEvents.forEach((ev) => this.containerNode.removeEventListener(ev, this));
            this.paneEvents.forEach((ev) => this.pane.removeEventListener(ev, this));
            this.pane.removeEventListener("keydown", this);
            this.pane.addEventListener("blur", this, true);
            gBrowser.removeEventListener("TabMultiSelect", this, false);
            for (let stop of this.pane.getElementsByTagName("toolbartabstop")) {
                stop.removeEventListener("focus", this);
            }
            this.listenersRegistered = false;
        }
        /**
         * callback when a tab attribute is modified. a response to the TabAttrModified custom event dispatched by gBrowser.
         * this is what we use to update most of the tab attributes, like busy, soundplaying, etc.
         * @param {object} tab (a tab element from the real tab bar)
         */
        _tabAttrModified(tab) {
            let item = this.tabToElement.get(tab);
            if (item) {
                if (!this.filterFn(tab)) this._removeItem(item, tab);
                else this._setRowAttributes(item, tab);
            } else if (this.filterFn(tab)) this._addTab(tab);
        }
        /**
         * the key implies that we're moving a tab, but this doesn't tell us where to move the tab to.
         * in reality, this just removes a tab and adds it back. it simply gets called when a tab gets moved by other means,
         * so we delete the row and _addTab places it in the same position as its corresponding tab.
         * meaning we can't actually move a tab this way, this just helps the tabs pane mirror the real tab bar.
         * @param {object} tab (a tab element)
         */
        _moveTab(tab) {
            let item = this.tabToElement.get(tab);
            if (item) {
                this._removeItem(item, tab);
                this._addTab(tab);
                this.selectedRow.scrollIntoView({ block: "nearest" });
            }
        }
        /**
         * invoked by the above functions. if a tab's attributes change and it's somehow not in the pane already, add it.
         * this adds a dom node for a given tab and places it in a position reflecting the tab's real position.
         * @param {object} newTab (a tab element that's not already in the pane)
         */
        _addTab(newTab) {
            if (!this.filterFn(newTab)) return;
            let newRow = this._createRow(newTab);
            let nextTab = newTab.nextElementSibling;
            while (nextTab && !this.filterFn(nextTab)) nextTab = nextTab.nextElementSibling;
            let nextRow = this.tabToElement.get(nextTab);
            if (this.reversed) {
                if (nextRow) nextRow.after(newRow);
                else this.containerNode.prepend(newRow);
            } else {
                if (nextRow) nextRow.parentNode.insertBefore(newRow, nextRow);
                else this._addElement(newRow);
            }
        }
        /**
         * invoked when a tab is closed from outside the pane. since the tab no longer exists, remove it from the pane.
         * @param {object} tab (a tab element)
         */
        _tabClose(tab) {
            let item = this.tabToElement.get(tab);
            if (item) this._removeItem(item, tab);
        }
        /**
         * remove a tab/item pair from the map, and remove the item from the DOM.
         * @param {object} item (a row element, e.g. with class all-tabs-item)
         * @param {object} tab (a corresponding tab element — every all-tabs-item has a reference to its corresponding tab in property "tab")
         */
        _removeItem(item, tab) {
            this.tabToElement.delete(tab);
            item.remove();
        }
        /**
         * for a given tab, create a row in the pane's container.
         * @param {object} tab (a tab element)
         * @returns a row element
         */
        _createRow(tab) {
            let row = create(document, "toolbaritem", {
                class: "all-tabs-item",
                draggable: true,
            });
            if (this.className) row.classList.add(this.className);
            row.tab = tab;
            row.addEventListener("command", this);
            row.addEventListener("mousedown", this);
            row.addEventListener("mouseup", this);
            row.addEventListener("click", this);
            row.addEventListener("mouseover", this);
            this.tabToElement.set(tab, row);

            // main button
            let button = row.appendChild(
                create(document, "toolbarbutton", {
                    class: "all-tabs-button subviewbutton subviewbutton-iconic",
                    flex: "1",
                    crop: "right",
                })
            );
            button.tab = tab;

            // audio button
            let audioButton = row.appendChild(
                create(document, "toolbarbutton", {
                    class: "all-tabs-secondary-button subviewbutton subviewbutton-iconic",
                    closemenu: "none",
                    "toggle-mute": "true",
                })
            );
            audioButton.tab = tab;

            // close button
            let closeButton = row.appendChild(
                create(document, "toolbarbutton", {
                    class: "all-tabs-secondary-button subviewbutton subviewbutton-iconic",
                    "close-button": "true",
                })
            );
            closeButton.tab = tab;

            this._setRowAttributes(row, tab);
            return row;
        }
        /**
         * for a given row/tab pair, set the row's attributes equal to the tab's.
         * this gets invoked on various events whereupon we need to update a row's display
         * @param {object} row (a row element)
         * @param {object} tab (a tab element)
         */
        _setRowAttributes(row, tab) {
            // attributes to set on the row
            setAttributes(row, {
                selected: tab.selected,
                pinned: tab.pinned,
                pending: tab.getAttribute("pending"),
                multiselected: tab.getAttribute("multiselected"),
                muted: tab.muted,
                soundplaying: tab.soundPlaying,
                notselectedsinceload: tab.getAttribute("notselectedsinceload"),
            });
            // we need to use classes for the usercontext/container, since the built-in CSS that sets the identity color & icon uses classes, not attributes.
            if (tab.userContextId) {
                let idColor = ContextualIdentityService.getPublicIdentityFromId(
                    tab.userContextId
                )?.color;
                row.className = idColor
                    ? `all-tabs-item identity-color-${idColor}`
                    : "all-tabs-item";
                row.setAttribute("usercontextid", tab.userContextId);
            } else {
                row.className = "all-tabs-item";
                row.removeAttribute("usercontextid");
            }

            // set attributes on the main button, in particular the tab title and favicon.
            let busy = tab.getAttribute("busy");
            setAttributes(row.firstElementChild, {
                busy,
                label: tab.label,
                image: !busy && tab.getAttribute("image"),
                iconloadingprincipal: tab.getAttribute("iconloadingprincipal"),
            });

            this._setImageAttributes(row, tab);

            // decide which icon to display for the audio button, or whether it should be displayed at all.
            let audioButton = row.querySelector(".all-tabs-secondary-button[toggle-mute]");
            setAttributes(audioButton, {
                muted: tab.muted,
                soundplaying: tab.soundPlaying,
                "activemedia-blocked": tab.activeMediaBlocked,
                pictureinpicture: tab.pictureinpicture,
                hidden: !(
                    tab.muted ||
                    tab.soundPlaying ||
                    tab.activeMediaBlocked ||
                    tab.pictureinpicture
                ),
            });
        }
        /**
         * show a throbber in place of the favicon while a tab is loading.
         * @param {object} row (a row element)
         * @param {object} tab (a row element)
         */
        _setImageAttributes(row, tab) {
            let button = row.firstElementChild;
            let image = button.icon;
            if (image) {
                let busy = tab.getAttribute("busy");
                let progress = tab.getAttribute("progress");
                setAttributes(image, { busy, progress });
                if (busy) image.classList.add("tab-throbber-tabslist");
                else image.classList.remove("tab-throbber-tabslist");
            }
        }
        /**
         * get the previous or next node for a given TreeWalker
         * @param {object} walker (a TreeWalker object)
         * @param {boolean} prev (whether to walk backwards or forwards)
         * @returns the next eligible DOM node to focus
         */
        getNewFocus(walker, prev) {
            return prev ? walker.previousNode() : walker.nextNode();
        }
        /**
         * cycle focus between buttons in the pane
         * @param {boolean} prev (whether to go backwards or forwards)
         * @param {boolean} horizontal (whether we're navigating with left/right or up/down)
         */
        navigateButtons(prev, horizontal) {
            let walker = horizontal ? this.horizontalWalker : this.verticalWalker;
            let oldFocus = document.activeElement;
            walker.currentNode = oldFocus;
            let newFocus = this.getNewFocus(walker, prev);
            while (newFocus && newFocus.tagName == "toolbartabstop")
                newFocus = this.getNewFocus(walker, prev);
            if (newFocus) this._focusButton(newFocus);
        }
        /**
         * make a DOM node focusable, focus it, and add a blur listener to it that'll revert its focusability when we're done focusing it.
         * we have to do it this way since we don't want ALL the buttons to be focusable with tabs.
         * it looks like you can focus them with tabs, but really you're just focusing the tab stops,
         * which are set up to instantly focus the next/previous element. this way you only need to tab twice to get past the pane.
         * if every button was tabbable then you'd have to press the tab key at least twice for every tab you have just to get to the browser content, perhaps hundreds of times.
         * instead, tab only focuses the top buttons row and the lower tabs scrollbox. once one of those is focused, arrow keys cycle between buttons.
         * @param {object} button (DOM node)
         */
        _focusButton(button) {
            button.setAttribute("tabindex", "-1");
            button.focus();
            button.addEventListener("blur", this);
        }
        // event callback when something is focused. prevent the pane from being collapsed while it's focused.
        // also execute the tab stop behavior if a tab stop was focused.
        _onFocus(e) {
            clearTimeout(this.hoverOutTimer);
            clearTimeout(this.hoverTimer);
            this.hoverOutQueued = false;
            this.hoverQueued = false;
            if (this.pane.getAttribute("unpinned") && !this.noExpand)
                this.pane.setAttribute("expanded", true);
            if (e.target.tagName === "toolbartabstop") this._onTabStopFocus(e);
        }
        // invoked on a blur event. if the pane is no longer focused or hovered, and it's unpinned, prepare to collapse it.
        _onPaneBlur(e) {
            if (this.pane.matches(":is(:hover, :focus-within)")) return;
            clearTimeout(this.hoverOutTimer);
            clearTimeout(this.hoverTimer);
            this.hoverOutQueued = false;
            this.hoverQueued = false;
            if (this.noExpand) return this.pane.removeAttribute("expanded"); // if the pane is set to not expand, forget about all this.
            // if the pane was blurred because a context menu was opened, defer this behavior until the context menu is hidden.
            let popNode = document.popupNode;
            if (popNode && this.pane.contains(popNode)) {
                let contextDef = popNode.closest("[context]");
                if (contextDef) {
                    document.getElementById(contextDef.getAttribute("context"))?.addEventListener(
                        "popuphidden",
                        (e) => {
                            setTimeout(() => {
                                if (!this.pane.matches(":is(:hover, :focus-within)"))
                                    this.pane.removeAttribute("expanded");
                            }, 100);
                        },
                        { once: true }
                    );
                    return;
                }
            }
            this.pane.removeAttribute("expanded");
        }
        // if a button was blurred, make it un-tabbable again.
        _onButtonBlur(e) {
            if (document.activeElement == e.target) return;
            e.target.removeEventListener("blur", this);
            e.target.removeAttribute("tabindex");
        }
        // this one is pretty complicated. if a tab stop was focused, we need to pass focus to the next eligible element.
        // the only truly focusable elements in the pane are tab stops. but the first button after a tab stop receives focus from the tab stop.
        // then the buttons that come after it can be focused with arrow keys. but we also need to check if user is tabbing *out* of the pane,
        // and pass focus to the next eligible button outside of the pane (probably a button)
        // see browser-toolbarKeyNav.js for more details on this concept.
        _onTabStopFocus(e) {
            let walker = this.horizontalWalker;
            let oldFocus = e.relatedTarget;
            let isButton = (node) => node.tagName == "button" || node.tagName == "toolbarbutton";
            if (oldFocus) {
                this._isFocusMovingBackward =
                    oldFocus.compareDocumentPosition(e.target) & Node.DOCUMENT_POSITION_PRECEDING;
                if (this._isFocusMovingBackward && oldFocus && isButton(oldFocus)) {
                    document.commandDispatcher.rewindFocus();
                    return;
                }
            }
            walker.currentNode = e.target;
            let button = walker.nextNode();
            if (!button || !isButton(button)) {
                if (
                    oldFocus &&
                    this._isFocusMovingBackward &&
                    !gNavToolbox.contains(oldFocus) &&
                    !this.pane.contains(oldFocus)
                ) {
                    let allStops = Array.from(document.querySelectorAll("toolbartabstop"));
                    let earlierVisibleStopIndex = allStops.indexOf(e.target) - 1;
                    while (earlierVisibleStopIndex >= 0) {
                        let stop = allStops[earlierVisibleStopIndex];
                        let stopContainer = this.pane.contains(stop)
                            ? this.pane
                            : stop.closest("toolbar");
                        if (window.windowUtils.getBoundsWithoutFlushing(stopContainer).height > 0)
                            break;
                        earlierVisibleStopIndex--;
                    }
                    if (earlierVisibleStopIndex == -1) this._isFocusMovingBackward = false;
                }
                if (this._isFocusMovingBackward) document.commandDispatcher.rewindFocus();
                else document.commandDispatcher.advanceFocus();
                return;
            }
            this._focusButton(button);
        }
        // when a key is pressed, navigate the focus (or remove it for esc key)
        _onKeyDown(e) {
            let accelKey = AppConstants.platform == "macosx" ? e.metaKey : e.ctrlKey;
            if (e.altKey || e.shiftKey || accelKey) return;
            switch (e.key) {
                case "ArrowLeft":
                    this.navigateButtons(!window.RTL_UI, true);
                    break;
                case "ArrowRight":
                    // Previous if UI is RTL, next if UI is LTR.
                    this.navigateButtons(window.RTL_UI, true);
                    break;
                case "ArrowUp":
                    this.navigateButtons(true);
                    break;
                case "ArrowDown":
                    this.navigateButtons(false);
                    break;
                case "Escape":
                    if (this.pane.contains(document.activeElement)) {
                        document.activeElement.blur();
                        break;
                    }
                // fall through
                default:
                    return;
            }
            e.preventDefault();
        }
        // when you left-click a tab, the first thing that happens is selection. this happens on mouse down, not on mouse up.
        // if holding shift key or ctrl key, perform multiselection operations. otherwise, just select the clicked tab.
        _onMouseDown(e, tab) {
            if (e.button !== 0) return;
            let accelKey = AppConstants.platform == "macosx" ? e.metaKey : e.ctrlKey;
            if (e.shiftKey) {
                const lastSelectedTab = gBrowser.lastMultiSelectedTab;
                if (!accelKey) {
                    gBrowser.selectedTab = lastSelectedTab;
                    gBrowser.clearMultiSelectedTabs();
                }
                gBrowser.addRangeToMultiSelectedTabs(lastSelectedTab, tab);
                e.preventDefault();
            } else if (accelKey) {
                if (tab.multiselected) gBrowser.removeFromMultiSelectedTabs(tab);
                else if (tab != gBrowser.selectedTab) {
                    gBrowser.addToMultiSelectedTabs(tab);
                    gBrowser.lastMultiSelectedTab = tab;
                }
                e.preventDefault();
            } else {
                if (!tab.selected && tab.multiselected) gBrowser.lockClearMultiSelectionOnce();
                if (
                    !e.shiftKey &&
                    !accelKey &&
                    !e.target.classList.contains("all-tabs-secondary-button") &&
                    tab !== gBrowser.selectedTab
                ) {
                    if (tab.getAttribute("pending") || tab.getAttribute("busy"))
                        tab.noCanvas = true;
                    else delete tab.noCanvas;
                    if (gBrowser.selectedTab != tab) gBrowser.selectedTab = tab;
                    else gBrowser.tabContainer._handleTabSelect();
                }
            }
        }
        // when the mouse is released, clear the multiselection and perform some drag/drop cleanup.
        // if middle mouse button was clicked, then close the tab, but first warm up the next tab that will be selected.
        _onMouseUp(e, tab) {
            if (e.button === 2) return;
            if (e.button === 1) {
                gBrowser.warmupTab(gBrowser._findTabToBlurTo(tab));
                gBrowser.removeTab(tab, {
                    animate: true,
                    byMouse: false,
                });
                return;
            }
            let accelKey = AppConstants.platform == "macosx" ? e.metaKey : e.ctrlKey;
            if (e.shiftKey || accelKey || e.target.classList.contains("all-tabs-secondary-button"))
                return;
            delete tab.noCanvas;
            gBrowser.unlockClearMultiSelection();
            gBrowser.clearMultiSelectedTabs();
        }
        // when mouse enters the pane, prepare to expand the pane after the specified delay.
        _onMouseEnter(e) {
            clearTimeout(this.hoverOutTimer);
            this.hoverOutQueued = false;
            if (!this.pane.getAttribute("unpinned") || this.noExpand)
                return this.pane.removeAttribute("expanded");
            if (this.hoverQueued) return;
            this.hoverQueued = true;
            this.hoverTimer = setTimeout(() => {
                this.hoverQueued = false;
                this.pane.setAttribute("expanded", true);
            }, this.hoverDelay);
        }
        // when mouse leaves the pane, prepare to collapse the pane...
        _onMouseLeave(e) {
            clearTimeout(this.hoverTimer);
            this.hoverQueued = false;
            if (this.hoverOutQueued) return;
            this.hoverOutQueued = true;
            this.hoverOutTimer = setTimeout(() => {
                this.hoverOutQueued = false;
                if (this.pane.matches(":is(:hover, :focus-within)")) return;
                if (this.noExpand) return this.pane.removeAttribute("expanded");
                // again, don't collapse the pane yet if the mouse left because a context menu was opened on the pane.
                // wait until the context menu is closed before collapsing the pane.
                let popNode = document.popupNode;
                if (popNode && this.pane.contains(popNode)) {
                    let contextDef = popNode.closest("[context]");
                    if (contextDef) {
                        document
                            .getElementById(contextDef.getAttribute("context"))
                            ?.addEventListener(
                                "popuphidden",
                                (e) => {
                                    setTimeout(() => {
                                        if (!this.pane.matches(":is(:hover, :focus-within)"))
                                            this.pane.removeAttribute("expanded");
                                    }, 100);
                                },
                                { once: true }
                            );
                        return;
                    }
                }
                this.pane.removeAttribute("expanded");
            }, this.hoverOutDelay);
        }
        unpin() {
            this.pane.setAttribute("unpinned", true);
            this.pane.style.setProperty("--pane-width", this.pane.width + "px");
            this.pane.style.setProperty(
                "--pane-transition-duration",
                (Math.sqrt(this.pane.width / 350) * 0.25).toFixed(2) + "s"
            );
        }
        // "click" events work kind of like "mouseup" events, but in this case we're only using this to prevent the click event yielding a command event.
        _onClick(e) {
            if (e.button !== 0 || e.target.classList.contains("all-tabs-secondary-button")) return;
            e.preventDefault();
        }
        // "command" events happen on click or on spacebar/enter. we want the buttons to be keyboard accessible too.
        // so this is how the mute button and close button work, and ultimately how you select a tab with the keyboard.
        _onCommand(e, tab) {
            if (e.target.hasAttribute("toggle-mute")) {
                tab.multiselected
                    ? gBrowser.toggleMuteAudioOnMultiSelectedTabs(tab)
                    : tab.toggleMuteAudio();
                return;
            }
            if (e.target.hasAttribute("close-button")) {
                if (tab.multiselected) gBrowser.removeMultiSelectedTabs();
                else gBrowser.removeTab(tab, { animate: true });
                return;
            }
            if (!gSharedTabWarning.willShowSharedTabWarning(tab))
                if (tab !== gBrowser.selectedTab) this._selectTab(tab);
            delete tab.noCanvas;
        }
        // invoked on "dragstart" event. first figure out what we're dragging and set a drag image.
        _onDragStart(e, tab) {
            let row = e.target;
            if (!tab || gBrowser.tabContainer._isCustomizing) return;
            let selectedTabs = gBrowser.selectedTabs;
            let otherSelectedTabs = selectedTabs.filter((selectedTab) => selectedTab != tab);
            let dataTransferOrderedTabs = [tab].concat(otherSelectedTabs);
            let dt = e.dataTransfer;
            for (let i = 0; i < dataTransferOrderedTabs.length; i++) {
                let dtTab = dataTransferOrderedTabs[i];
                dt.mozSetDataAt("all-tabs-item", dtTab, i);
            }
            dt.mozCursor = "default";
            dt.addElement(row);
            // if multiselected tabs aren't adjacent, make them adjacent
            if (tab.multiselected) {
                let newIndex = (aTab, index) => {
                    if (aTab.pinned) return Math.min(index, gBrowser._numPinnedTabs - 1);
                    return Math.max(index, gBrowser._numPinnedTabs);
                };
                let tabIndex = selectedTabs.indexOf(tab);
                let draggedTabPos = tab._tPos;
                // tabs to the left of the dragged tab
                let insertAtPos = draggedTabPos - 1;
                for (let i = tabIndex - 1; i > -1; i--) {
                    insertAtPos = newIndex(selectedTabs[i], insertAtPos);
                    if (insertAtPos && !selectedTabs[i].nextElementSibling.multiselected)
                        gBrowser.moveTabTo(selectedTabs[i], insertAtPos);
                }
                // tabs to the right
                insertAtPos = draggedTabPos + 1;
                for (let i = tabIndex + 1; i < selectedTabs.length; i++) {
                    insertAtPos = newIndex(selectedTabs[i], insertAtPos);
                    if (insertAtPos && !selectedTabs[i].previousElementSibling.multiselected)
                        gBrowser.moveTabTo(selectedTabs[i], insertAtPos);
                }
            }
            // tab preview
            if (
                !tab.noCanvas &&
                (AppConstants.platform == "win" || AppConstants.platform == "macosx")
            ) {
                delete tab.noCanvas;
                let windowUtils = window.windowUtils;
                let scale = windowUtils.screenPixelsPerCSSPixel / windowUtils.fullZoom;
                let canvas = this._dndCanvas;
                if (!canvas) {
                    this._dndCanvas = canvas = document.createElementNS(
                        "http://www.w3.org/1999/xhtml",
                        "canvas"
                    );
                    canvas.style.width = "100%";
                    canvas.style.height = "100%";
                    canvas.mozOpaque = true;
                }
                canvas.width = 160 * scale;
                canvas.height = 90 * scale;
                let toDrag = canvas;
                let dragImageOffset = -16;
                let browser = tab.linkedBrowser;
                if (gMultiProcessBrowser) {
                    let context = canvas.getContext("2d");
                    context.fillStyle = getComputedStyle(this.pane).getPropertyValue(
                        "background-color"
                    );
                    context.fillRect(0, 0, canvas.width, canvas.height);

                    let captureListener = () =>
                        dt.updateDragImage(canvas, dragImageOffset, dragImageOffset);
                    PageThumbs.captureToCanvas(browser, canvas).then(captureListener);
                } else {
                    PageThumbs.captureToCanvas(browser, canvas);
                    dragImageOffset = dragImageOffset * scale;
                }
                dt.setDragImage(toDrag, dragImageOffset, dragImageOffset);
            }
            tab._dragData = {
                movingTabs: (tab.multiselected ? gBrowser.selectedTabs : [tab]).filter(
                    this.filterFn
                ),
            };
            e.stopPropagation();
        }
        // invoked when we drag over an element inside the pane.
        // decide whether to show the drag-over styling on a row, and whether to show the drag indicator above or below the row.
        _onDragOver(e) {
            let row = this.findRow(e.target);
            let dt = e.dataTransfer;
            if (!dt.types.includes("all-tabs-item") || !row || row.tab.multiselected) return;
            let draggedTab = dt.mozGetDataAt("all-tabs-item", 0);
            if (row.tab === draggedTab) return;
            // whether a tab will be placed before or after the drop target depends on 1) whether the drop target is above or below the dragged tab, and 2) whether the order of the tab list is reversed.
            let getPosition = () => {
                return this.reversed
                    ? row.tab._tPos < draggedTab._tPos
                    : row.tab._tPos > draggedTab._tPos;
            };
            let position = getPosition() ? "after" : "before";
            row.setAttribute("dragpos", position);
            e.preventDefault();
        }
        // invoked when we drag over an element then leave it. clean up the dragpos attribute.
        // we actually do this for every row (wasteful, I know) since these events are dispatched too slowly. I guess it's a firefox bug, idk.
        _onDragLeave(e) {
            let row = this.findRow(e.target);
            let dt = e.dataTransfer;
            if (!dt.types.includes("all-tabs-item") || !row) return;
            this.containerNode
                .querySelectorAll("[dragpos]")
                .forEach((item) => item.removeAttribute("dragpos"));
        }
        // invoked when we finally release the dragged tab(s). figure out where to move the tab to, move it, do some cleanup.
        _onDrop(e) {
            let row = this.findRow(e.target);
            let dt = e.dataTransfer;
            let tabBar = gBrowser.tabContainer;

            if (!dt.types.includes("all-tabs-item") || !row) return;

            let draggedTab = dt.mozGetDataAt("all-tabs-item", 0);
            let movingTabs = draggedTab._dragData.movingTabs;

            if (
                !movingTabs ||
                dt.mozUserCancelled ||
                dt.dropEffect === "none" ||
                tabBar._isCustomizing
            ) {
                delete draggedTab._dragData;
                return;
            }

            tabBar._finishGroupSelectedTabs(draggedTab);

            if (draggedTab) {
                let newIndex = row.tab._tPos;
                const dir = newIndex < movingTabs[0]._tPos;
                movingTabs.forEach((tab) =>
                    gBrowser.moveTabTo(
                        dt.dropEffect == "copy" ? gBrowser.duplicateTab(tab) : tab,
                        dir ? newIndex++ : newIndex
                    )
                );
            }
            row.removeAttribute("dragpos");
            e.stopPropagation();
        }
        // invoked when dragging ends, whether by dropping or by exiting. just cleans up after the other drag event handlers.
        _onDragEnd(e) {
            let draggedTab = e.dataTransfer.mozGetDataAt("all-tabs-item", 0);
            delete draggedTab._dragData;
            delete draggedTab.noCanvas;
            for (let row of this.rows) row.removeAttribute("dragpos");
        }
        // callback function for the TabMultiSelect custom event. this event doesn't get dispatched to a specific tab,
        // because multiple tabs can be multiselected by the same operation. so we can't use its target to specify which row's attributes to change.
        // we therefore have to update the "multiselected" attribute for every row.
        _onTabMultiSelect() {
            for (let item of this.rows)
                !!item.tab.multiselected
                    ? item.setAttribute("multiselected", true)
                    : item.removeAttribute("multiselected");
        }
        // invoked when mousing over a row. we want to speculatively warm up a tab when the user hovers it since it's possible they will click it.
        // there's a cache for this with a maximum limit, so if the user mouses over 3 tabs without clicking them, then a 4th, it will clear the 1st to make room.
        // this is the same thing the built-in tab bar does so we're just mimicking vanilla behavior here. this can be disabled with browser.tabs.remote.warmup.enabled
        _warmupRowTab(e, tab) {
            let row = this.findRow(e.target);
            SessionStore.speculativeConnectOnTabHover(tab);
            if (row.querySelector("[close-button]").matches(":hover"))
                tab = gBrowser._findTabToBlurTo(tab);
            gBrowser.warmupTab(tab);
        }
        // generate tooltip labels and decide where to anchor the tooltip. invoked when the vertical-tabs-tooltip is about to be shown.
        createTabTooltip(e) {
            e.stopPropagation();
            let row = document.tooltipNode ? this.findRow(document.tooltipNode) : null;
            let { tab } = row;
            if (!row || !tab) return e.preventDefault();
            // get a localized string, replace any plural variables with the passed number, and add a shortcut string (e.g. Ctrl+M) matching the passed key element ID.
            let stringWithShortcut = (stringId, keyElemId, pluralCount) => {
                let keyElem = document.getElementById(keyElemId);
                let shortcut = ShortcutUtils.prettifyShortcut(keyElem);
                return PluralForm.get(pluralCount, gTabBrowserBundle.GetStringFromName(stringId))
                    .replace("%S", shortcut)
                    .replace("#1", pluralCount);
            };
            let label;
            let align = true; // should we align to the tab or to the mouse? depends on which element was hovered.
            const selectedTabs = gBrowser.selectedTabs;
            const contextTabInSelection = selectedTabs.includes(tab);
            const affectedTabsLength = contextTabInSelection ? selectedTabs.length : 1;
            // a bunch of localization
            if (row.querySelector("[close-button]").matches(":hover")) {
                let shortcut = ShortcutUtils.prettifyShortcut(key_close);
                label = PluralForm.get(
                    affectedTabsLength,
                    gTabBrowserBundle.GetStringFromName("tabs.closeTabs.tooltip")
                ).replace("#1", affectedTabsLength);
                if (contextTabInSelection && shortcut) {
                    if (label.includes("%S")) label = label.replace("%S", shortcut);
                    else label = label + " (" + shortcut + ")";
                }
                align = false;
            } else if (row.querySelector("[toggle-mute]").matches(":hover")) {
                let stringID;
                if (contextTabInSelection) {
                    stringID = tab.linkedBrowser.audioMuted
                        ? "tabs.unmuteAudio2.tooltip"
                        : "tabs.muteAudio2.tooltip";
                    label = stringWithShortcut(stringID, "key_toggleMute", affectedTabsLength);
                } else {
                    if (tab.hasAttribute("activemedia-blocked"))
                        stringID = "tabs.unblockAudio2.tooltip";
                    else
                        stringID = tab.linkedBrowser.audioMuted
                            ? "tabs.unmuteAudio2.background.tooltip"
                            : "tabs.muteAudio2.background.tooltip";
                    label = PluralForm.get(
                        affectedTabsLength,
                        gTabBrowserBundle.GetStringFromName(stringID)
                    ).replace("#1", affectedTabsLength);
                }
                align = false;
            } else {
                label = tab._fullLabel || tab.getAttribute("label");
                // show the tab's process ID in the tooltip?
                if (prefSvc.getBoolPref("browser.tabs.tooltipsShowPidAndActiveness", false))
                    if (tab.linkedBrowser) {
                        let [contentPid, ...framePids] = this.E10SUtils.getBrowserPids(
                            tab.linkedBrowser,
                            gFissionBrowser
                        );
                        if (contentPid) {
                            label += " (pid " + contentPid + ")";
                            if (gFissionBrowser) {
                                label += " [F";
                                if (framePids.length) label += " " + framePids.join(", ");
                                label += "]";
                            }
                        }
                        if (tab.linkedBrowser.docShellIsActive) label += " [A]";
                    }
                // add the container name to the tooltip?
                if (tab.userContextId) {
                    label = gTabBrowserBundle.formatStringFromName("tabs.containers.tooltip", [
                        label,
                        ContextualIdentityService.getUserContextLabel(tab.userContextId),
                    ]);
                }
            }
            // browser.proton.places-tooltip.enabled should be set to true for best results.
            // regular tab tooltip is pretty lame.
            if (!gProtonPlacesTooltip) return e.target.setAttribute("label", label);
            // align to the row
            if (align) {
                e.target.setAttribute("position", "after_start");
                e.target.moveToAnchor(row, "after_start");
            }
            let title = e.target.querySelector(".places-tooltip-title");
            let url = e.target.querySelector(".places-tooltip-uri");
            let icon = e.target.querySelector("#places-tooltip-insecure-icon");
            title.textContent = label;
            url.value = tab.linkedBrowser?.currentURI?.spec.replace(/^https:\/\//, "");
            icon.hidden = !url.value.startsWith("http://"); // show an insecure lock icon if scheme is unencrypted
        }
        // container tab settings affect what we need to show in the "New Tab" button's tooltip and context menu.
        // so we need to observe this preference and respond accordingly.
        handlePrivacyChange() {
            let containersEnabled =
                prefSvc.getBoolPref("privacy.userContext.enabled") &&
                !PrivateBrowsingUtils.isWindowPrivate(window);
            const newTabLeftClickOpensContainersMenu = prefSvc.getBoolPref(
                "privacy.userContext.newTabContainerOnLeftClick.enabled"
            );
            let parent = this.newTabButton;
            parent.removeAttribute("type");
            if (parent.menupopup) parent.menupopup.remove();
            if (containersEnabled) {
                parent.setAttribute("context", "new-tab-button-popup");
                let popup = document.getElementById("new-tab-button-popup").cloneNode(true);
                popup.removeAttribute("id");
                popup.className = "new-tab-popup";
                popup.setAttribute("position", "after_end");
                parent.prepend(popup);
                parent.setAttribute("type", "menu");
                if (newTabLeftClickOpensContainersMenu) {
                    gClickAndHoldListenersOnElement.remove(parent);
                    nodeToTooltipMap["new-tab-button"] = "newTabAlwaysContainer.tooltip";
                } else {
                    gClickAndHoldListenersOnElement.add(parent);
                    nodeToTooltipMap["new-tab-button"] = "newTabContainer.tooltip";
                }
            } else {
                nodeToTooltipMap["new-tab-button"] = "newTabButton.tooltip";
                parent.removeAttribute("context", "new-tab-button-popup");
            }
            gDynamicTooltipCache.delete("new-tab-button");
            this.newTabButton.tooltipText = GetDynamicShortcutTooltipText("new-tab-button");
        }
        // load our stylesheet as an author sheet. override it with userChrome.css and !important rules.
        registerSheet() {
            let css = `
#vertical-tabs-pane {
    --vertical-tabs-padding: 4px;
    --collapsed-pane-width: calc(
        16px + var(--vertical-tabs-padding) * 2 + var(--arrowpanel-menuitem-padding) * 2
    );
    background-color: var(--vertical-tabs-pane-background, var(--lwt-accent-color));
    padding: var(--vertical-tabs-padding);
    border-color: var(--sidebar-border-color);
    border-block-style: none;
    border-inline-style: solid;
    border-inline-width: 1px 0;
    z-index: 2;
}
#vertical-tabs-pane[positionstart] {
    border-inline-width: 0 1px;
}
#vertical-tabs-pane:not([unpinned]) {
    min-width: 160px;
    max-width: 50vw;
}
#vertical-tabs-pane:not([hidden]) {
    min-height: 0;
    display: flex;
}
#vertical-tabs-pane[unpinned]:not([hidden]) {
    position: relative;
    z-index: 1;
    margin-inline: 0;
    max-width: var(--collapsed-pane-width);
    min-width: var(--collapsed-pane-width);
    width: var(--collapsed-pane-width);
    height: 0;
    transition-property: min-width, max-width, margin;
    transition-timing-function: ease-in-out, ease-in-out, ease-in-out;
    transition-duration: var(--pane-transition-duration), var(--pane-transition-duration), var(--pane-transition-duration);
}
#vertical-tabs-pane[unpinned]:not([positionstart="true"]) {
    left: auto;
    right: 0;
    margin-inline: 0;
}
#vertical-tabs-pane[unpinned][expanded] {
    min-width: var(--pane-width, 350px);
    width: var(--pane-width, 350px);
    max-width: var(--pane-width, 350px);
    margin-inline: 0 calc(36px - var(--pane-width, 350px));
}
#vertical-tabs-pane[unpinned][expanded]:not([positionstart="true"]) {
    margin-inline: calc(36px - var(--pane-width, 350px)) 0;
}
#vertical-tabs-pane[no-expand] {
    transition: none !important;
}
#vertical-tabs-splitter {
    border: none;
}
#vertical-tabs-pane[unpinned] ~ #vertical-tabs-splitter {
    display: none;
}
#vertical-tabs-inner-box {
    overflow: hidden;
    width: -moz-available;
    min-width: calc(16px + var(--arrowpanel-menuitem-padding) * 2);
}
#vertical-tabs-buttons-row {
    min-width: 0 !important;
}
#vertical-tabs-pane[no-expand][unpinned] #vertical-tabs-buttons-row {
    -moz-box-orient: vertical;
}
#vertical-tabs-buttons-row > toolbarbutton {
    margin: 0 !important;
}
#vertical-tabs-pane[unpinned]:not([expanded]) #vertical-tabs-buttons-row > toolbarbutton {
    min-width: calc(16px + var(--arrowpanel-menuitem-padding) * 2) !important;
}
/* tabs */
#vertical-tabs-list .all-tabs-item {
    border-radius: var(--arrowpanel-menuitem-border-radius);
    box-shadow: none;
    -moz-box-align: center;
    padding-inline-end: 2px;
    margin: 0;
    overflow-x: -moz-hidden-unscrollable;
    position: relative;
}
#vertical-tabs-pane[unpinned]:not([expanded]) #vertical-tabs-list .all-tabs-item {
    padding-inline-end: 0;
}
#vertical-tabs-list .all-tabs-item .all-tabs-button:not([disabled], [open]):focus {
    background: none;
}
#vertical-tabs-list
    .all-tabs-item:is([selected], [multiselected], [usercontextid]:is(:hover, [_moz-menuactive]))
    .all-tabs-button {
    background-image: linear-gradient(
        to right,
        var(--main-stripe-color) 0,
        var(--main-stripe-color) 4px,
        transparent 4px
    ) !important;
}
#vertical-tabs-list .all-tabs-item[selected] {
    font-weight: normal;
    background-color: var(--arrowpanel-dimmed-further) !important;
    --main-stripe-color: var(--arrowpanel-dimmed-even-further);
}
#vertical-tabs-list .all-tabs-item .all-tabs-button {
    min-height: revert;
}
#vertical-tabs-list .all-tabs-item[usercontextid]:not([multiselected]) {
    --main-stripe-color: var(--identity-tab-color);
}
#vertical-tabs-list .all-tabs-item[multiselected] {
    --main-stripe-color: var(--multiselected-color, var(--toolbarbutton-icon-fill-attention));
}
#vertical-tabs-list
    .all-tabs-item:not([selected]):is(:hover, :focus-within, [_moz-menuactive], [multiselected]) {
    background-color: var(--arrowpanel-dimmed) !important;
}
#vertical-tabs-list .all-tabs-item[multiselected]:not([selected]):is(:hover, [_moz-menuactive]) {
    background-color: var(--arrowpanel-dimmed-further) !important;
}
#vertical-tabs-list
    .all-tabs-item[pending]:not([selected]):is(:hover, :focus-within, [_moz-menuactive], [multiselected]) {
    background-color: var(
        --arrowpanel-faint,
        color-mix(in srgb, var(--arrowpanel-dimmed) 60%, transparent)
    ) !important;
}
#vertical-tabs-list .all-tabs-item[pending] > .all-tabs-button {
    opacity: 0.6;
}
:root[italic-unread-tabs] .all-tabs-item[notselectedsinceload]:not([pending]) > .all-tabs-button,
:root[italic-unread-tabs] .all-tabs-item[notselectedsinceload][pending] > .all-tabs-button[busy] {
    font-style: italic;
}
#vertical-tabs-list .all-tabs-item .all-tabs-secondary-button {
    max-width: 18px;
    max-height: 18px;
    border-radius: 100%;
    color: inherit;
    background-color: transparent !important;
    opacity: 0.7;
    min-height: 0;
    min-width: 0;
    padding: 0;
}
#vertical-tabs-list .all-tabs-item .all-tabs-secondary-button > .toolbarbutton-icon {
    min-width: 18px;
    min-height: 18px;
    fill: inherit;
    fill-opacity: inherit;
    -moz-context-properties: inherit;
}
#vertical-tabs-list .all-tabs-item .all-tabs-secondary-button > label:empty {
    display: none;
}
#vertical-tabs-list .all-tabs-item .all-tabs-secondary-button:is(:hover, :focus):not([disabled]),
#vertical-tabs-list
    .all-tabs-item:is(:hover, :focus-within)
    .all-tabs-secondary-button[close-button]:is(:hover, :focus):not([disabled]) {
    background-color: var(--arrowpanel-dimmed) !important;
    opacity: 1;
    color: inherit;
}
#vertical-tabs-list .all-tabs-item .all-tabs-secondary-button:hover:active:not([disabled]),
#vertical-tabs-list
    .all-tabs-item:is(:hover, :focus-within)
    .all-tabs-secondary-button[close-button]:hover:active:not([disabled]) {
    background-color: var(--arrowpanel-dimmed-further) !important;
}
#vertical-tabs-list .all-tabs-item .all-tabs-secondary-button[toggle-mute] {
    list-style-image: none !important;
    background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="18px" height="18px" viewBox="0 0 18 18"><path fill="context-fill" d="M3.52,5.367c-1.332,0-2.422,1.09-2.422,2.422v2.422c0,1.332,1.09,2.422,2.422,2.422h1.516l4.102,3.633 V1.735L5.035,5.367H3.52z M12.059,9c0-0.727-0.484-1.211-1.211-1.211v2.422C11.574,10.211,12.059,9.727,12.059,9z M14.48,9 c0-1.695-1.211-3.148-2.785-3.512l-0.363,1.09C12.422,6.82,13.27,7.789,13.27,9c0,1.211-0.848,2.18-1.938,2.422l0.484,1.09 C13.27,12.148,14.48,10.695,14.48,9z M12.543,3.188l-0.484,1.09C14.238,4.883,15.691,6.82,15.691,9c0,2.18-1.453,4.117-3.512,4.601 l0.484,1.09c2.422-0.605,4.238-2.906,4.238-5.691C16.902,6.215,15.086,3.914,12.543,3.188z"/></svg>') !important;
    background-size: 14px !important;
    background-repeat: no-repeat !important;
    background-position: center !important;
    padding: 0 !important;
    margin-inline-end: 8.5px;
    margin-inline-start: -27px;
    transition: 0.25s cubic-bezier(0.07, 0.78, 0.21, 0.95) transform,
        0.2s cubic-bezier(0.07, 0.74, 0.24, 0.95) margin, 0.075s linear opacity;
    display: block !important;
}
#vertical-tabs-list .all-tabs-item .all-tabs-secondary-button[toggle-mute][hidden] {
    transform: translateX(14px);
    opacity: 0;
}
#vertical-tabs-list
    .all-tabs-item:is(:hover, :focus-within)
    .all-tabs-secondary-button[toggle-mute] {
    transform: translateX(48px);
}
#vertical-tabs-list .all-tabs-item .all-tabs-secondary-button[soundplaying] {
    transform: none !important;
    opacity: 0.7;
    margin-inline-start: -2px;
}
#vertical-tabs-list .all-tabs-item .all-tabs-secondary-button[muted] {
    list-style-image: none !important;
    background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="18px" height="18px" viewBox="0 0 18 18"><path fill="context-fill" d="M3.52,5.367c-1.332,0-2.422,1.09-2.422,2.422v2.422c0,1.332,1.09,2.422,2.422,2.422h1.516l4.102,3.633V1.735L5.035,5.367H3.52z"/><path fill="context-fill" fill-rule="evenodd" d="M12.155,12.066l-1.138-1.138l4.872-4.872l1.138,1.138 L12.155,12.066z"/><path fill="context-fill" fill-rule="evenodd" d="M10.998,7.204l1.138-1.138l4.872,4.872l-1.138,1.138L10.998,7.204z"/></svg>') !important;
    transform: none !important;
    opacity: 0.7;
    margin-inline-start: -2px;
}
#vertical-tabs-list .all-tabs-item .all-tabs-secondary-button[activemedia-blocked] {
    list-style-image: none !important;
    background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 12 12"><path fill="context-fill" d="M2.128.13A.968.968 0 0 0 .676.964v10.068a.968.968 0 0 0 1.452.838l8.712-5.034a.968.968 0 0 0 0-1.676L2.128.13z"/></svg>') !important;
    background-size: 10px !important;
    background-position: 4.5px center !important;
    transform: none !important;
    opacity: 0.7;
    margin-inline-start: -2px;
}
#vertical-tabs-list
    > .all-tabs-item:not(:hover, :focus-within)
    .all-tabs-secondary-button[pictureinpicture] {
    list-style-image: none !important;
    background-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 625.8 512"><path fill="context-fill" fill-opacity="context-fill-opacity" d="M568.9 0h-512C25.6 0 0 25 0 56.3v398.8C0 486.4 25.6 512 56.9 512h512c31.3 0 56.9-25.6 56.9-56.9V56.3C625.8 25 600.2 0 568.9 0zm-512 425.7V86c0-16.5 13.5-30 30-30h452c16.5 0 30 13.5 30 30v339.6c0 16.5-13.5 30-30 30h-452c-16.5.1-30-13.4-30-29.9zM482 227.6H314.4c-16.5 0-30 13.5-30 30v110.7c0 16.5 13.5 30 30 30H482c16.5 0 30-13.5 30-30V257.6c0-16.5-13.5-30-30-30z"/></svg>') !important;
    border-radius: 0 !important;
}
#vertical-tabs-list .all-tabs-item .all-tabs-secondary-button[pictureinpicture] {
    transform: none !important;
    opacity: 0.7;
    margin-inline-start: -2px;
}
#vertical-tabs-pane[unpinned][no-expand]:not([expanded])
    .all-tabs-item:is([muted], [soundplaying])
    .all-tabs-button:after {
    content: "";
    display: block;
    position: absolute;
    right: 0;
    bottom: 0;
    width: 14px;
    height: 14px;
    -moz-context-properties: fill, fill-opacity;
    fill: currentColor;
    fill-opacity: 0.7;
}
#vertical-tabs-pane[unpinned][no-expand]:not([expanded])
    .all-tabs-item[soundplaying]
    .all-tabs-button:after {
    background: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="18px" height="18px" viewBox="0 0 18 18"><path fill="context-fill" d="M3.52,5.367c-1.332,0-2.422,1.09-2.422,2.422v2.422c0,1.332,1.09,2.422,2.422,2.422h1.516l4.102,3.633 V1.735L5.035,5.367H3.52z M12.059,9c0-0.727-0.484-1.211-1.211-1.211v2.422C11.574,10.211,12.059,9.727,12.059,9z M14.48,9 c0-1.695-1.211-3.148-2.785-3.512l-0.363,1.09C12.422,6.82,13.27,7.789,13.27,9c0,1.211-0.848,2.18-1.938,2.422l0.484,1.09 C13.27,12.148,14.48,10.695,14.48,9z M12.543,3.188l-0.484,1.09C14.238,4.883,15.691,6.82,15.691,9c0,2.18-1.453,4.117-3.512,4.601 l0.484,1.09c2.422-0.605,4.238-2.906,4.238-5.691C16.902,6.215,15.086,3.914,12.543,3.188z"/></svg>')
        center/12px no-repeat;
}
#vertical-tabs-pane[unpinned][no-expand]:not([expanded])
    .all-tabs-item[muted]
    .all-tabs-button:after {
    background: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="18px" height="18px" viewBox="0 0 18 18"><path fill="context-fill" d="M3.52,5.367c-1.332,0-2.422,1.09-2.422,2.422v2.422c0,1.332,1.09,2.422,2.422,2.422h1.516l4.102,3.633V1.735L5.035,5.367H3.52z"/><path fill="context-fill" fill-rule="evenodd" d="M12.155,12.066l-1.138-1.138l4.872-4.872l1.138,1.138 L12.155,12.066z"/><path fill="context-fill" fill-rule="evenodd" d="M10.998,7.204l1.138-1.138l4.872,4.872l-1.138,1.138L10.998,7.204z"/></svg>')
        center/12px no-repeat;
}
#vertical-tabs-pane[unpinned][no-expand]:not([expanded])
    .all-tabs-item:is([muted], [soundplaying])
    .all-tabs-button
    .toolbarbutton-icon {
    mask: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg"><circle cx="100%" cy="100%" r="9"/></svg>')
            0/100% 100%,
        linear-gradient(#fff, #fff);
    mask-composite: exclude;
}
#vertical-tabs-list .all-tabs-item .all-tabs-secondary-button[close-button] {
    fill-opacity: 0;
    transform: translateX(14px);
    opacity: 0;
    margin-inline-start: -27px;
    transition: 0.25s cubic-bezier(0.07, 0.78, 0.21, 0.95) transform,
        0.2s cubic-bezier(0.07, 0.74, 0.24, 0.95) margin, 0.075s linear opacity;
    display: block;
    -moz-context-properties: fill, fill-opacity, stroke;
    fill: currentColor;
    fill-opacity: 0;
    border-radius: 50%;
    list-style-image: url("data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='20' height='20'><rect fill='context-fill' fill-opacity='context-fill-opacity' width='20' height='20' rx='2' ry='2'/><path fill='context-fill' fill-opacity='context-stroke-opacity' d='M11.06 10l3.47-3.47a.75.75 0 00-1.06-1.06L10 8.94 6.53 5.47a.75.75 0 10-1.06 1.06L8.94 10l-3.47 3.47a.75.75 0 101.06 1.06L10 11.06l3.47 3.47a.75.75 0 001.06-1.06z'/></svg>");
}
#vertical-tabs-list
    .all-tabs-item:is(:hover, :focus-within)
    .all-tabs-secondary-button[close-button] {
    transform: none;
    opacity: 0.7;
    margin-inline-start: -2px;
}
#vertical-tabs-list .all-tabs-item[dragpos] {
    background-color: color-mix(
        in srgb,
        transparent 30%,
        var(--arrowpanel-faint, color-mix(in srgb, var(--arrowpanel-dimmed) 60%, transparent))
    );
}
#vertical-tabs-list .all-tabs-item[dragpos]::before {
    content: "";
    position: absolute;
    pointer-events: none;
    height: 0;
    z-index: 1000;
    width: 100%;
}
#vertical-tabs-pane:not([no-expand][unpinned]) #vertical-tabs-list .all-tabs-item[dragpos]::before {
    border-image: linear-gradient(
        to right,
        transparent,
        var(--arrowpanel-dimmed-even-further) 1%,
        var(--arrowpanel-dimmed-even-further) 25%,
        transparent 90%
    );
    border-image-slice: 1;
}
#vertical-tabs-list .all-tabs-item[dragpos="before"]::before {
    inset-block-start: 0;
    border-top: 1px solid var(--arrowpanel-dimmed-even-further);
}
#vertical-tabs-list .all-tabs-item[dragpos="after"]::before {
    inset-block-end: 0;
    border-bottom: 1px solid var(--arrowpanel-dimmed-even-further);
}
#vertical-tabs-pane[unpinned]:not([expanded])
    #vertical-tabs-list
    .all-tabs-item
    .all-tabs-secondary-button[toggle-mute] {
    transform: none !important;
    margin-inline: revert !important;
}
#vertical-tabs-pane[unpinned]:not([expanded]) .all-tabs-item {
    min-width: 0 !important;
}
#vertical-tabs-pane[unpinned]:not([expanded]) :is(.all-tabs-item, .subviewbutton) {
    margin: 0 !important;
    -moz-box-pack: start !important;
}
#vertical-tabs-pane[unpinned]:not([no-expand])
    #vertical-tabs-buttons-row
    > toolbarbutton:not(#vertical-tabs-new-tab-button),
#vertical-tabs-pane[unpinned] :is(.all-tabs-item, .subviewbutton) .toolbarbutton-text {
    transition-property: opacity;
    transition-timing-function: ease-in-out;
    transition-duration: var(--pane-transition-duration);
}
#vertical-tabs-pane[unpinned]:not([expanded]) .all-tabs-secondary-button {
    visibility: collapse;
}
#vertical-tabs-pane[unpinned]:not([expanded], [no-expand])
    #vertical-tabs-buttons-row
    > toolbarbutton:not(#vertical-tabs-new-tab-button),
#vertical-tabs-pane[unpinned]:not([expanded])
    :is(.all-tabs-item, .subviewbutton)
    .toolbarbutton-text {
    opacity: 0 !important;
}
#vertical-tabs-pane .subviewbutton-iconic > .toolbarbutton-icon {
    -moz-context-properties: fill, fill-opacity;
}
#vertical-tabs-pane .subviewbutton.no-label .toolbarbutton-text {
    display: none;
}
#vertical-tabs-pane .all-tabs-item[pinned] > .all-tabs-button.subviewbutton > .toolbarbutton-text {
    background: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="context-fill" fill-opacity="context-fill-opacity" d="M14.707 13.293L11.414 10l2.293-2.293a1 1 0 0 0 0-1.414A4.384 4.384 0 0 0 10.586 5h-.172A2.415 2.415 0 0 1 8 2.586V2a1 1 0 0 0-1.707-.707l-5 5A1 1 0 0 0 2 8h.586A2.415 2.415 0 0 1 5 10.414v.169a4.036 4.036 0 0 0 1.337 3.166 1 1 0 0 0 1.37-.042L10 11.414l3.293 3.293a1 1 0 0 0 1.414-1.414zm-7.578-1.837A2.684 2.684 0 0 1 7 10.583v-.169a4.386 4.386 0 0 0-1.292-3.121 4.414 4.414 0 0 0-1.572-1.015l2.143-2.142a4.4 4.4 0 0 0 1.013 1.571A4.384 4.384 0 0 0 10.414 7h.172a2.4 2.4 0 0 1 .848.152z"/></svg>')
        no-repeat 6px/11px;
    padding-inline-start: 20px;
    -moz-context-properties: fill, fill-opacity;
    fill: currentColor;
}
#vertical-tabs-pane toolbarseparator {
    appearance: none;
    min-height: 0;
    border-top: 1px solid var(--panel-separator-color);
    border-bottom: none;
    margin: var(--panel-separator-margin);
    margin-inline: 0;
    padding: 0;
}
#vertical-tabs-pane[checked] toolbartabstop {
    -moz-user-focus: normal;
}
/* the main toolbar button */
#vertical-tabs-button {
    list-style-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="context-fill %230c0c0d"><path fill-opacity="context-fill-opacity" d="M2,7h3v6H2V7z"/><path d="M6,7v6H5V7H2V6h12v1H6z M13,1c1.657,0,3,1.343,3,3v8c0,1.657-1.343,3-3,3H3c-1.657,0-3-1.343-3-3V4c0-1.657,1.343-3,3-3H13z M3,3C2.448,3,2,3.448,2,4v8c0,0.6,0.4,1,1,1h10c0.6,0,1-0.4,1-1V4c0-0.6-0.4-1-1-1H3z"/></svg>');
    fill-opacity: 0.4;
}
/* buttons at the top of the pane */
#vertical-tabs-button:not([positionstart="true"]) .toolbarbutton-icon {
    transform: scaleX(-1);
}
#vertical-tabs-button[checked],
#vertical-tabs-close-button {
    list-style-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16" fill="context-fill %230c0c0d"><path fill-opacity="context-fill-opacity" d="M2,3h12v3H2V3z"/><path d="M6,7v6H5V7H2V6h12v1H6z M13,1c1.657,0,3,1.343,3,3v8c0,1.657-1.343,3-3,3H3c-1.657,0-3-1.343-3-3V4c0-1.657,1.343-3,3-3H13z M3,3C2.448,3,2,3.448,2,4v8c0,0.6,0.4,1,1,1h10c0.6,0,1-0.4,1-1V4c0-0.6-0.4-1-1-1H3z"/></svg>');
    fill-opacity: 0.4;
}
#vertical-tabs-new-tab-button {
    list-style-image: url("chrome://browser/skin/new-tab.svg");
}
#vertical-tabs-pin-button {
    list-style-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="context-fill" fill-opacity="context-fill-opacity" d="M11.414 10l2.293-2.293a1 1 0 0 0 0-1.414 4.418 4.418 0 0 0-.8-.622L11.425 7.15h.008l-4.3 4.3v-.017l-1.48 1.476a3.865 3.865 0 0 0 .692.834 1 1 0 0 0 1.37-.042L10 11.414l3.293 3.293a1 1 0 0 0 1.414-1.414zm3.293-8.707a1 1 0 0 0-1.414 0L9.7 4.882A2.382 2.382 0 0 1 8 2.586V2a1 1 0 0 0-1.707-.707l-5 5A1 1 0 0 0 2 8h.586a2.382 2.382 0 0 1 2.3 1.7l-3.593 3.593a1 1 0 1 0 1.414 1.414l12-12a1 1 0 0 0 0-1.414zm-9 6a4.414 4.414 0 0 0-1.571-1.015l2.143-2.142a4.4 4.4 0 0 0 1.013 1.571 4.191 4.191 0 0 0 .9.684l-1.8 1.8a4.2 4.2 0 0 0-.684-.898z"/></svg>');
}
#vertical-tabs-pane[unpinned] #vertical-tabs-pin-button {
    list-style-image: url('data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16"><path fill="context-fill" fill-opacity="context-fill-opacity" d="M14.707 13.293L11.414 10l2.293-2.293a1 1 0 0 0 0-1.414A4.384 4.384 0 0 0 10.586 5h-.172A2.415 2.415 0 0 1 8 2.586V2a1 1 0 0 0-1.707-.707l-5 5A1 1 0 0 0 2 8h.586A2.415 2.415 0 0 1 5 10.414v.169a4.036 4.036 0 0 0 1.337 3.166 1 1 0 0 0 1.37-.042L10 11.414l3.293 3.293a1 1 0 0 0 1.414-1.414zm-7.578-1.837A2.684 2.684 0 0 1 7 10.583v-.169a4.386 4.386 0 0 0-1.292-3.121 4.414 4.414 0 0 0-1.572-1.015l2.143-2.142a4.4 4.4 0 0 0 1.013 1.571A4.384 4.384 0 0 0 10.414 7h.172a2.4 2.4 0 0 1 .848.152z"/></svg>');
}
            `;
            let sss = Cc["@mozilla.org/content/style-sheet-service;1"].getService(
                Ci.nsIStyleSheetService
            );
            let uri = makeURI("data:text/css;charset=UTF=8," + encodeURIComponent(css));
            if (sss.sheetRegistered(uri, sss.AUTHOR_SHEET)) return; // avoid loading duplicate sheets on subsequent window launches.
            sss.loadAndRegisterSheet(uri, sss.AUTHOR_SHEET);
        }
        // there's a firefox bug where menuitems in the tab context menu don't have their localized labels initialized until the menu is opened on the *actual* tab bar.
        // this bug actually affects the all-tabs menu but would affect anything trying to use the tab context menu that isn't the real tab bar.
        // so we de-lazify the l10n IDs ourselves. lazy IDs are used for things that don't need to be managed at startup,
        // but since we're increasing the number of elements that use this context menu, it's now pertinent to do this at startup.
        l10nIfNeeded() {
            let lazies = document
                .getElementById("tabContextMenu")
                .querySelectorAll("[data-lazy-l10n-id]");
            if (lazies) {
                MozXULElement.insertFTLIfNeeded("browser/tabContextMenu.ftl");
                lazies.forEach((el) => {
                    el.setAttribute("data-l10n-id", el.getAttribute("data-lazy-l10n-id"));
                    el.removeAttribute("data-lazy-l10n-id");
                });
            }
        }
        // what to do when a window is closed. if it's the last window, record data about the pane's state to the xulStore and prefs.
        uninit() {
            let enumerator = Services.wm.getEnumerator("navigator:browser");
            if (!enumerator.hasMoreElements()) {
                let xulStore = Services.xulStore;
                if (this.pane.hasAttribute("checked")) xulStore.persist(this.pane, "checked");
                else xulStore.removeValue(document.documentURI, "vertical-tabs-pane", "checked");
                xulStore.persist(this.pane, "width");
                prefSvc.setBoolPref(closedPref, this.pane.hidden || false);
                prefSvc.setBoolPref(unpinnedPref, this.pane.getAttribute("unpinned") || false);
                prefSvc.setIntPref(widthPref, this.pane.width || 350);
            }
        }
    }

    // invoked when delayed window startup has finished, in other words after important components have been fully inited.
    function init() {
        window.verticalTabsPane = new VerticalTabsPaneBase(); // instantiate our tabs pane
        SidebarUI.setPosition(); // set the sidebar position again since we modified this function, probably after it already set the position
        // change the onUnload function (invoked when window is closed) so that it calls our uninit function too.
        eval(
            `gBrowserInit.onUnload = function ` +
                gBrowserInit.onUnload
                    .toSource()
                    .replace(/(SidebarUI\.uninit\(\))/, `$1; verticalTabsPane.uninit()`)
        );
        window.onunload = gBrowserInit.onUnload.bind(gBrowserInit); // reset the event handler since it used the bind method, which creates an anonymous version of the function that we can't change. just re-bind our new version.
        let gNextWindowID = 0; // required for the following functions
        // make the PictureInPicture methods dispatch an event to the tab container informing us that a tab's "pictureinpicture" attribute has changed.
        // this is how we capture all changes to the sound icon in real-time. this behavior isn't built-in, I guess for sake of brevity.
        let handleRequestSrc = PictureInPicture.handlePictureInPictureRequest.toSource();
        if (!handleRequestSrc.includes("_tabAttrModified"))
            eval(
                `PictureInPicture.handlePictureInPictureRequest = async function ` +
                    handleRequestSrc
                        .replace(/async handlePictureInPictureRequest/, "")
                        .replace(/\sServices\.telemetry.*\s*.*\s*.*\s*.*/, "")
                        .replace(/gCurrentPlayerCount.*/g, "")
                        .replace(
                            /(tab\.setAttribute\(\"pictureinpicture\".*)/,
                            `$1 parentWin.gBrowser._tabAttrModified(tab, ["pictureinpicture"]);`
                        )
            );
        let clearIconSrc = PictureInPicture.clearPipTabIcon.toSource();
        if (!clearIconSrc.includes("_tabAttrModified"))
            eval(
                `PictureInPicture.clearPipTabIcon = function ` +
                    clearIconSrc
                        .replace(/WINDOW\_TYPE/, `"Toolkit:PictureInPicture"`)
                        .replace(
                            /(tab\.removeAttribute\(\"pictureinpicture\".*)/,
                            `$1 gBrowser._tabAttrModified(tab, ["pictureinpicture"]);`
                        )
            );
    }

    // create the main button that goes in the tabs toolbar and opens the pane.
    function makeWidget() {
        // if you create a widget in the first window, it will automatically be created in subsequent videos.
        // so we stop the script from re-registering it on every subsequent window load.
        if (CustomizableUI.getPlacementOfWidget("vertical-tabs-button", true)) return;
        CustomizableUI.createWidget({
            id: "vertical-tabs-button",
            type: "button",
            defaultArea: CustomizableUI.AREA_TABSTRIP, // it should go in the tabs toolbar by default but can be moved to any customizable toolbar.
            label: config.l10n["Button label"],
            tooltiptext: config.l10n["Button tooltip"],
            localized: false,
            onCommand(e) {
                e.target.ownerGlobal.verticalTabsPane.toggle();
            },
            onCreated(node) {
                // an <observes> element is how we get the button to appear "checked" when the tabs pane is checked.
                // it automatically sets its parent's specified attribute ("checked" and "positionstart") to match that of whatever it's observing.
                let doc = node.ownerDocument;
                node.appendChild(
                    create(doc, "observes", {
                        "element": "vertical-tabs-pane",
                        "attribute": "checked",
                    })
                );
                node.appendChild(
                    create(doc, "observes", {
                        "element": "vertical-tabs-pane",
                        "attribute": "positionstart",
                    })
                );
            },
        });
    }

    // make the main elements
    document.getElementById("sidebar-splitter").after(
        create(document, "splitter", {
            class: "chromeclass-extrachrome sidebar-splitter",
            id: "vertical-tabs-splitter",
            hidden: true,
        })
    );
    document.getElementById("sidebar-splitter").after(
        create(document, "vbox", {
            class: "chromeclass-extrachrome",
            id: "vertical-tabs-pane",
            hidden: true,
        })
    );

    makeWidget();

    // tab pane's horizontal alignment should mirror that of the sidebar, which can be moved from left to right.
    SidebarUI.setPosition = function () {
        let appcontent = document.getElementById("appcontent");
        let verticalSplitter = document.getElementById("vertical-tabs-splitter");
        let verticalPane = document.getElementById("vertical-tabs-pane");
        this._box.style.MozBoxOrdinalGroup = 1;
        this._splitter.style.MozBoxOrdinalGroup = 2;
        appcontent.style.MozBoxOrdinalGroup = 3;
        verticalSplitter.style.MozBoxOrdinalGroup = 4;
        verticalPane.style.MozBoxOrdinalGroup = 5;
        if (!this._positionStart) {
            this._box.style.MozBoxOrdinalGroup = 5;
            this._splitter.style.MozBoxOrdinalGroup = 4;
            verticalSplitter.style.MozBoxOrdinalGroup = 2;
            verticalPane.style.MozBoxOrdinalGroup = 1;
            this._box.setAttribute("positionend", true);
            verticalPane.setAttribute("positionstart", true);
        } else {
            this._box.removeAttribute("positionend");
            verticalPane.removeAttribute("positionstart");
        }
        this.hideSwitcherPanel();
        let content = SidebarUI.browser.contentWindow;
        if (content && content.updatePosition) content.updatePosition();
    };

    // wait for delayed startup for some parts of the script to execute.
    if (gBrowserInit.delayedStartupFinished) init();
    else {
        let delayedListener = (subject, topic) => {
            if (topic == "browser-delayed-startup-finished" && subject == window) {
                Services.obs.removeObserver(delayedListener, topic);
                init();
            }
        };
        Services.obs.addObserver(delayedListener, "browser-delayed-startup-finished");
    }
})();
