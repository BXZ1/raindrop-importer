const RAINDROP_API_URL = 'https://api.raindrop.io/rest/v1/raindrops';
const COLLECTIONS_ROOT_URL = 'https://api.raindrop.io/rest/v1/collections';
const COLLECTIONS_CHILDREN_URL = 'https://api.raindrop.io/rest/v1/collections/childrens';

const TOOLBAR_ID = 'toolbar_____';
const SYNC_ALARM_NAME = 'raindrop_sync';

// Cache for Raindrop Collections (ID -> {title, parentId})
const collectionMap = {};
// Cache for Firefox Folders (Raindrop ID -> Firefox Folder ID)
const firefoxFolderCache = {};

/**
 * 1. Fetch all Raindrop Collections (Root and Nested) and map their structure.
 */
async function fetchRaindropCollections(apiToken) {
    const fetchRoot = fetch(COLLECTIONS_ROOT_URL, {
        headers: { 'Authorization': `Bearer ${apiToken}` }
    }).then(async res => {
        if (!res.ok) throw new Error(`API Error (Root): ${res.status}`);
        return res.json();
    });

    const fetchChildren = fetch(COLLECTIONS_CHILDREN_URL, {
        headers: { 'Authorization': `Bearer ${apiToken}` }
    }).then(async res => {
        if (!res.ok) throw new Error(`API Error (Children): ${res.status}`);
        return res.json();
    });

    try {
        const [rootData, childrenData] = await Promise.all([fetchRoot, fetchChildren]);

        // Clear previous map
        for (const key in collectionMap) { delete collectionMap[key]; }

        const allCollections = [...(rootData.items || []), ...(childrenData.items || [])];

        for (const collection of allCollections) {
            collectionMap[collection._id] = {
                title: collection.title,
                parentId: collection.parent?.$id || null
            };
        }
        return true;
    } catch (error) {
        console.error('Failed to fetch Raindrop collections:', error);
        throw new Error('Failed to fetch collections. Check API Token.');
    }
}


/**
 * Finds or creates the top-level import folder on the Bookmarks Toolbar and clears it.
 */
async function getOrCreateTargetFolder(folderName) {
    const searchResults = await browser.bookmarks.search({ title: folderName });

    let existingFolder = searchResults.find(n =>
        n.title === folderName && n.parentId === TOOLBAR_ID && n.type === 'folder'
    );

    if (!existingFolder) {
        existingFolder = await browser.bookmarks.create({
            parentId: TOOLBAR_ID,
            title: folderName
        });
    }

    // clear folder contents
    const children = await browser.bookmarks.getChildren(existingFolder.id);
    for (const child of children) {
        if (child.type === 'folder') {
            await browser.bookmarks.removeTree(child.id);
        } else {
            await browser.bookmarks.remove(child.id);
        }
    }

    return existingFolder.id;
}


/**
 * Recursively creates the Firefox folder structure for the Raindrop collection.
 */
async function getOrCreateCollectionFolder(raindropCollectionId, targetRootFolderId, importedRootCollectionId = null) {
    // System collections / Unsorted
    if (!raindropCollectionId || raindropCollectionId === -1 || raindropCollectionId === 0 || raindropCollectionId === -99) {
        return targetRootFolderId;
    }

    // Flatten logic: If this is the collection we are importing, don't create a subfolder for it.
    if (importedRootCollectionId && String(raindropCollectionId) === String(importedRootCollectionId)) {
        return targetRootFolderId;
    }

    if (firefoxFolderCache[raindropCollectionId]) {
        return firefoxFolderCache[raindropCollectionId];
    }

    const collectionData = collectionMap[raindropCollectionId];

    if (!collectionData) {
        return targetRootFolderId; // Fallback to root
    }

    // Recursive: Create Parent First
    let firefoxParentId;
    const raindropParentId = collectionData.parentId;

    if (raindropParentId) {
        firefoxParentId = await getOrCreateCollectionFolder(raindropParentId, targetRootFolderId, importedRootCollectionId);
    } else {
        firefoxParentId = targetRootFolderId;
    }

    // Find or Create Current Folder
    const children = await browser.bookmarks.getChildren(firefoxParentId);
    let subFolder = children.find(
        n => n.title === collectionData.title && n.type === 'folder'
    );

    if (!subFolder) {
        subFolder = await browser.bookmarks.create({
            parentId: firefoxParentId,
            title: collectionData.title
        });
    }

    firefoxFolderCache[raindropCollectionId] = subFolder.id;
    return subFolder.id;
}

