# Raindrop.io Importer

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](https://opensource.org/licenses/MIT)

A lightweight Firefox extension that imports your **Raindrop.io** bookmarks directly into your Firefox Bookmarks Toolbar. 

## Features ✨

*   **Smart Sync**: Automatically keeps your bookmarks up to date (Daily, Every 3 Days, or Weekly).
*   **Selective Import**: Import a specific **Collection** or by **#tag**.
*   **Flattened Structure**: Contents of your imported collection (e.g., "Bookmarks") are placed directly in the target folder for cleaner organization.
*   **Safe**: Checks for API health before modifying any data.
*   **Detailed Feedback**: Shows exactly when the last successful sync occurred.
*   **Privacy Focused**: Your API token is stored locally in your browser and used only to communicate with Raindrop.io.

## Configuration ⚙️

1.  **API Token**: Get your "Test Token" from the [Raindrop.io Settings](https://app.raindrop.io/settings/integrations).
2.  **Import Method**:
    *   **Collection**: Import a specific collection (default: "Bookmarks").
    *   **Tag**: Import all bookmarks with a specific tag (e.g., `#firefox`).
3.  **Target Folder**: The name of the folder in your Bookmarks Toolbar where items will be saved (default: `Imported from Raindrop`).
4.  **Auto-Sync**: Choose how often you want the extension to sync in the background.

## Development 🛠️

To modify or build the extension from source:

1.  Clone this repository:
    ```bash
    git clone https://github.com/BXZ1/raindrop-importer.git
    ```
2.  Open Firefox and go to `about:debugging`.
3.  Click **"This Firefox"**.
4.  Click **"Load Temporary Add-on..."**.
5.  Select the `manifest.json` file from the cloned folder.

## License 📄

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.


*Not affiliated with Raindrop.io.*
