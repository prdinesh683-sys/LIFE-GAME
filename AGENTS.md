# Project Agent Guidelines

## Architecture & System Invariants
- **Database**: IndexedDB is the authoritative live local store (`DB_VERSION = 6`).
- **Sync**: Direct Google Drive v3 REST API transport (`SYNC_SCHEMA_VERSION = 1`).
- **MCP Integration**: Google Drive MCP server configured via `.agents/mcp_config.json` pointing to `https://drivemcp.googleapis.com/mcp/v1`.
- **Destinations**: Exactly 4 primary destinations (`Today`, `Quests`, `Chat`, `Settings`).
- **AI Router**: Local-first deterministic authority with optional Ollama/PhoneLocal/Cloud brains.