/**
 * Helper: Find all descendant collection IDs for a given root collection ID
 */
function getDescendantCollectionIds(rootId) {
    const descendants = [];
    const queue = [rootId];

    // Convert string IDs to numbers if necessary for comparison, strictly depends on API response types
    // Raindrop IDs are integers usually.

    while (queue.length > 0) {
        const currentId = queue.shift();

        // Find all children of currentId
        for (const [id, data] of Object.entries(collectionMap)) {
            // data.parentId comes from the API. Check for type consistency (string/int)
            // We'll trust loose equality or ensure types match in map population
            // collectionMap keys are strings because of Object.entries

            if (String(data.parentId) === String(currentId)) {
                descendants.push(id);
                queue.push(id);
            }
        }
    }
    return descendants;
}

/**
 * Helper: Fetch bookmarks from a specific endpoint and import them
 */
async function fetchAndImportFromEndpoint(apiToken, url, searchParams, targetRootFolderId, importedRootCollectionId = null) {
    let page = 0;
    let importedCount = 0;
    let hasMore = true;

    while (hasMore) {
        searchParams.set('page', page);

        const response = await fetch(`${url}?${searchParams.toString()}`, {
            headers: { 'Authorization': `Bearer ${apiToken}` }
        });

        if (!response.ok) {
            throw new Error(`Raindrop API Error: ${await response.text()}`);
        }

        const data = await response.json();
        const raindrops = data.items;

        if (!raindrops || raindrops.length === 0) {
            hasMore = false;
            break;
        }

        for (const item of raindrops) {
            const raindropCollectionId = item.collection?.$id;
            const firefoxParentId = await getOrCreateCollectionFolder(raindropCollectionId, targetRootFolderId, importedRootCollectionId);

            await browser.bookmarks.create({
                parentId: firefoxParentId,
                title: item.title,
                url: item.link
            });
            importedCount++;
        }

        // Check if we reached the last page
        if (raindrops.length < 50) {
            hasMore = false;
        } else {
            page++;
        }
    }
    return importedCount;
}

/**
 * Helper: Find Collection ID by Name
 */
function findCollectionIdByName(name) {
    // Exact match case-insensitive
    const normalizedName = name.toLowerCase().trim();
    for (const [id, data] of Object.entries(collectionMap)) {
        if (data.title.toLowerCase() === normalizedName) {
            return id;
        }
    }
    return null;
}

// Main function to fetch and import bookmarks
async function importRaindropBookmarks(settings) {
    const { apiToken, targetFolder, mode, configValue } = settings;

    if (!apiToken || !targetFolder || !configValue) {
        throw new Error('Missing required settings (Token, Folder, or Tag/Collection Name).');
    }

    // 1. Fetch Structure First
    await fetchRaindropCollections(apiToken);

    // 2. Prepare Target Folder (Clean Slate)
    const targetRootFolderId = await getOrCreateTargetFolder(targetFolder);

    // Reset Cache
    for (const key in firefoxFolderCache) { delete firefoxFolderCache[key]; }

    let totalImported = 0;

    try {
        if (mode === 'tag') {
            // Import by Tag: Single global fetch
            const url = RAINDROP_API_URL + '/0';
            const searchParams = new URLSearchParams({ perpage: 50, search: `#${configValue}` });

            totalImported = await fetchAndImportFromEndpoint(apiToken, url, searchParams, targetRootFolderId);

        } else if (mode === 'collection') {
            // Import by Collection: Recursive fetch of target and all descendants
            const rootCollectionId = findCollectionIdByName(configValue);

            if (!rootCollectionId) {
                throw new Error(`Collection "${configValue}" not found.`);
            }

            // Get target + all children
            const collectionsToFetch = [rootCollectionId, ...getDescendantCollectionIds(rootCollectionId)];

            for (const collectionId of collectionsToFetch) {
                const url = RAINDROP_API_URL + `/${collectionId}`;
                const searchParams = new URLSearchParams({ perpage: 50 }); // No search filter, just get all in collection

                // Pass rootCollectionId to flatten the structure
                const count = await fetchAndImportFromEndpoint(apiToken, url, searchParams, targetRootFolderId, rootCollectionId);
                totalImported += count;
            }
        } else {
            throw new Error('Invalid import mode.');
        }

        return { success: true, count: totalImported, folder: targetFolder };

    } catch (error) {
        console.error('Import failed:', error);
        return { success: false, error: error.message };
    }
}

/**
 * Silent Sync Logic
 */
async function performSilentSync() {
    try {
        const stored = await browser.storage.local.get(null);

        if (!stored.apiToken || !stored.targetFolder) {
            console.warn('Auto-sync skipped: Missing API Token or Target Folder.');
            return;
        }

        const configValue = stored.method === 'tag' ? stored.tagValue : stored.collectionValue;
        if (!configValue) {
            console.warn('Auto-sync skipped: Missing tag/collection value.');
            return;
        }

        const settings = {
            apiToken: stored.apiToken,
            targetFolder: stored.targetFolder,
            mode: stored.method || 'collection',
            configValue: configValue
        };

        console.log('Starting Auto-Sync...');
        const result = await importRaindropBookmarks(settings);

        if (result.success) {
            await browser.storage.local.set({ lastSync: Date.now() });
            console.log(`Auto-Sync Success: ${result.count} bookmarks imported.`);
        } else {
            console.error('Auto-Sync Failed:', result.error);
        }

    } catch (e) {
        console.error('Auto-Sync Critical Error:', e);
    }
}

async function updateAlarm(interval) {
    if (!interval) interval = 0;

    await browser.alarms.clear(SYNC_ALARM_NAME);

    if (interval > 0) {
        browser.alarms.create(SYNC_ALARM_NAME, { periodInMinutes: interval });
        console.log(`Alarm set for every ${interval} minutes.`);
    } else {
        console.log('Alarm cleared (Manual Mode).');
    }
}

// Listeners

// 1. Alarm Listener
browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === SYNC_ALARM_NAME) {
        performSilentSync();
    }
});

// 2. Startup Listener (Missed Schedule Check)
browser.runtime.onStartup.addListener(async () => {
    const { syncInterval, lastSync } = await browser.storage.local.get(['syncInterval', 'lastSync']);

    if (!syncInterval || syncInterval <= 0) return;

    const now = Date.now();
    const last = lastSync || 0;
    const elapsedMinutes = (now - last) / (1000 * 60);

    if (elapsedMinutes >= syncInterval) {
        console.log(`Missed sync schedule (Offline for ${Math.round(elapsedMinutes)} mins). Syncing now...`);
        performSilentSync();
    }
});

// 2.5 Installed Listener (Initialize Defaults)
browser.runtime.onInstalled.addListener(async () => {
    const stored = await browser.storage.local.get(['syncInterval']);

    // Set default to Daily if not present
    if (stored.syncInterval === undefined) {
        await browser.storage.local.set({ syncInterval: 1440 });
        await updateAlarm(1440);
        console.log('Extension Installed: Default sync set to Daily (1440m).');
    }
});

// 3. Message Listener
browser.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.command === 'import_bookmarks') {
        importRaindropBookmarks(message.settings).then(res => {
            if (res.success) {
                // Update lastSync on manual import too
                browser.storage.local.set({ lastSync: Date.now() });
            }
            sendResponse(res);
        });
        return true;
    }

    if (message.command === 'update_alarm') {
        updateAlarm(message.interval).then(() => sendResponse({ status: 'ok' }));
        return true;
    }
});